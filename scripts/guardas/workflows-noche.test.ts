import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { jobsDe, problemasDelWorkflow } from './workflows'

// El aviso de la noche (ci.yml › aviso-noche, scripts/flujo/noche.mjs): corre después del e2e completo de cada noche y es el único job
// con un permiso de escritura, `issues: write`. La guarda (workflows.ts) lo admite sólo en ese job y con un `if:` que no corre fuera de
// `schedule`; cada mutación de abajo rompe eso en el ci.yml real y tiene que caer. Las demás reglas del CI: workflows.test.ts.
const CI = '.github/workflows/ci.yml'
const ci = readFileSync(CI, 'utf8')
const job = (nombre: string) => jobsDe(ci).find((j) => j.nombre === nombre)?.bloque ?? ''

function mutar(texto: string, antes: string | RegExp, despues: string): string {
  const mutado = texto.replace(antes, despues)
  expect(mutado, `la mutación no encontró ${String(antes)}`).not.toBe(texto)
  return mutado
}

describe('ci.yml › el aviso de la noche', () => {
  it('espera al e2e de la noche, le pasa su needs y los artefactos de los bloques, y corre noche.mjs', () => {
    const aviso = job('aviso-noche')
    expect(aviso).toMatch(/^ {4}needs: \[cambios, e2e-build, e2e\]$/m)
    expect(aviso).toMatch(
      /^ {4}if: always\(\) && github\.event_name == 'schedule' && needs\.cambios\.outputs\.plantilla != 'true'$/m,
    )
    expect(aviso).toContain('NECESIDADES: ${{ toJSON(needs) }}')
    expect(aviso).toContain('GH_TOKEN: ${{ github.token }}')
    expect(aviso).toContain('pattern: e2e-bloque-*')
    expect(aviso).toContain('run: node scripts/flujo/noche.mjs')
    // Sin pnpm install: noche.mjs sólo usa node y gh.
    expect(aviso).not.toContain('./.github/acciones/preparar')
  })

  it('pide sólo lo que usa: leer el repo y la corrida, escribir issues', () => {
    expect(job('aviso-noche')).toMatch(
      /^ {4}permissions:\n {6}contents: read\n {6}actions: read\n {6}issues: write\n/m,
    )
  })

  it('el ci.yml real cumple con la excepción', () => {
    expect(problemasDelWorkflow(ci, CI)).toEqual([])
  })
})

describe('ci.yml › las mutaciones del aviso de la noche caen con «un permiso de escritura»', () => {
  const SI =
    "if: always() && github.event_name == 'schedule' && needs.cambios.outputs.plantilla != 'true'"
  it.each([
    ['el if deja de exigir schedule', SI, 'if: always()'],
    ['el if se abre a los PR', SI, `${SI} || github.event_name == 'pull_request'`],
    ['escribe PR en vez de issues', '      issues: write', '      pull-requests: write'],
    ['escribe el repo', /^ {6}contents: read$/m, '      contents: write'],
    [
      'issues: write en otro job',
      /(\n {2}cambios:\n(?: {4}.*\n)*? {4}timeout-minutes: 5\n)/,
      '$1    permissions:\n      issues: write\n',
    ],
  ])('%s', (_, antes, despues) => {
    expect(problemasDelWorkflow(mutar(ci, antes, despues), CI).join('\n')).toMatch(
      /un permiso de escritura/,
    )
  })
})
