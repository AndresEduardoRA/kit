import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// `scripts/ci-cambios.sh` decide si CI corre la base y el e2e (job `cambios` de `.github/workflows/ci.yml`). Se prueba contra
// repos de git de verdad, en una carpeta temporal: un commit sólo de docs, uno de código, sin commit de comparación, con uno que
// el clon no tiene y con un clon superficial, que es lo que pasaría sin `fetch-depth: 0`.
const SCRIPT = resolve('scripts/ci-cambios.sh')
const CEROS = '0'.repeat(40)

let raiz = ''
let repo = ''
const commits: Record<string, string> = {}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=ci', '-c', 'user.email=ci@ejemplo.test', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim()
}

function commitear(nombre: string, archivos: string[]) {
  for (const archivo of archivos) {
    mkdirSync(dirname(join(repo, archivo)), { recursive: true })
    writeFileSync(join(repo, archivo), `${nombre}\n`)
  }
  git(repo, 'add', '--', ...archivos)
  git(repo, 'commit', '-q', '-m', nombre)
  commits[nombre] = git(repo, 'rev-parse', 'HEAD')
}

function correr(cwd: string, entorno: Record<string, string>, hasta: string) {
  const r = spawnSync('bash', [SCRIPT], {
    cwd,
    encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: process.env['PATH'] ?? '', DESPUES: hasta, ...entorno },
  })
  const salida = Object.fromEntries(
    r.stdout
      .trim()
      .split('\n')
      .map((l) => l.split('=')),
  )
  return { salida, motivo: r.stderr }
}

const decidir = (cwd: string, entorno: Record<string, string>, hasta: string) =>
  correr(cwd, entorno, hasta).salida

// Las cuatro salidas: nada pesado, o todo (los caminos de «ante la duda» y la noche: los de contratos valen lo que `pesado`).
const NADA = { pesado: 'false', e2e: 'false', contrato: 'false', contrato_uso: 'false' }
const TODO = { pesado: 'true', e2e: 'true', contrato: 'true', contrato_uso: 'true' }

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), 'ci-cambios-'))
  repo = join(raiz, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  commitear('inicio', ['README.md'])
  commitear('docs', ['docs/ESTADO.md', 'docs/package.json'])
  commitear('codigo', ['src/app/page.tsx'])
  commitear('lockfile', ['pnpm-lock.yaml'])
  commitear('workflow', ['.github/workflows/ci.yml'])
})

afterAll(() => {
  rmSync(raiz, { recursive: true, force: true })
})

describe('ci-cambios.sh', () => {
  const push = (desde: string, hasta: string, cwd = repo) =>
    decidir(cwd, { EVENTO: 'push', ANTES: commits[desde] ?? desde }, commits[hasta] ?? hasta)

  it('un push sólo de docs (aunque haya un package.json adentro) no corre lo pesado', () => {
    expect(push('inicio', 'docs')).toEqual(NADA)
  })

  it('un push con src/ corre la base y no el e2e', () => {
    expect(push('docs', 'codigo')).toEqual({ ...NADA, pesado: 'true' })
  })

  it.each(['lockfile', 'workflow'])('un push con %s también es pesado', (commit) => {
    const antes = commit === 'lockfile' ? 'codigo' : 'lockfile'
    expect(push(antes, commit).pesado).toBe('true')
  })

  it('un PR con código corre todo; uno sólo de docs, nada pesado', () => {
    expect(
      decidir(
        repo,
        { EVENTO: 'pull_request', BASE_PR: commits['docs'] ?? '' },
        commits['codigo'] ?? '',
      ),
    ).toEqual({ ...NADA, pesado: 'true', e2e: 'true' })
    expect(
      decidir(
        repo,
        { EVENTO: 'pull_request', BASE_PR: commits['inicio'] ?? '' },
        commits['docs'] ?? '',
      ),
    ).toEqual(NADA)
  })

  it('workflow_dispatch corre todo', () => {
    expect(decidir(repo, { EVENTO: 'workflow_dispatch' }, 'HEAD')).toEqual(TODO)
  })

  it('sin commit de comparación (rama nueva) o con uno desconocido (push forzado), todo es pesado y dice por qué', () => {
    const conMotivo = (antes: string) =>
      correr(repo, { EVENTO: 'push', ANTES: antes }, commits['docs'] ?? '')
    expect(conMotivo(CEROS)).toEqual({
      salida: { ...TODO, e2e: 'false' },
      motivo: expect.stringContaining('sin commit de comparación') as string,
    })
    expect(conMotivo('').motivo).toContain('sin commit de comparación')
    expect(conMotivo('1234567890abcdef1234567890abcdef12345678')).toEqual({
      salida: { ...TODO, e2e: 'false' },
      motivo: expect.stringContaining('el clon no tiene 1234567890ab') as string,
    })
  })

  it('mira todo el rango del push, no sólo el último commit', () => {
    commitear('codigo-2', ['src/app/layout.tsx'])
    commitear('docs-3', ['docs/PLAN.md'])
    expect(push('workflow', 'docs-3').pesado).toBe('true')
    expect(push('codigo-2', 'docs-3').pesado).toBe('false')
  })

  it('con un clon superficial el commit anterior no está y todo cae a pesado; con la historia entera, no', () => {
    // Un push sólo de docs encima de lo último; el checkout trae sólo ese commit (como `fetch-depth: 1`) o la historia entera.
    commitear('docs-2', ['docs/BITACORA.md'])
    const superficial = join(raiz, 'superficial')
    git(raiz, 'clone', '-q', '--depth', '1', '--branch', 'main', `file://${repo}`, superficial)
    const completo = join(raiz, 'completo')
    git(raiz, 'clone', '-q', '--branch', 'main', `file://${repo}`, completo)
    const hasta = commits['docs-2'] ?? ''
    expect(
      decidir(superficial, { EVENTO: 'push', ANTES: commits['docs-3'] ?? '' }, hasta).pesado,
    ).toBe('true')
    expect(decidir(completo, { EVENTO: 'push', ANTES: commits['docs-3'] ?? '' }, hasta)).toEqual(
      NADA,
    )
  })
})

