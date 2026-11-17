import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

// `estado.sh` dice en pocas líneas cómo está el flujo (docs/FLUJO.md). Nunca frena: sin `gh`, o si GitHub no responde, dice lo local y
// sale con 0. Con un PR abierto en rojo o una noche caída, lo marca con ✗ y dice cómo verlo. Se prueba con un `gh` falso. El guion se
// ubica por su propia carpeta: se copia al repo temporal (fuera de lo que git ve) y se corre desde ahí, como en un proyecto.
const GUION_DEL_KIT = resolve('scripts/flujo/estado.sh')
const raices: string[] = []
let raiz = ''
let repo = ''

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'estado-'))
  raices.push(raiz)
  repo = join(raiz, 'repo')
  mkdirSync(join(raiz, 'bin'))
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  mkdirSync(join(repo, 'scripts/flujo'), { recursive: true })
  copyFileSync(GUION_DEL_KIT, join(repo, 'scripts/flujo/estado.sh'))
  writeFileSync(join(repo, '.git/info/exclude'), 'scripts/\n')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
})
afterAll(() => {
  for (const r of raices) rmSync(r, { recursive: true, force: true })
})

function gh(cuerpo: string) {
  writeFileSync(join(raiz, 'bin', 'gh'), `#!/usr/bin/env bash\n${cuerpo}\n`)
  chmodSync(join(raiz, 'bin', 'gh'), 0o755)
}

function estado(cwd = repo) {
  const r = spawnSync('bash', [join(repo, 'scripts/flujo/estado.sh')], {
    cwd,
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      HOME: raiz,
      PATH: `${join(raiz, 'bin')}:${process.env['PATH'] ?? ''}`,
    },
  })
  return { estado: r.status, salida: r.stdout }
}

describe('estado.sh', () => {
  it('corrido desde fuera del repo (proyectos/) mira el repo del guion', () => {
    gh('exit 1')
    const r = estado(raiz)
    expect(r.estado).toBe(0)
    expect(r.salida).toContain('· rama main, 1 archivos sin commitear')
  })

  it('si GitHub no responde dice lo local y no frena', () => {
    gh('exit 1')
    const r = estado()
    expect(r.estado).toBe(0)
    expect(r.salida).toContain('· rama main, 1 archivos sin commitear')
    expect(r.salida).toContain('GitHub no respondió')
  })

  it('sin PR abiertos lo dice, con el último CI de main y la noche', () => {
    gh(`case "$1 $2" in
  "auth token") exit 1 ;;
  "pr list") echo '[]' ;;
  "run list")
    case "$*" in
      *schedule*) echo '[{"conclusion":"failure","createdAt":"2026-11-13T07:00:00Z","databaseId":7,"headSha":"abcdef0123"}]' ;;
      *) echo '[{"conclusion":"success","createdAt":"2026-11-13T20:00:00Z","databaseId":9,"headSha":"0123456789"}]' ;;
    esac ;;
esac`)
    const r = estado()
    expect(r.estado).toBe(0)
    expect(r.salida).toContain('✓ sin PR abiertos')
    expect(r.salida).toContain('✓ CI de main (01234567, 2026-11-13T20:00:00Z)')
    expect(r.salida).toContain('✗ e2e completo de la noche (abcdef01, 2026-11-13T07:00:00Z)')
    expect(r.salida).toContain('gh run view 7 --log-failed')
  })

  it('nombra las ramas locales sin worktree y los cambios apartados que dejó otra sesión', () => {
    gh('exit 1')
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=a', '-c', 'user.email=a@a.a', ...args], { cwd: repo })
    git('add', '.')
    git('commit', '-q', '-m', 'a')
    expect(estado().salida).not.toMatch(/ramas locales|apartados/)
    git('branch', 'feat/a-medias')
    writeFileSync(join(repo, 'a.txt'), 'b\n')
    git('stash', '-q')
    const r = estado()
    expect(r.estado).toBe(0)
    expect(r.salida).toContain('· ramas locales sin worktree: feat/a-medias')
    expect(r.salida).toContain('· 1 cambios apartados (git stash list)')
  })

  it('un issue noche-roja abierto va marcado con sus noches y si ya está en la cola', () => {
    gh(`case "$1 $2" in
  "auth token") exit 1 ;;
  "pr list") echo '[]' ;;
  "run list") echo '[]' ;;
  "issue list")
    [[ "$*" == *"--label noche-roja"* ]] || exit 1
    echo '[{"number":9,"body":"\`\`\`yaml\\ntitulo: x\\n\`\`\`\\n<!-- noches: 2 -->\\n","labels":[{"name":"noche-roja"},{"name":"cola"}]},{"number":12,"body":"<!-- noches: 1 -->","labels":[{"name":"noche-roja"}]}]' ;;
esac`)
    const r = estado()
    expect(r.estado).toBe(0)
    expect(r.salida).toContain('✗ issue #9 «e2e de la noche en rojo» (2 noches; ya en la cola)')
    expect(r.salida).toContain(
      '✗ issue #12 «e2e de la noche en rojo» (1 noche; si cae otra noche, pasa a la cola)',
    )
  })

  it('un PR abierto con «Listo» en rojo va marcado: se arregla o se cierra antes que lo nuevo', () => {
    gh(`case "$1 $2" in
  "auth token") exit 1 ;;
  "pr list") echo '[{"number":12,"title":"fix(leads): algo","headRefName":"fix/algo","statusCheckRollup":[{"__typename":"CheckRun","name":"Listo · todo en verde","conclusion":"FAILURE"}]}]' ;;
  "run list") echo '[]' ;;
esac`)
    const r = estado()
    expect(r.estado).toBe(0)
    expect(r.salida).toContain('✗ PR #12 abierto (fix/algo): fix(leads): algo — CI en rojo')
  })
})

