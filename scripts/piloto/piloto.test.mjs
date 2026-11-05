// El piloto del kit de punta a punta, sin red ni modelo: un origin desnudo, la principal y un worktree por carril, el coordinador real,
// las piezas reales del piloto en su copia con sha256 (bucle, compuerta, cierre, gasto, hechos, consumo, publicar) y falsos de lo que
// habla con el mundo: `claude`, `codex`, `gh`, y en la copia `decidir.sh` (responde lo que diga el guion, o nada) y `verificar.sh`
// (pasa). Cada prueba corre `bucle.sh --una-vuelta` y mira el repo, el estado del coordinador y el registro de llamadas.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const KIT = resolve(new URL('../..', import.meta.url).pathname)

const ruteo = (r) => ({
  agente: 'claude',
  modelo: 'sonnet',
  effort: 'high',
  modo: 'auto',
  sesion: 'nueva',
  revisor: 'ninguno',
  ...r,
})
function planYaml({ p02 = {}, agentes = ['claude'] } = {}) {
  const pasos = [
    {
      id: 'P01',
      titulo: 'Esquema',
      depende_de: [],
      carril: 'datos',
      riesgo: 'rojo',
      modulos: ['supabase/migrations/'],
      ruteo: ruteo({
        modelo: 'opus',
        effort: 'xhigh',
        modo: 'plan→manual',
        revisor: 'claude-sesion-nueva',
      }),
    },
    {
      id: 'P02',
      titulo: 'Inicio',
      depende_de: [],
      carril: 'ui',
      riesgo: 'verde',
      modulos: ['src/app/'],
      ruteo: ruteo(p02.ruteo ?? {}),
      ...(p02.riesgo ? { riesgo: p02.riesgo } : {}),
    },
    {
      id: 'P03',
      titulo: 'Lista',
      depende_de: ['P01', 'P02'],
      carril: 'ui',
      riesgo: 'ambar',
      modulos: ['src/ui/'],
      ruteo: ruteo(),
    },
  ].map((p) => ({ ...p, verificacion: { nivel: 1, comando: 'true' }, terminado: 'verde' }))
  return JSON.stringify({
    esquema: 'plan/v1',
    agentes_disponibles: agentes,
    carriles: [
      { id: 'datos', dueno_de: ['supabase/'] },
      { id: 'ui', dueno_de: ['src/app/', 'src/ui/'] },
    ],
    pasos,
  })
}

const FALSO_CLAUDE = `#!/usr/bin/env bash
F="$FAKE_DIR"
n=$(( $(cat "$F/n-claude" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$F/n-claude"
echo "claude n=$n carril=$(sed -n 's/^CARRIL=//p' .env.carril) args: $*" >> "$F/llamadas.log"
prompt=""; while [ $# -gt 0 ]; do [ "$1" = -p ] && prompt="$2"; shift; done
paso=$(awk '{print $2}' <<<"$prompt")
if [ -f "$F/claude-$n.sh" ]; then PASO="$paso" bash "$F/claude-$n.sh"; else
  desde=$(jq -r .head_arranque .piloto/en-curso.json)
  mkdir -p src/app && echo "$paso" > "src/app/$paso.txt" && git add -A && git commit -qm "feat: $paso"
  jq -n --arg p "$paso" --argjson c "$(git rev-list --first-parent --reverse "$desde..HEAD" | jq -Rnc '[inputs]')" \\
    '{paso: $p, resultado: "listo", resumen: "hecho", commits: $c, e2e_dirigidos: [], compuerta: null}' > .piloto/ultimo.json
fi
if [ -f "$F/salida-$n.json" ]; then cat "$F/salida-$n.json"; else
echo '{"type":"result","is_error":false,"result":"ok","session_id":"s","total_cost_usd":0.5,"duration_ms":10,"modelUsage":{"claude-sonnet-5-5":{"inputTokens":1,"outputTokens":1,"cacheReadInputTokens":0,"cacheCreationInputTokens":0,"costUSD":0.5}}}'
fi
`

const FALSO_CODEX = `#!/usr/bin/env bash
F="$FAKE_DIR"
echo "codex args: $*" >> "$F/llamadas.log"
cat > "$F/codex-prompt.md"
final=""; while [ $# -gt 0 ]; do [ "$1" = -o ] && final="$2"; shift; done
mkdir -p src/app && echo codex > src/app/codex.txt
echo '{"resultado":"listo","resumen":"hecho por codex","tipo_commit":"feat","e2e_dirigidos":[],"compuerta":null}' > "$final"
echo '{"type":"thread.started","thread_id":"t1"}'
echo '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5}}'
`

