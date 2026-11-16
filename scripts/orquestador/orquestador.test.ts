import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

// La cola del orquestador (scripts/orquestador/README.md): `nueva` copia la plantilla y lo que deja tiene que ser una spec que el
// bucle lea. Se prueba con el guion y la plantilla reales sobre una carpeta de datos temporal (`ORQ_DATOS`): si un formateador
// vuelve a tocar los marcadores `{{X}}` de la plantilla, cae aquí y no al lanzar una tanda.
const GUION = resolve('scripts/orquestador/orquestador.sh')
const raices: string[] = []
let datos = ''

beforeEach(() => {
  datos = mkdtempSync(join(tmpdir(), 'orquestador-'))
  raices.push(datos)
})
afterAll(() => {
  for (const r of raices) rmSync(r, { recursive: true, force: true })
})

function orquestador(...args: string[]) {
  const r = spawnSync('bash', [GUION, ...args], {
    encoding: 'utf8',
    env: { NODE_ENV: 'test', HOME: datos, PATH: process.env['PATH'] ?? '', ORQ_DATOS: datos },
  })
  return { estado: r.status, salida: r.stdout + r.stderr }
}

describe('orquestador.sh: la cola', () => {
  it('«nueva» deja una spec en borrador con su id y su rama, sin marcadores', () => {
    expect(orquestador('nueva', 'T07', 'avisos-nuevos').estado).toBe(0)
    const spec = readFileSync(join(datos, 'cola', 'T07-avisos-nuevos.md'), 'utf8')
    expect(spec).toContain('\nid: T07\n')
    expect(spec).toContain('\nrama: feat/avisos-nuevos\n')
    expect(spec).not.toContain('{{')
    expect(orquestador('plan').salida).toContain('T07  borrador')
  })

  it('sin «borrador: si» la tarea queda lista para lanzar', () => {
    orquestador('nueva', 'T07', 'avisos-nuevos')
    const ruta = join(datos, 'cola', 'T07-avisos-nuevos.md')
    writeFileSync(ruta, readFileSync(ruta, 'utf8').replace('borrador: si\n', ''))
    const plan = orquestador('plan')
    expect(plan.salida).toContain('T07  LISTA para lanzar')
    expect(plan.salida).not.toContain('✗')
    expect(orquestador('estado').salida).toMatch(/T07\s+pendiente/)
  })

  it('«nueva» rechaza un id o un tema mal escritos y un id que ya existe', () => {
    expect(orquestador('nueva', '7', 'tema').estado).toBe(64)
    expect(orquestador('nueva', 'T07', 'Tema_Mal').estado).toBe(64)
    orquestador('nueva', 'T07', 'uno')
    expect(orquestador('nueva', 'T07', 'dos').estado).toBe(64)
  })

  it('una spec con el id dañado o repetido no se lanza y se nombra', () => {
    orquestador('nueva', 'T07', 'uno')
    writeFileSync(
      join(datos, 'cola', 'T08-rota.md'),
      '---\nid: { { ID } }\ntitulo: x\nrama: feat/x\n---\n',
    )
    writeFileSync(
      join(datos, 'cola', 'T09-otra.md'),
      '---\nid: T07\ntitulo: x\nrama: feat/y\n---\n',
    )
    const plan = orquestador('plan').salida
    expect(plan).toContain('✗ T08-rota.md')
    expect(plan).toContain('✗ T09-otra.md')
    expect(plan.match(/^T\d+ {2}/gm)).toEqual(['T07  '])
  })
})