// El completo de cada noche (`schedule` en ci.yml) sólo corre si main se movió.
describe('ci-cambios.sh › la noche', () => {
  it('la noche (schedule) corre todo si main tuvo commits en las últimas 25 h; si no, nada', () => {
    expect(decidir(repo, { EVENTO: 'schedule' }, 'HEAD')).toEqual(TODO)
    const quieto = join(raiz, 'quieto')
    mkdirSync(quieto)
    git(quieto, 'init', '-q', '-b', 'main')
    writeFileSync(join(quieto, 'README.md'), 'x\n')
    git(quieto, 'add', '.')
    execFileSync(
      'git',
      ['-c', 'user.name=ci', '-c', 'user.email=ci@ejemplo.test', 'commit', '-q', '-m', 'viejo'],
      {
        cwd: quieto,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
          GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
        },
      },
    )
    const r = correr(quieto, { EVENTO: 'schedule' }, 'HEAD')
    expect(r.salida).toEqual(NADA)
    expect(r.motivo).toContain('no tuvo commits')
  })
})

// Los jobs de contratos (.claude/rules/contratos.md): `contrato` (el proveedor) y `contrato-uso` (el consumidor), cada uno por lo suyo.
describe('ci-cambios.sh › los contratos', () => {
  // Un PR de un solo commit encima de lo último: el rango es ese commit.
  const pr = (nombre: string, archivos: string[]) => {
    const antes = git(repo, 'rev-parse', 'HEAD')
    commitear(nombre, archivos)
    return decidir(repo, { EVENTO: 'pull_request', BASE_PR: antes }, commits[nombre] ?? '')
  }

  it('sólo una versión de contrato: corre el proveedor, no lo pesado', () => {
    expect(pr('version', ['contratos/agenda@1.json'])).toEqual({ ...NADA, contrato: 'true' })
  })

  it('una migración: lo pesado y el proveedor', () => {
    expect(pr('migracion', ['supabase/migrations/20261116000000_x.sql'])).toEqual({
      ...NADA,
      pesado: 'true',
      e2e: 'true',
      contrato: 'true',
    })
  })

  it('un infra/ o los tipos de un contrato: el consumidor', () => {
    expect(pr('infra', ['src/modules/turnos/infra/agenda.ts'])).toMatchObject({
      contrato: 'false',
      contrato_uso: 'true',
    })
    expect(pr('tipos', ['src/shared/types/contratos/agenda.ts']).contrato_uso).toBe('true')
  })

  it('una copia fijada: el consumidor; el manifiesto: los dos; los scripts de contratos: los dos', () => {
    expect(pr('copia', ['.proyecto/contratos/agenda@1.json'])).toEqual({
      ...NADA,
      contrato_uso: 'true',
    })
    expect(pr('manifiesto', ['.proyecto/proyecto.yaml'])).toEqual({
      ...NADA,
      contrato: 'true',
      contrato_uso: 'true',
    })
    expect(pr('scripts', ['scripts/contratos/usar.ts'])).toMatchObject({
      contrato: 'true',
      contrato_uso: 'true',
    })
  })

  it('lo que los dos jobs corren (dependencias, CI): los dos; la pila o el candado: el proveedor', () => {
    expect(pr('deps', ['package.json'])).toMatchObject({ contrato: 'true', contrato_uso: 'true' })
    expect(pr('pila', ['scripts/lib/stack-local.mjs'])).toMatchObject({
      contrato: 'true',
      contrato_uso: 'false',
    })
  })

  it('mover un archivo fuera de infra/ también toca infra/ (sin detección de renombres)', () => {
    commitear('a-mover', ['src/modules/mover/infra/lector.ts'])
    mkdirSync(join(repo, 'src/modules/mover/features'), { recursive: true })
    git(repo, 'mv', 'src/modules/mover/infra/lector.ts', 'src/modules/mover/features/lector.ts')
    const antes = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'commit', '-q', '-m', 'mover')
    const salida = decidir(repo, { EVENTO: 'pull_request', BASE_PR: antes }, 'HEAD')
    expect(salida.contrato_uso).toBe('true')
  })

  it('sólo docs: ninguno; otro src/ que no es infra/: ninguno', () => {
    expect(pr('docs-c', ['docs/KIT.md'])).toEqual(NADA)
    expect(pr('features', ['src/modules/turnos/features/x/accion.ts'])).toMatchObject({
      contrato: 'false',
      contrato_uso: 'false',
    })
  })
})