describe('estado.sh › la cuenta del manifiesto', () => {
  const manifiesto = `esquema: proyecto/v1
proyecto: tienda
nombre: Tienda
semilla: null
repos:
  - { rol: app, nombre: tienda-app, github: CuentaDelManifiesto/tienda-app, etapa: construccion, semilla: null, puertos: { bloque: 6 } }
contratos: []
`
  function conManifiesto(texto: string) {
    mkdirSync(join(repo, '.proyecto'))
    writeFileSync(join(repo, '.proyecto/proyecto.yaml'), texto)
    // scripts/ está excluido de git en estas pruebas: el manifiesto y su lector se copian al lado del guion.
    mkdirSync(join(repo, 'scripts/proyecto'), { recursive: true })
    copyFileSync(
      resolve('scripts/proyecto/manifiesto.mjs'),
      join(repo, 'scripts/proyecto/manifiesto.mjs'),
    )
    symlinkSync(resolve('node_modules'), join(repo, 'node_modules'))
    writeFileSync(join(repo, '.git/info/exclude'), 'scripts/\n.proyecto/\nnode_modules\n')
  }
  const pideToken = (cuerpo = '') =>
    gh(
      `echo "gh $*" >> "${join(raiz, 'llamadas.txt')}"\ncase "$1 $2" in "auth token") exit 1 ;; esac\n${cuerpo}\nexit 1`,
    )
  const llamadas = () => readFileSync(join(raiz, 'llamadas.txt'), 'utf8')

  it('pide el token de la cuenta del manifiesto', () => {
    conManifiesto(manifiesto)
    pideToken()
    expect(estado().estado).toBe(0)
    expect(llamadas()).toContain('gh auth token --user CuentaDelManifiesto')
  })

  it('con un manifiesto ilegible no frena: cae al remoto y sigue diciendo lo local', () => {
    conManifiesto('esquema: v0\n')
    pideToken()
    const r = estado()
    expect(r.estado).toBe(0)
    expect(r.salida).toContain('· rama main')
  })
})
