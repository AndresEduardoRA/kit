import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

// La CLI del aviso de la noche (noche.mjs) como la corre el job aviso-noche de ci.yml: con el `gh` falso del orquestador
// (scripts/orquestador/prueba/gh-falso.mjs) primero en el PATH, un «GitHub» en un JSON y los artefactos de la corrida en una carpeta.
const NOCHE = resolve('scripts/flujo/noche.mjs')
const GH_FALSO = resolve('scripts/orquestador/prueba/gh-falso.mjs')
const raices: string[] = []
let raiz = ''

type Issue = {
  number: number
  title: string
  body: string
  labels: string[]
  state: string
  state_reason?: string
  comentarios: { body: string }[]
}
type Gh = {
  issues: Record<string, Issue>
  etiquetas: string[]
  corridas?: Record<string, unknown[]>
}

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'noche-'))
  raices.push(raiz)
  mkdirSync(join(raiz, 'bin'))
  writeFileSync(join(raiz, 'bin/gh'), `#!/usr/bin/env bash\nexec node ${GH_FALSO} "$@"\n`, {
    mode: 0o755,
  })
  const inicial = {
    repo: 'Cuenta/tienda-app',
    siguiente: 5,
    siguienteComentario: 1000,
    issues: {},
    etiquetas: ['bug'],
    prs: {},
    cuentas: [],
  }
  writeFileSync(join(raiz, 'estado.json'), JSON.stringify(inicial))
})
afterAll(() => {
  for (const r of raices) rmSync(r, { recursive: true, force: true })
})

const gh = (): Gh => JSON.parse(readFileSync(join(raiz, 'estado.json'), 'utf8')) as Gh
const cambiarGh = (f: (g: Gh) => void) => {
  const g = gh()
  f(g)
  writeFileSync(join(raiz, 'estado.json'), JSON.stringify(g))
}
const llamadas = () =>
  existsSync(join(raiz, 'llamadas.log'))
    ? readFileSync(join(raiz, 'llamadas.log'), 'utf8').trim().split('\n')
    : []

// Los artefactos de una corrida: el bloque 1 dejó su caidos.txt (el reporter de fallos).
function artefactos(...caidos: string[]) {
  const dir = mkdtempSync(join(raiz, 'fallos-'))
  const carpeta = join(dir, 'e2e-bloque-1-intento-1/e2e-fallos/2026-11-16_07-30')
  mkdirSync(carpeta, { recursive: true })
  writeFileSync(join(carpeta, 'caidos.txt'), caidos.map((c) => `${c}\n`).join(''))
  return dir
}
const CAIDO = 'e2e/leads.spec.ts:40 › E2E escritorio agrega un lead (escritorio)'
const NECESIDADES = {
  rojo: {
    cambios: { result: 'success' },
    'e2e-build': { result: 'success' },
    e2e: { result: 'failure' },
  },
  verde: {
    cambios: { result: 'success' },
    'e2e-build': { result: 'success' },
    e2e: { result: 'success' },
  },
  nada: {
    cambios: { result: 'success' },
    'e2e-build': { result: 'skipped' },
    e2e: { result: 'skipped' },
  },
}

