import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// La única excepción de `bloquear-peligrosos.sh` a «ninguna sesión empuja main»: el primer push de main de un repo recién creado por
// semilla-a-repo, a un `origin` que existe y todavía no tiene main. Va en su archivo porque bloquear-peligrosos.casos.ts roza el tope
// de líneas. Repos temporales: NUEVO (origin vacío), PUBLICADO (origin ya con main) y SINREMOTO.
const HOOK = resolve('.claude/hooks/bloquear-peligrosos.sh')

let raiz = ''
let nuevo = ''
let publicado = ''
let sinRemoto = ''
let conPushUrl = ''

function git(cwd: string, ...args: string[]) {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@ejemplo.test', ...args], {
    cwd,
    stdio: 'ignore',
  })
}

/** Un repo en main con un commit y, si se pide, un remoto bare (vacío, o con main ya publicado). */
function repo(nombre: string, remoto: 'vacio' | 'con-main' | null): string {
  const dir = join(raiz, nombre)
  mkdirSync(dir)
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'README.md'), 'x\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'inicio')
  if (remoto) {
    const bare = join(raiz, `${nombre}.git`)
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
    git(dir, 'remote', 'add', 'origin', bare)
    if (remoto === 'con-main') git(dir, 'push', '-q', 'origin', 'main')
  }
  return dir
}

function correr(command: string, cwd = raiz) {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }),
    encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: process.env['PATH'] ?? '' },
  })
  return { estado: r.status, motivo: r.stderr }
}

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), 'primer-push-'))
  nuevo = repo('nuevo', 'vacio')
  publicado = repo('publicado', 'con-main')
  sinRemoto = repo('sin-remoto', null)
  // origin sin main, pero su URL de push va a un remoto que ya lo tiene.
  conPushUrl = repo('con-push-url', 'vacio')
  git(conPushUrl, 'remote', 'set-url', '--push', 'origin', join(raiz, 'publicado.git'))
})

afterAll(() => {
  rmSync(raiz, { recursive: true, force: true })
})

describe('el primer push de main de un repo nuevo', () => {
  it.each(['git -C NUEVO push -u origin main', 'git -C NUEVO push origin main'])(
    'pasa: %s',
    (comando) => {
      expect(correr(comando.replace('NUEVO', nuevo)).estado).toBe(0)
    },
  )

  it('pasa también con la carpeta como cwd y sin -C', () => {
    expect(correr('git push --set-upstream origin main', nuevo).estado).toBe(0)
  })

  it.each([
    ['main ya publicado', 'git -C PUBLICADO push -u origin main'],
    ['forzado', 'git -C NUEVO push --force origin main'],
    ['a otra rama remota', 'git -C NUEVO push origin main:otra'],
    ['a otro remoto', 'git -C NUEVO push otro main'],
    ['sin remoto', 'git -C SINREMOTO push -u origin main'],
    ['junto a un cd', 'cd NUEVO && git push -u origin main'],
    ['con otra opción', 'git -C NUEVO push --dry-run origin main'],
    ['sin nombrar la rama', 'git -C NUEVO push -u origin'],
    [
      'con una variable GIT_ que cambia el repo',
      'GIT_DIR=PUBLICADO/.git git -C NUEVO push origin main',
    ],
    ['con git -c', 'git -c remote.origin.pushurl=PUBLICADO -C NUEVO push origin main'],
    ['con dos -C', 'git -C PUBLICADO -C NUEVO push origin main'],
    ['con una URL de push distinta', 'git -C CONPUSHURL push -u origin main'],
  ])('bloquea: %s', (_caso, comando) => {
    const real = comando
      .replace('CONPUSHURL', conPushUrl)
      .replace('PUBLICADO', publicado)
      .replace('SINREMOTO', sinRemoto)
      .replace('NUEVO', nuevo)
    const { estado, motivo } = correr(real)
    expect({ estado, motivo: motivo.trim().length > 0 }).toEqual({ estado: 2, motivo: true })
  })
})