const FALSO_GH = `#!/usr/bin/env bash
F="$FAKE_DIR"
echo "gh $*" >> "$F/llamadas.log"
cabeza() { local h=""; while [ $# -gt 0 ]; do [ "$1" = --head ] && h="$2"; shift; done; echo "\${h//\\//_}"; }
case "$1 $2" in
  "auth status") exit 0 ;;
  "run list") echo '[]' ;;
  "pr list") h=$(cabeza "$@"); if [ -f "$F/pr-$h" ]; then echo "[{\\"number\\":$(cat "$F/pr-$h")}]"; else echo '[]'; fi ;;
  "pr create") h=$(cabeza "$@"); n=$(( $(cat "$F/n-pr" 2>/dev/null || echo 40) + 1 )); echo $n > "$F/n-pr"; echo $n > "$F/pr-$h" ;;
  "pr comment") ;;
  *) exit 2 ;;
esac
`

// decidir falso: con $FAKE_DIR/respuesta-<n> escribe decision.md (como el hook) con esa opción; sin él, no responde.
const FALSO_DECIDIR = `#!/usr/bin/env bash
F="$FAKE_DIR"
PILOTO_COMUN="$(git rev-parse --path-format=absolute --git-common-dir)/piloto/$(sed -n 's/^CARRIL=//p' .env.carril)"
case "\${1:-}" in
  abrir)
    n=$(( $(cat "$F/n-decidir" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$F/n-decidir"
    cp "$PILOTO_COMUN/compuerta.md" "$F/compuerta-$n.md"
    if [ -f "$F/respuesta-$n" ]; then
      id=$(sed -n 's/^id: *//p' "$PILOTO_COMUN/compuerta.md" | head -n 1)
      r=$(cat "$F/respuesta-$n")
      ( sleep 0.2; printf 'id: %s\\nopcion: %s\\nnotas: \\ncreada: 0\\nme respondió: «%s»\\n' "$id" "$r" "$r" > "$PILOTO_COMUN/decision.md" ) &
    fi ;;
esac
exit 0
`

// Una identidad de git propia de la prueba: no depende de la configuración de la máquina (sin user.email global, `git commit` falla).
const IDENTIDAD = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
}
function sh(cwd, ...args) {
  return execFileSync(args[0], args.slice(1), {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...IDENTIDAD },
  }).trim()
}

