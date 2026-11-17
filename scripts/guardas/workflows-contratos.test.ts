import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { jobsDe } from './workflows'

// Lo que los contratos entre repos (.claude/rules/contratos.md) necesitan del CI: `cambios` dice si toca el proveedor o el consumidor;
// `contrato` levanta la pila y prueba las versiones sólo si el repo provee algo; `contrato-uso` revisa `infra/` contra las copias y
// exige los tipos sin diff; el Nivel 1 de un PR compara las versiones publicadas contra el main recién bajado. Los dos jobs se saltan
// en la plantilla del kit. Aparte de workflows.test.ts para no inflarlo; cada regla tiene su mutación abajo.
const ci = readFileSync('.github/workflows/ci.yml', 'utf8')

const SI_PROVEE = "if: steps.rol.outputs.provee == 'true'"
const SI_CONTRATO =
  "if: needs.cambios.outputs.contrato == 'true' && needs.cambios.outputs.plantilla != 'true'"
const SI_USO =
  "if: needs.cambios.outputs.contrato_uso == 'true' && needs.cambios.outputs.plantilla != 'true'"
const ROL = 'pnpm exec tsx scripts/contratos/contrato.ts rol >> "$GITHUB_OUTPUT"'
const GUARDA =
  'CONTRATOS_BASE=FETCH_HEAD pnpm exec vitest run scripts/guardas/contratos-publicados.test.ts'
const SIN_DIFF = 'test -z "$(git status --porcelain -- src/shared/types/contratos/)"'

// Los pasos de un job, en orden: el texto de cada `- …` de su `steps:`.
const pasosDe = (bloque: string): string[] =>
  (bloque.split(/^ {4}steps:\s*$/m)[1] ?? '').split(/^ {6}- /m).slice(1)

function problemasDelProveedor(bloque: string): string[] {
  const p: string[] = []
  if (!bloque.includes(SI_CONTRATO))
    p.push('contrato: no corre por la salida contrato, o corre en la plantilla')
  const pasos = pasosDe(bloque)
  const rol = pasos.findIndex((x) => x.includes('id: rol') && x.includes(ROL))
  if (rol < 0) p.push('contrato: no decide con el paso rol')
  let anterior = rol
  for (const paso of ['./.github/acciones/pila', 'pnpm db:reset', 'pnpm contrato:probar']) {
    const i = pasos.findIndex((x) => x.includes(paso))
    if (i < 0) p.push(`contrato: no corre ${paso}`)
    else if (!pasos[i]?.includes(SI_PROVEE))
      p.push(`contrato: corre ${paso} aunque el repo no provea`)
    else if (i < anterior)
      p.push(`contrato: ${paso} va fuera de orden (rol, pila, db:reset, contrato:probar)`)
    anterior = Math.max(anterior, i)
  }
  return p
}

function problemasDelConsumidor(bloque: string): string[] {
  const p: string[] = []
  if (!bloque.includes(SI_USO))
    p.push('contrato-uso: no corre por la salida contrato_uso, o corre en la plantilla')
  if (!bloque.includes('- run: pnpm contrato:usar'))
    p.push('contrato-uso: no corre pnpm contrato:usar')
  const tipos = bloque.indexOf('pnpm contrato:tipos')
  if (tipos < 0 || bloque.indexOf(SIN_DIFF) < tipos)
    p.push(
      'contrato-uso: no exige los tipos de los contratos sin diff después de pnpm contrato:tipos',
    )
  return p
}

function problemasDeLosContratos(texto: string): string[] {
  const job = (nombre: string) => jobsDe(texto).find((j) => j.nombre === nombre)?.bloque ?? ''
  const p: string[] = []
  for (const salida of ['contrato', 'contrato_uso'])
    if (!job('cambios').includes(`${salida}: \${{ steps.filtro.outputs.${salida} }}`))
      p.push(`cambios: no expone la salida ${salida}`)
  const nivel1 = job('nivel-1')
  const fetch = nivel1.indexOf('git fetch --no-tags --depth=1 origin "$BASE_REF"')
  if (fetch < 0 || nivel1.indexOf(GUARDA) < fetch)
    p.push('nivel-1: no compara las versiones publicadas contra el main recién bajado')
  return [
    ...p,
    ...problemasDelProveedor(job('contrato')),
    ...problemasDelConsumidor(job('contrato-uso')),
  ]
}

// Cambia `antes` por `despues` exactamente una vez: la mutación tiene que tocar el archivo real.
function mutar(antes: string, despues: string): string {
  expect(ci.split(antes), `la mutación no encontró una sola vez: ${antes}`).toHaveLength(2)
  return ci.replace(antes, despues)
}

describe('ci.yml › los contratos entre repos', () => {
  it('cumple', () => {
    expect(problemasDeLosContratos(ci)).toEqual([])
  })
})

describe('ci.yml › los contratos: las mutaciones caen', () => {
  const sinSi = (paso: string) =>
    [`      - ${SI_PROVEE}\n        ${paso}`, `      - ${paso}`] as const
  const casos: [string, string, string, RegExp][] = [
    [
      'cambios sin la salida contrato_uso',
      '      contrato_uso: ${{ steps.filtro.outputs.contrato_uso }}\n',
      '',
      /no expone la salida contrato_uso/,
    ],
    [
      'contrato en la plantilla',
      SI_CONTRATO,
      "if: needs.cambios.outputs.contrato == 'true'",
      /contrato: no corre por la salida contrato/,
    ],
    [
      'contrato sin el paso rol',
      `      - id: rol\n        run: ${ROL}\n`,
      '',
      /no decide con el paso rol/,
    ],
    [
      'contrato:probar aunque no provea',
      ...sinSi('run: pnpm contrato:probar'),
      /corre pnpm contrato:probar aunque/,
    ],
    ['db:reset aunque no provea', ...sinSi('run: pnpm db:reset'), /corre pnpm db:reset aunque/],
    [
      'la pila aunque no provea',
      ...sinSi('uses: ./.github/acciones/pila'),
      /corre .\/\.github\/acciones\/pila aunque/,
    ],
    [
      'contrato:probar antes del reset',
      `      - ${SI_PROVEE}\n        run: pnpm db:reset\n      - ${SI_PROVEE}\n        run: pnpm contrato:probar\n`,
      `      - ${SI_PROVEE}\n        run: pnpm contrato:probar\n      - ${SI_PROVEE}\n        run: pnpm db:reset\n`,
      /fuera de orden/,
    ],
    [
      'contrato-uso en la plantilla',
      SI_USO,
      "if: needs.cambios.outputs.contrato_uso == 'true'",
      /contrato-uso: no corre por la salida/,
    ],
    [
      'contrato-uso sin contrato:usar',
      '      - run: pnpm contrato:usar\n',
      '',
      /no corre pnpm contrato:usar/,
    ],
    [
      'contrato-uso sin los tipos sin diff',
      `          ${SIN_DIFF}\n`,
      '',
      /tipos de los contratos sin diff/,
    ],
    [
      'el Nivel 1 sin la guarda de versiones publicadas',
      `          ${GUARDA}\n`,
      '',
      /nivel-1: no compara las versiones publicadas/,
    ],
  ]

  it.each(casos)('%s', (_, antes, despues, motivo) => {
    expect(problemasDeLosContratos(mutar(antes, despues)).join('\n')).toMatch(motivo)
  })
})
