import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// motivo_ci vive en orquestador.sh, que al cargarse arranca el bucle: se toma su definición tal cual y `ghr` (el log de un run) se
// reemplaza por uno que devuelve un log fijo.
const definicion =
  readFileSync(resolve('scripts/orquestador/orquestador.sh'), 'utf8').match(
    /^motivo_ci\(\) \{[\s\S]*?^\}$/m,
  )?.[0] ?? ''

const motivo = (pr: number, checks: object[]) => {
  const r = spawnSync(
    'bash',
    [
      '-c',
      `ghr() { echo 'Error: algo se rompió'; }\n${definicion}\nmotivo_ci "$1" "$2"`,
      'bash',
      String(pr),
      JSON.stringify({ statusCheckRollup: checks }),
    ],
    { encoding: 'utf8' },
  )
  expect(r.status).toBe(0)
  return r.stdout
}

const check = (name: string, conclusion: string, run = 77) => ({
  __typename: 'CheckRun',
  name,
  conclusion,
  detailsUrl: `https://github.com/o/r/actions/runs/${run}/job/1`,
})

describe('motivo_ci: lo que lee la sesión de arreglo y lo que dicen el log y el aviso', () => {
  it('la primera línea nombra los jobs caídos, sin el agregador «Listo»', () => {
    const salida = motivo(9, [
      check('e2e · bloque 2 de 4', 'FAILURE'),
      check('Base', 'CANCELLED'),
      check('Listo', 'FAILURE'),
      check('Lint', 'SUCCESS'),
    ])
    expect(salida.split('\n')[0]).toBe('El CI del PR #9 cayó: e2e · bloque 2 de 4, Base.')
    expect(salida).toContain('- Base (CANCELLED): ')
    expect(salida).not.toContain('Listo')
    expect(salida).not.toContain('Lint')
    expect(salida).toContain('Error: algo se rompió')
  })

  it('con sólo el agregador en rojo, la primera línea lo dice en vez de quedar vacía', () => {
    const salida = motivo(9, [check('Listo', 'FAILURE')])
    expect(salida.split('\n')[0]).toBe(
      'El CI del PR #9 cayó: ningún job en rojo a la vista (sólo el agregador).',
    )
  })
})