function noche(resultado: keyof typeof NECESIDADES, corrida: string, fallos = '') {
  const r = spawnSync('node', [NOCHE], {
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${join(raiz, 'bin')}:${process.env['PATH'] ?? ''}`,
      GH_FALSO: raiz,
      NECESIDADES: JSON.stringify(NECESIDADES[resultado]),
      FALLOS: fallos,
      GITHUB_REPOSITORY: 'Cuenta/tienda-app',
      GITHUB_RUN_ID: corrida,
      GITHUB_SERVER_URL: 'https://github.com',
    },
  })
  expect(r.status, r.stderr).toBe(0)
  return r.stdout
}
const enlace = (corrida: string) => `https://github.com/Cuenta/tienda-app/actions/runs/${corrida}`

describe('noche.mjs con un gh falso', () => {
  it('primera noche, segunda, la misma corrida otra vez y una tercera ya en la cola', () => {
    noche('rojo', '11', artefactos(CAIDO))
    let i = gh().issues[5]!
    expect(i.title).toBe('e2e de la noche en rojo')
    expect(i.labels).toEqual(['noche-roja'])
    expect(i.body).toContain(`- ${CAIDO}`)
    expect(i.body).toContain(enlace('11'))
    expect(i.body).toContain('<!-- noches: 1 -->')
    expect(gh().etiquetas).toContain('noche-roja')

    noche('rojo', '12', artefactos(CAIDO))
    i = gh().issues[5]!
    expect(i.body).toMatch(/^```yaml\n[\s\S]*\nrama: fix\/e2e-noche-5\n/)
    expect(i.body).toContain('<!-- noches: 2 -->')
    expect(i.body).toContain(enlace('11'))
    expect(i.body).toContain(enlace('12'))
    expect(i.labels).toEqual(['noche-roja', 'cola', 'cola:urgente'])
    expect(gh().etiquetas).toEqual(expect.arrayContaining(['cola', 'cola:urgente']))
    expect(i.comentarios).toHaveLength(1)
    expect(i.comentarios[0]!.body).toContain('Pasa a la cola como tarea urgente')

    const antes = JSON.stringify(gh().issues)
    noche('rojo', '12', artefactos(CAIDO))
    expect(JSON.stringify(gh().issues)).toBe(antes)

    noche('rojo', '13', artefactos(CAIDO))
    i = gh().issues[5]!
    expect(JSON.stringify(i.body)).toBe(JSON.stringify(JSON.parse(antes)['5'].body))
    expect(i.comentarios).toHaveLength(2)
    expect(i.comentarios[1]!.body).toContain('La tarea ya está en la cola')
  })

  it('verde: cierra el que no está en la cola (completed) y no toca el que está', () => {
    noche('rojo', '11', artefactos(CAIDO))
    cambiarGh((g) => {
      g.issues[6] = { ...g.issues[5]!, number: 6, labels: ['noche-roja', 'cola'], comentarios: [] }
    })
    noche('verde', '12')
    const g = gh()
    expect(g.issues[5]!.state).toBe('closed')
    expect(g.issues[5]!.state_reason).toBe('completed')
    expect(g.issues[5]!.comentarios.at(-1)!.body).toContain('salió verde')
    expect(g.issues[6]!.state).toBe('open')
    expect(g.issues[6]!.comentarios).toEqual([])
  })

  it('dos noche-roja abiertos: la noche va al más viejo y el otro recibe un solo aviso', () => {
    noche('rojo', '11', artefactos(CAIDO))
    cambiarGh((g) => {
      g.issues[8] = { ...g.issues[5]!, number: 8, comentarios: [] }
    })
    noche('rojo', '12', artefactos(CAIDO))
    noche('rojo', '13', artefactos(CAIDO))
    const g = gh()
    expect(g.issues[5]!.body).toContain(enlace('12'))
    expect(g.issues[8]!.body).not.toContain(enlace('12'))
    expect(g.issues[8]!.comentarios).toHaveLength(1)
    expect(g.issues[8]!.comentarios[0]!.body).toContain('más viejo (#5)')
  })

  it('sin artefactos: los jobs caídos de la corrida; si esa API falla, las claves de needs en rojo', () => {
    cambiarGh((g) => {
      g.corridas = {
        '11': [
          { name: 'e2e · bloque 2 de 4', conclusion: 'failure' },
          { name: 'Nivel 1 · lint, tipos, test:kit y mapa', conclusion: 'success' },
        ],
      }
    })
    noche('rojo', '11', join(raiz, 'no-existe'))
    expect(gh().issues[5]!.body).toContain('- job «e2e · bloque 2 de 4»')
    expect(gh().issues[5]!.body).not.toContain('Nivel 1')
    noche('rojo', '12')
    expect(gh().issues[5]!.body).toContain('- job e2e (de needs')
  })

  it('una noche sin e2e (sin commits, o el kit) no llama a la API', () => {
    expect(noche('nada', '11')).toContain('nada que avisar')
    expect(llamadas()).toEqual([])
  })
})