function montar({ plan = planYaml() } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'piloto-'))
  const fake = join(base, 'fake')
  const binFalsos = join(fake, 'bin')
  mkdirSync(binFalsos, { recursive: true })
  for (const [n, s] of [
    ['claude', FALSO_CLAUDE],
    ['codex', FALSO_CODEX],
    ['gh', FALSO_GH],
  ]) {
    writeFileSync(join(binFalsos, n), s)
    chmodSync(join(binFalsos, n), 0o755)
  }
  const origin = join(base, 'origin.git')
  sh(base, 'git', 'init', '-q', '--bare', '-b', 'main', origin)
  const principal = join(base, 'prueba')
  sh(base, 'git', 'clone', '-q', origin, principal)
  for (const d of ['scripts/coordinador', 'scripts/piloto', 'scripts/lib'])
    cpSync(join(KIT, d), join(principal, d), { recursive: true })
  mkdirSync(join(principal, 'docs/semilla'), { recursive: true })
  writeFileSync(join(principal, 'docs/semilla/plan.yaml'), plan)
  mkdirSync(join(principal, '.claude/skills/piloto'), { recursive: true })
  writeFileSync(
    join(principal, '.claude/skills/piloto/codex.md'),
    '# Instrucciones para Codex (prueba)\n',
  )
  writeFileSync(
    join(principal, 'piloto.config'),
    'PROYECTO=prueba\nPILOTO_BLOQUE=5\nPILOTO_AUTO_MIN=5\n',
  )
  writeFileSync(join(principal, 'package.json'), '{"type":"module"}\n')
  writeFileSync(join(principal, '.gitignore'), '.piloto/\nnode_modules\n.env.carril\n')
  symlinkSync(join(KIT, 'node_modules'), join(principal, 'node_modules'))
  sh(principal, 'git', 'add', '-A')
  sh(principal, 'git', 'commit', '-qm', 'inicio')
  sh(principal, 'git', 'push', '-q', '-u', 'origin', 'main')

  const env = {
    ...process.env,
    PATH: `${binFalsos}:${process.env.PATH}`,
    FAKE_DIR: fake,
    CLAUDE_BIN: join(binFalsos, 'claude'),
    CODEX_BIN: join(binFalsos, 'codex'),
    ...IDENTIDAD,
    PILOTO_DORMIR: 'true',
    PILOTO_POLL: '0.1',
    PILOTO_ESPERA_S: '0',
    // El disco real de la máquina no decide estas pruebas.
    PILOTO_DISCO_MAX: '100',
    COORD_USD_VENTANA: '',
    COORD_PROYECTOS: '/dev/null',
  }
  const comun = join(principal, '.git')
  const carriles = {}
  for (const carril of ['datos', 'ui']) {
    const dir = join(base, 'prueba.carriles', carril)
    sh(principal, 'git', 'worktree', 'add', '-q', '-B', `${carril}/base`, dir, 'origin/main')
    symlinkSync(join(KIT, 'node_modules'), join(dir, 'node_modules'))
    writeFileSync(join(dir, '.env.carril'), `CARRIL=${carril}\n`)
    // La copia de las piezas, como arrancar.sh, con decidir y verificar falsos.
    const bin = join(comun, 'piloto', carril, 'bin')
    mkdirSync(bin, { recursive: true })
    for (const f of execFileSync('ls', [join(KIT, 'scripts/piloto')], { encoding: 'utf8' })
      .split('\n')
      .filter((f) => /\.(sh|mjs|json)$/.test(f) && !f.includes('.test.')))
      cpSync(join(KIT, 'scripts/piloto', f), join(bin, f))
    writeFileSync(join(bin, 'decidir.sh'), FALSO_DECIDIR)
    writeFileSync(
      join(bin, 'verificar.sh'),
      '#!/usr/bin/env bash\necho "verificar $*" >> "$FAKE_DIR/llamadas.log"\n',
    )
    sh(
      bin,
      'bash',
      '-c',
      "sha256sum -- * > bin.sha256 && grep -v ' bin.sha256$' bin.sha256 > t && mv t bin.sha256",
    )
    const vuelta = (extra = {}) =>
      spawnSync('bash', [join(bin, 'bucle.sh'), '--una-vuelta'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...env, ...extra },
        timeout: 60_000,
      })
    carriles[carril] = { dir, bin, vuelta, comun: join(comun, 'piloto', carril) }
  }
  const llamadas = () =>
    existsSync(join(fake, 'llamadas.log')) ? readFileSync(join(fake, 'llamadas.log'), 'utf8') : ''
  const estado = () =>
    JSON.parse(readFileSync(join(comun, 'coordinador/estado.json'), 'utf8')).pasos
  const enOrigin = (rama) =>
    spawnSync('git', ['-C', origin, 'rev-parse', '--verify', '--quiet', `refs/heads/${rama}`])
      .status === 0
  return { base, fake, principal, origin, carriles, llamadas, estado, enOrigin }
}

const salida = (r) => `${r.stdout}\n${r.stderr}`

test('un paso verde de punta a punta: rama propia, modelo del plan, verificar, push, PR y el coordinador lo sabe', () => {
  const m = montar()
  const r = m.carriles.ui.vuelta()
  assert.equal(r.status, 0, salida(r))
  const log = m.llamadas()
  assert.match(
    log,
    /claude n=1 carril=ui args: -p \/piloto P02 --model sonnet --effort high --permission-mode auto/,
  )
  assert.doesNotMatch(log, /--hasta-plan/)
  assert.match(log, /verificar /)
  assert.match(log, /gh pr create --base main --head ui\/p02 --title P02 · Inicio/)
  assert.ok(m.enOrigin('ui/p02'), 'la rama del paso está en origin')
  assert.deepEqual([m.estado().P02.estado, m.estado().P02.pr], ['publicado', 41])
  assert.ok(!existsSync(join(m.carriles.ui.dir, '.piloto/en-curso.json')), 'el paso cerró')
  assert.match(
    readFileSync(join(m.carriles.ui.dir, '.piloto/consumo.csv'), 'utf8'),
    /,paso,P02,sonnet,high,/,
  )

  // La vuelta siguiente: P03 espera a P01 (rojo, de otro carril); no se llama a ningún modelo.
  const r2 = m.carriles.ui.vuelta()
  assert.equal(r2.status, 0, salida(r2))
  assert.match(r2.stdout, /espero: P03 espera a que se integren: P01, P02/)
  assert.equal((m.llamadas().match(/claude n=/g) ?? []).length, 1)
})

