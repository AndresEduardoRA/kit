// semilla-a-repo, la parte determinista: una semilla de prueba que pasa el validador real de idea-a-semilla, el proyecto que sale, y
// lo que se niega a hacer. El validador v1 (el que el generador entiende hoy) va con el kit en scripts/kit/fixtures/; KIT_VALIDADOR
// lo cambia. Sin python3 con PyYAML las pruebas con validador se saltan, diciéndolo.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { readdirSync, statSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { leerManifiesto } from '../proyecto/manifiesto.mjs'
import {
  crear,
  marcadoresSueltos,
  moverPuertos,
  problemasDelCss,
  scopesDelPlan,
  seccion,
} from './nuevo-proyecto.mjs'

/** Los archivos de una carpeta, relativos a ella (sin node_modules). */
function listarArchivos(raiz, pre = '') {
  return readdirSync(join(raiz, pre)).flatMap((n) => {
    const rel = pre + n
    if (n === 'node_modules') return []
    return statSync(join(raiz, rel)).isDirectory() ? listarArchivos(raiz, rel + '/') : [rel]
  })
}

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const hayPyYaml = (() => {
  try {
    execFileSync('python3', ['-c', 'import yaml'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const VALIDADOR = [
  process.env.KIT_VALIDADOR,
  hayPyYaml ? join(KIT, 'scripts/kit/fixtures/validar_semilla_v1.py') : undefined,
  join(KIT, '../semillas/_herramientas/validar_semilla.py'),
  '/home/claude/idea-a-semilla/validar_semilla.py',
].find((r) => r && existsSync(r))
const conValidador = VALIDADOR ? test : test.skip

const tokensKit = readFileSync(join(KIT, 'design/tokens.css'), 'utf8')
const cssKit = tokensKit
  .slice(
    tokensKit.indexOf('*/', tokensKit.indexOf('semilla:inicio')) + 2,
    tokensKit.lastIndexOf('/*', tokensKit.indexOf('semilla:fin')),
  )
  .trim()
const cssSemilla = cssKit.replace(
  /--color-primario:\s*[^;]+;/,
  '--color-primario: oklch(0.6 0.2 30);',
)

const ruteo =
  'ruteo: {agente: claude, modelo: sonnet, effort: high, modo: auto, sesion: nueva, revisor: ninguno}'
const PLAN = `esquema: plan/v1
agentes_disponibles: [claude]
carriles:
  - {id: datos, dueno_de: [supabase/, src/modules/turnos/infra/]}
  - {id: ui, dueno_de: [src/modules/turnos/features/, src/app/turnos/]}
pasos:
  - id: P01
    titulo: Esquema de turnos
    depende_de: []
    carril: datos
    riesgo: rojo
    modulos: [supabase/migrations/]
    decisiones: [A1]
    ruteo: {agente: claude, modelo: opus, effort: xhigh, modo: plan→manual, sesion: nueva, revisor: claude-sesion-nueva}
    verificacion: {nivel: 1, comando: "pnpm db:probar"}
    terminado: db:probar verde
  - id: P02
    titulo: Lista de turnos
    depende_de: [P01]
    carril: ui
    riesgo: ambar
    modulos: [src/modules/turnos/features/lista/, src/app/turnos/]
    decisiones: [F1]
    ${ruteo}
    verificacion: {nivel: 1, comando: "pnpm test"}
    terminado: test verde
`
const SEMILLA = `---
esquema: semilla/v1
nombre: Turnos del consultorio
slug: turnos
version: 2
tamano: chico
tipo: interno
plataforma: PWA
arquitectura: features
stack: {next: "16.4.3"}
servicios: [supabase, vercel]
agentes: [claude]
tope_cuota: {ventana_5h_pct: 30, semanal_pct: 20}
funciones_edge: [push, storage-gc]
generada_con: {modelo: opus, effort: high, confirmado_por: dueño}
---

## 1. Visión y alcance

Agenda de turnos para un consultorio chico, con recepción y dueño (A1, F1).

## 6. Experiencia

- /turnos: lista con sus estados vacío, carga, error, sin permiso y sin conexión.

## 7. Escala y rendimiento

- La lista lleva cursor y página de 25.

## 8. Sistema de diseño

\`\`\`css
${cssSemilla}
\`\`\`

## 11. Glosario

- **Turno:** una hora reservada.
`
const REGISTRO = `| ID | tema | decisión | estado | fuente |
|---|---|---|---|---|
| A1 | usuarios | recepción y dueño | cerrada | dueño |
| F1 | stack | Next | recomendado aceptado | dueño |
`

function semilla(cambio = (x) => x) {
  const raiz = mkdtempSync(join(tmpdir(), 'semillas-'))
  const dir = join(raiz, 'turnos')
  mkdirSync(dir)
  const f = cambio({
    'semilla.md': SEMILLA,
    'plan.yaml': PLAN,
    'registro.md': REGISTRO,
    'CHANGELOG.md': '# v2\n',
  })
  for (const [n, t] of Object.entries(f)) writeFileSync(join(dir, n), t)
  // `proyectos`: la raíz de proyectos de la prueba, donde van los z_<proyecto>/proyecto.yaml de los demás.
  return { dir, destino: join(raiz, 'proyectos', 'turnos'), proyectos: join(raiz, 'z') }
}

/** Escribe `<proyectos>/z_<slug>/proyecto.yaml` con un repo por bloque (`bloques`) o con puertos heredados (`{ heredado }`). */
function manifiestoSuelto(proyectos, slug, ...puertos) {
  const carpeta = join(proyectos, `z_${slug}`)
  mkdirSync(carpeta, { recursive: true })
  const repos = puertos.map((p, i) => {
    const rol = ['app', 'web', 'crm'][i]
    return `  - rol: ${rol}
    nombre: ${slug}-${rol}
    github: Duena/${slug}-${rol}
    etapa: construccion
    semilla: null
    puertos: ${typeof p === 'number' ? `{ bloque: ${p} }` : `{ heredado: { api: 54621, base: 54622, app: 3000 } }`}
    provee: []
    consume: []`
  })
  writeFileSync(
    join(carpeta, 'proyecto.yaml'),
    `esquema: proyecto/v1\nproyecto: ${slug}\nnombre: ${slug}\nsemilla: null\nrepos:\n${repos.join('\n')}\ncontratos: []\n`,
  )
  return join(carpeta, 'proyecto.yaml')
}

test('los puertos del bloque 5 pasan al del proyecto, y nada más', () => {
  assert.equal(
    moverPuertos('port = 55321\nshadow = 55320\nhttp://localhost:8000 e2e 8210 id 4000-8000-x', 6),
    'port = 56321\nshadow = 56320\nhttp://localhost:9000 e2e 9210 id 4000-9000-x'.replace(
      '4000-9000',
      '4000-9000',
    ),
  )
})

test('los scopes salen de los módulos del plan', () => {
  const plan = {
    carriles: [
      { id: 'datos', dueno_de: ['supabase/', 'src/modules/turnos/infra/'] },
      { id: 'ui', dueno_de: [] },
    ],
    pasos: [{ modulos: ['src/modules/pagos/features/x/'] }],
  }
  assert.deepEqual(scopesDelPlan(plan), ['pagos', 'turnos'])
  assert.deepEqual(scopesDelPlan(null), [])
})

test('el contrato de tokens: nombres del kit y tema oscuro', () => {
  assert.deepEqual(problemasDelCss(cssSemilla, cssKit), [])
  const p = problemasDelCss(':root { --color-primario: red; --fondo: x; }', cssKit)
  assert.match(p[0], /le faltan tokens del contrato del kit: .*--color-paper/)
  assert.match(p.join('\n'), /no trae el tema oscuro/)
})

test('seccion', () => {
  assert.equal(seccion('## 1. A\nx\n## 2. B\ny', 'A'), 'x')
  assert.equal(seccion('## 1. A\nx', 'Z'), null)
})

conValidador(
  'un proyecto de punta a punta: reemplazos, docs derivados, commit y sin marcadores',
  () => {
    const s = semilla()
    // ningún otro manifiesto en la raíz: el bloque es el 5
    const r = crear(s.dir, s.destino, { validador: VALIDADOR, raizProyectos: s.proyectos })
    assert.equal(r.bloque, 5)
    const leer = (f) => readFileSync(join(s.destino, f), 'utf8')
    assert.match(leer('e2e/funciones.txt'), /^push\nstorage-gc\n$/m)
    assert.match(leer('supabase/config.toml'), /^project_id = "turnos"$/m)
    assert.match(
      leer('.github/workflows/ci.yml'),
      /SUPABASE_API_LOCAL: http:\/\/127\.0\.0\.1:55321/,
    )
    assert.match(leer('AGENTS.md'), /^# Turnos del consultorio$/m)
    assert.match(leer('AGENTS.md'), /Scopes: .*\(turnos\)/)
    assert.match(leer('commitlint.config.mjs'), /'turnos',\n/)
    assert.match(leer('src/shared/config/app.ts'), /COLOR_TEMA = 'oklch\(0\.6 0\.2 30\)'/)
    // Los marcadores del flujo (de calesa-app): el orquestador, los puertos de la pila del CI, el revisor y las skills.
    // El nombre del repo no se fija: PROYECTO va vacío y sale del manifiesto (`turnos-app`).
    assert.match(leer('scripts/orquestador/config.env'), /^PROYECTO=""$/m)
    assert.match(leer('scripts/orquestador/README.md'), /orquestador-turnos-app/)
    // La copia del manifiesto: el slug, el nombre, la cuenta del kit, el bloque; válida y sin marcadores.
    const manifiesto = leerManifiesto(leer('.proyecto/proyecto.yaml'))
    assert.equal(manifiesto.proyecto, 'turnos')
    assert.equal(manifiesto.nombre, 'Turnos del consultorio')
    assert.equal(manifiesto.repos[0].nombre, 'turnos-app')
    assert.equal(manifiesto.repos[0].github, 'AndresEduardoRA/turnos-app')
    assert.deepEqual(manifiesto.repos[0].puertos, { bloque: 5 })
    assert.equal(r.cuenta, 'AndresEduardoRA')
    assert.match(
      leer('.github/acciones/pila/action.yml'),
      /ip_local_reserved_ports=54300-54399,55320-55329$/m,
    )
    assert.match(leer('.github/acciones/pila/action.yml'), /Puertos del bloque 5\./)
    assert.match(leer('.claude/agents/revisor.md'), /Eres el revisor de Turnos del consultorio\./)
    assert.match(
      leer('.claude/skills/entregar/SKILL.md'),
      /trabajo actual de Turnos del consultorio/,
    )
    assert.match(
      leer('scripts/orquestador/prompts/tarea.md'),
      /orquestador de Turnos del consultorio\./,
    )
    assert.match(
      leer('scripts/orquestador/prompts/tarea.md'),
      /# Tarea \{\{ID\}\} — \{\{TITULO\}\}/,
    )
    assert.match(leer('design/tokens.css'), /--color-primario: oklch\(0\.6 0\.2 30\);/)
    assert.match(leer('docs/UX.md'), /versión 2[\s\S]*\/turnos: lista/)
    assert.match(leer('docs/GLOSARIO.md'), /\*\*Turno:\*\*/)
    assert.ok(existsSync(join(s.destino, 'docs/semilla/plan.yaml')))
    assert.ok(!existsSync(join(s.destino, 'docs/pasos')), 'ni docs/pasos')
    // Nada del flujo viejo (el regex se arma en pedazos: el grep de K04 no cuenta esta prueba). Ni archivos ni texto, salvo docs/semilla.
    const viejo = new RegExp(
      ['pilo', 'to|coordina', 'dor|compuer', 'ta|PILO', 'TO_|COORD', '_'].join(''),
      'i',
    )
    const sueltos = []
    for (const f of listarArchivos(s.destino)) {
      if (f.startsWith('docs/semilla/') || f.startsWith('.git/') || f === 'docs/KIT.md') continue
      if (viejo.test(f) || viejo.test(readFileSync(join(s.destino, f), 'utf8'))) sueltos.push(f)
    }
    assert.deepEqual(sueltos, [], 'el proyecto generado no trae rastro del flujo viejo')
    assert.ok(!existsSync(join(s.destino, 'scripts/kit')), 'el generador no viaja')
    assert.ok(!existsSync(join(s.destino, 'scripts/semilla')), 'la semilla de ejemplo no viaja')
    assert.ok(
      existsSync(join(KIT, '.kit/plantilla')),
      'el kit tiene la marca de plantilla que salta los jobs de proyecto',
    )
    assert.ok(
      !existsSync(join(s.destino, '.kit/plantilla')),
      'un proyecto generado no la tiene: sus jobs corren',
    )
    assert.ok(!existsSync(join(s.destino, 'node_modules')))
    assert.equal(
      execFileSync('git', ['-C', s.destino, 'log', '--format=%s'], { encoding: 'utf8' }).trim(),
      'chore(kit): arrancar turnos desde el kit (semilla v2)',
    )
    assert.equal(JSON.parse(leer('package.json')).name, 'turnos')
  },
)

test('marcadoresSueltos nombra cada marcador que quedó y en qué archivo', () => {
  assert.deepEqual(
    marcadoresSueltos({ 'a.md': 'sin nada', 'b.yml': 'x {{PUERTOS_PILA}} y cambiar-slug' }),
    ['b.yml: {{PUERTOS_PILA}}', 'b.yml: cambiar-slug'],
  )
  // Los del orquestador no son del generador: los reemplaza orquestador.sh al armar cada prompt.
  assert.deepEqual(marcadoresSueltos({ 'tarea.md': '# Tarea {{ID}} — {{TITULO}}' }), [])
})

conValidador(
  'en seco aplica los reemplazos en memoria: ningún marcador suelto y nada escrito',
  () => {
    const s = semilla()
    const r = crear(s.dir, s.destino, {
      validador: VALIDADOR,
      raizProyectos: s.proyectos,
      enSeco: true,
    })
    assert.equal(r.marcadores_sueltos, 0)
    assert.ok(r.revisados > 100, `revisó ${r.revisados} archivos`)
    assert.ok(!existsSync(s.destino), 'en seco no escribe')
  },
)

conValidador('el bloque salta los que ya usan los manifiestos de la raíz', () => {
  const s = semilla()
  const opciones = { validador: VALIDADOR, raizProyectos: s.proyectos, enSeco: true }
  manifiestoSuelto(s.proyectos, 'otro', 5)
  assert.equal(crear(s.dir, s.destino, opciones).bloque, 6)
  // Un repo con puertos heredados (546xx) no ocupa ningún bloque; el segundo repo de otro proyecto, sí.
  manifiestoSuelto(s.proyectos, 'viejo', { heredado: true }, 6)
  assert.equal(crear(s.dir, s.destino, opciones).bloque, 7)
})

conValidador('un proyecto pide su bloque: si un manifiesto ya lo usa, se niega nombrándolo', () => {
  const s = semilla()
  const ajeno = manifiestoSuelto(s.proyectos, 'otro', 6)
  const opciones = { validador: VALIDADOR, raizProyectos: s.proyectos, enSeco: true }
  assert.equal(crear(s.dir, s.destino, { ...opciones, bloque: 7 }).bloque, 7)
  assert.throws(
    () => crear(s.dir, s.destino, { ...opciones, bloque: 6 }),
    (e) =>
      e.message.includes('bloque 6') && e.message.includes('otro-app') && e.message.includes(ajeno),
  )
})

conValidador('dos manifiestos con el mismo bloque: el generador falla nombrando los dos', () => {
  const s = semilla()
  const uno = manifiestoSuelto(s.proyectos, 'uno', 5)
  const dos = manifiestoSuelto(s.proyectos, 'dos', 5)
  for (const bloque of [undefined, 8])
    assert.throws(
      () =>
        crear(s.dir, s.destino, {
          validador: VALIDADOR,
          raizProyectos: s.proyectos,
          enSeco: true,
          bloque,
        }),
      (e) =>
        e.message.includes('mismo bloque') &&
        e.message.includes(uno) &&
        e.message.includes(dos) &&
        e.message.includes('uno-app') &&
        e.message.includes('dos-app'),
    )
})

conValidador('un manifiesto ajeno inválido corta nombrando el archivo y el campo', () => {
  const s = semilla()
  const roto = manifiestoSuelto(s.proyectos, 'roto', 5)
  writeFileSync(roto, readFileSync(roto, 'utf8').replace('esquema: proyecto/v1', 'esquema: otro'))
  assert.throws(
    () =>
      crear(s.dir, s.destino, { validador: VALIDADOR, raizProyectos: s.proyectos, enSeco: true }),
    (e) =>
      e.message.includes(roto) &&
      e.message.includes('esquema:') &&
      e.message.includes('--manifiesto'),
  )
})

conValidador(
  'el manifiesto del proyecto generado pasa el validador de manifiestos (si está)',
  (t) => {
    const validador = join(KIT, '../semillas/validar_semilla.py')
    if (!existsSync(validador)) return t.skip('no está ../semillas/validar_semilla.py')
    const s = semilla()
    crear(s.dir, s.destino, { validador: VALIDADOR, raizProyectos: s.proyectos, cuenta: 'Duena' })
    execFileSync(
      'python3',
      [validador, '--manifiesto', join(s.destino, '.proyecto/proyecto.yaml')],
      {
        stdio: 'pipe',
      },
    )
    assert.match(
      readFileSync(join(s.destino, '.proyecto/proyecto.yaml'), 'utf8'),
      /github: Duena\/turnos-app/,
    )
  },
)

conValidador('se niega: semilla que no valida, tokens fuera de contrato, destino ocupado', () => {
  const opciones = { validador: VALIDADOR, enSeco: true, raizProyectos: '/no/hay/raiz' }
  const s1 = semilla((f) => ({
    ...f,
    'semilla.md': f['semilla.md'].replace('(A1, F1)', '(A1, F1) etc.'),
  }))
  assert.throws(() => crear(s1.dir, s1.destino, opciones), /no pasa el validador[\s\S]*etc\./)
  const s2 = semilla((f) => ({
    ...f,
    'semilla.md': f['semilla.md'].replace(/--color-paper:/g, '--color-fondo:'),
  }))
  assert.throws(() => crear(s2.dir, s2.destino, opciones), /contrato del kit[\s\S]*--color-paper/)
  const s3 = semilla()
  mkdirSync(s3.destino, { recursive: true })
  writeFileSync(join(s3.destino, 'algo'), 'x')
  assert.throws(() => crear(s3.dir, s3.destino, opciones), /ya existe y no está vacía/)
})

if (!VALIDADOR)
  console.log(
    '# aviso: sin validar_semilla.py (KIT_VALIDADOR): se saltan las pruebas de punta a punta',
  )