test('el límite de 5 h duerme y retoma el paso con --resume, no lo cuenta como falla', () => {
  const m = montar()
  // La salida real de \`claude -p\` al chocar con el límite (31/10): «5-hour», con cifra y guion.
  writeFileSync(join(m.fake, 'claude-1.sh'), 'true')
  writeFileSync(
    join(m.fake, 'salida-1.json'),
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      terminal_reason: 'api_error',
      api_error_status: 429,
      api_error: 'usage_limit_reached',
      result: "You've hit your 5-hour limit · resets 9:30pm (America/La_Paz)",
      session_id: 's',
      total_cost_usd: 0,
      duration_ms: 10,
      modelUsage: {},
    }),
  )
  const r = m.carriles.ui.vuelta()
  assert.equal(r.status, 0, salida(r))
  assert.match(r.stdout, /límite de uso en P02: duermo \d+ s y retomo con --resume/)
  assert.match(m.llamadas(), /claude n=2 carril=ui args: -p \/piloto P02 continuar .*--resume/)
  assert.doesNotMatch(r.stdout, /falló/)
  assert.deepEqual([m.estado().P02.estado, m.estado().P02.pr], ['publicado', 41])
})

test('un paso rojo corre hasta el plan, con opus y xhigh; cada carril tiene su carpeta común', () => {
  const m = montar()
  // El paso rojo pide la compuerta de datos con el plan; nadie responde y el bucle se rinde a los 2 s (PILOTO_ESPERA_MAX).
  writeFileSync(
    join(m.fake, 'claude-1.sh'),
    `jq -n '{paso: "P01", resultado: "compuerta", resumen: "plan listo", commits: [], e2e_dirigidos: [],
    compuerta: {tipo: "datos", motivo: "toca RLS", pregunta: "¿Apruebas el plan?", opciones: [{etiqueta: "aprobar", descripcion: "(recomendado)"}, {etiqueta: "parar", descripcion: "no"}], contexto: []}}' > .piloto/ultimo.json`,
  )
  const r = m.carriles.datos.vuelta({
    PILOTO_ESPERA_MAX: '2',
    PILOTO_AUTO_MIN: '0',
    PILOTO_AUTO_SEG: '0',
  })
  assert.equal(r.status, 3, salida(r)) // sin respuesta: el bucle sale con 3; una roja nunca se elige sola
  assert.match(m.llamadas(), /-p \/piloto P01 --hasta-plan --model opus --effort xhigh/)
  assert.ok(!existsSync(join(m.carriles.datos.comun, 'decision.md')), 'nadie eligió por la persona')
  assert.ok(existsSync(join(m.carriles.datos.comun, 'compuerta.md')))
  assert.ok(
    !existsSync(join(m.carriles.ui.comun, 'compuerta.md')),
    'la compuerta de datos no está en la carpeta de ui',
  )
})

test('ámbar: una compuerta de producto de un paso no rojo se elige sola a los PILOTO_AUTO_MIN minutos', () => {
  const m = montar()
  writeFileSync(
    join(m.fake, 'claude-1.sh'),
    `jq -n '{paso: "P02", resultado: "compuerta", resumen: "dos dudas", commits: [], e2e_dirigidos: [],
    compuerta: {tipo: "producto", motivo: "copy", contexto: [], preguntas: [
      {id: "P0", pregunta: "¿Texto del botón?", opciones: [{etiqueta: "Guardar", descripcion: "(recomendado)"}, {etiqueta: "Listo", descripcion: "x"}]},
      {id: "P1", pregunta: "¿Orden?", opciones: [{etiqueta: "Por fecha", descripcion: "(recomendado)"}, {etiqueta: "Por nombre", descripcion: "x"}]}]}}' > .piloto/ultimo.json`,
  )
  const r = m.carriles.ui.vuelta({ PILOTO_AUTO_SEG: '1' })
  assert.equal(r.status, 0, salida(r))
  const decision = readFileSync(join(m.carriles.ui.comun, 'decision.md'), 'utf8')
  assert.match(decision, /^- P0: Guardar$/m)
  assert.match(decision, /^- P1: Por fecha$/m)
  assert.match(decision, /me respondió: «autoelección a los 5 min: P0: Guardar; P1: Por fecha»/)
  assert.match(
    readFileSync(join(m.fake, 'compuerta-1.md'), 'utf8'),
    /^ambar: si no responde en 5 min/m,
  )
  assert.match(
    readFileSync(join(m.carriles.ui.dir, '.piloto/autoelecciones.md'), 'utf8'),
    /P02 · autoelección ámbar a los 5 min/,
  )

  // La vuelta siguiente retoma el paso con --resume y la decisión está en hechos.json.
  m.carriles.ui.vuelta()
  assert.match(m.llamadas(), /claude n=2 carril=ui args: -p \/piloto P02 continuar .*--resume/)
})

test('un paso de Codex: el bucle hace el commit, anota tokens y publica', () => {
  const m = montar({
    plan: planYaml({
      agentes: ['claude', 'codex'],
      p02: { ruteo: { agente: 'codex', modelo: 'codex', effort: 'medium' } },
    }),
  })
  const r = m.carriles.ui.vuelta()
  assert.equal(r.status, 0, salida(r))
  assert.match(
    m.llamadas(),
    /codex args: exec --json --sandbox workspace-write -c model_reasoning_effort=medium --output-schema .*codex-final.schema.json -o .* -/,
  )
  assert.doesNotMatch(m.llamadas(), /claude n=/)
  assert.match(readFileSync(join(m.fake, 'codex-prompt.md'), 'utf8'), /"paso": "P02"/)
  assert.equal(sh(m.carriles.ui.dir, 'git', 'log', '-1', '--format=%s'), 'feat(ui): Inicio')
  assert.equal(m.estado().P02.estado, 'publicado')
  assert.match(
    readFileSync(join(m.carriles.ui.dir, '.piloto/consumo.csv'), 'utf8'),
    /,paso,P02,codex,medium,t1,100,25,40,0,165,0,/,
  )
})

test('Fable: no corre sin que la persona lo apruebe', () => {
  const m = montar({ plan: planYaml({ p02: { ruteo: { modelo: 'fable' } } }) })
  writeFileSync(join(m.fake, 'respuesta-1'), 'parado — no sigue (recomendado)')
  const r = m.carriles.ui.vuelta()
  assert.equal(r.status, 0, salida(r))
  assert.match(readFileSync(join(m.fake, 'compuerta-1.md'), 'utf8'), /va con Fable/)
  assert.doesNotMatch(m.llamadas(), /claude n=/)

  const m2 = montar({ plan: planYaml({ p02: { ruteo: { modelo: 'fable' } } }) })
  writeFileSync(join(m2.fake, 'respuesta-1'), 'sigo — usa Fable en este paso')
  assert.equal(m2.carriles.ui.vuelta().status, 0)
  assert.match(m2.llamadas(), /claude n=1 carril=ui args: -p \/piloto P02 --model fable/)
})

test('la copia alterada no corre nada', () => {
  const m = montar()
  writeFileSync(join(m.carriles.ui.bin, 'cierre.sh'), '# cambiado\n', { flag: 'a' })
  writeFileSync(join(m.fake, 'respuesta-1'), 'parado — no sigue (recomendado)')
  const r = m.carriles.ui.vuelta()
  assert.equal(r.status, 0, salida(r))
  assert.match(readFileSync(join(m.fake, 'compuerta-1.md'), 'utf8'), /no coincide con bin.sha256/)
  assert.doesNotMatch(m.llamadas(), /claude n=/)
})

test('una compuerta de producto en un paso ROJO no se elige sola', () => {
  const m = montar()
  writeFileSync(
    join(m.fake, 'claude-1.sh'),
    `jq -n '{paso: "P01", resultado: "compuerta", resumen: "duda", commits: [], e2e_dirigidos: [],
    compuerta: {tipo: "producto", motivo: "dinero", contexto: [], preguntas: [
      {id: "P0", pregunta: "¿Redondeo?", opciones: [{etiqueta: "Al centavo", descripcion: "(recomendado)"}, {etiqueta: "Al entero", descripcion: "x"}]}]}}' > .piloto/ultimo.json`,
  )
  const r = m.carriles.datos.vuelta({ PILOTO_AUTO_SEG: '0', PILOTO_ESPERA_MAX: '2' })
  assert.equal(r.status, 3, salida(r))
  assert.ok(!existsSync(join(m.carriles.datos.comun, 'decision.md')))
  assert.doesNotMatch(readFileSync(join(m.fake, 'compuerta-1.md'), 'utf8'), /^ambar:/m)
})
