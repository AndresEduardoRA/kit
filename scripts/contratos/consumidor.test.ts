// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENDA_1 } from './fixtures/agenda'
import { archivosDeInfra, problemasDeUso } from './usar'

// `pnpm contrato:usar`: lo que `infra/` llama de un esquema fijado está en la copia (AGENDA_1, la de la base de ejemplo), con los mismos
// nombres de parámetros. Fuentes inline, como las escribiría un repositorio de `infra/`.
const ARCHIVO = 'src/modules/turnos/infra/agenda.ts'
const revisar = (cuerpo: string) =>
  problemasDeUso(
    ARCHIVO,
    `export async function f(supabase: any, p_turno: string) {\n${cuerpo}\n}\n`,
    [AGENDA_1],
  )

describe('usar › lo que pasa', () => {
  it('una rpc y una vista de la copia, con sus parámetros', () => {
    expect(
      revisar(`
  await supabase.schema('agenda_publica').rpc('reservar', { p_turno })
  await supabase.schema('agenda_publica').rpc('reservar', { p_turno, p_nota: 'x' })
  await supabase.schema('agenda_publica').rpc('turnos_del_dia', { 'p_dia': '2026-11-16' })
  await supabase.schema('agenda_publica').from('turnos').select('id, estado').limit(10)`),
    ).toEqual([])
  })

  it('lo de la base propia: una rpc suelta, con schema public, y storage', () => {
    expect(
      revisar(`
  await supabase.rpc('propia', { p_x: 1 })
  await supabase.schema('public').rpc('otra_propia')
  await supabase.from('tabla_propia').select('id').limit(1)
  await supabase.storage.from('avatares').upload('a', 'b')`),
    ).toEqual([])
  })
})

describe('usar › lo que no está en la copia', () => {
  it('una rpc que no está', () => {
    expect(
      revisar(`  await supabase.schema('agenda_publica').rpc('cancelar', { p_turno })`),
    ).toEqual([`${ARCHIVO}:2: \`agenda_publica.cancelar\` no está en agenda@1`])
  })

  it('un parámetro renombrado: el nuevo no está y falta el obligatorio', () => {
    expect(
      revisar(`  await supabase.schema('agenda_publica').rpc('reservar', { p_id: p_turno })`),
    ).toEqual([
      `${ARCHIVO}:2: \`agenda_publica.reservar\` no tiene el parámetro \`p_id\` (tiene: p_turno, p_nota)`,
      `${ARCHIVO}:2: \`agenda_publica.reservar\`: falta el parámetro obligatorio \`p_turno\``,
    ])
  })

  it('falta un obligatorio (sin objeto de parámetros)', () => {
    expect(revisar(`  await supabase.schema('agenda_publica').rpc('franja_de')`)).toEqual([
      `${ARCHIVO}:2: \`agenda_publica.franja_de\`: falta el parámetro obligatorio \`p_turno\``,
    ])
  })

  it('una vista que no está, y un esquema que no es de ninguna copia', () => {
    expect(
      revisar(`  await supabase.schema('agenda_publica').from('turnos_viejos').select('id')`),
    ).toEqual([`${ARCHIVO}:2: \`agenda_publica.turnos_viejos\` no está en agenda@1`])
    expect(revisar(`  await supabase.schema('otro').rpc('x')`)).toEqual([
      `${ARCHIVO}:2: \`.schema('otro')\` no es de ninguna copia fijada (esquemas fijados: agenda_publica).`,
    ])
  })
})

describe('usar › lo que no se puede revisar es error', () => {
  const literal = /con un nombre que no es literal: escríbelo entre comillas/

  it('.rpc(nombre), .schema(variable) y .from(variable) de una copia', () => {
    expect(revisar(`  const nombre = 'x'\n  await supabase.rpc(nombre)`).join('\n')).toMatch(
      literal,
    )
    expect(
      revisar(
        `  const e = 'agenda_publica'\n  await supabase.schema(e).rpc('reservar', { p_turno })`,
      ).join('\n'),
    ).toMatch(literal)
    expect(
      revisar(
        `  const v = 'turnos'\n  await supabase.schema('agenda_publica').from(v).select('id')`,
      ).join('\n'),
    ).toMatch(literal)
  })

  it('el esquema guardado en una variable', () => {
    expect(
      revisar(
        `  const agenda = supabase.schema('agenda_publica')\n  await agenda.rpc('reservar', { p_turno })`,
      ),
    ).toEqual([
      `${ARCHIVO}:2: \`.schema('agenda_publica')\` va encadenado a \`.rpc(…)\` o \`.from(…)\` en la misma expresión, para que \`contrato:usar\` pueda revisarlo.`,
    ])
  })

  it('los parámetros en una variable o con spread', () => {
    const noLiteral = /los parámetros de `agenda_publica.reservar` no van como objeto literal/
    expect(
      revisar(
        `  const ps = { p_turno }\n  await supabase.schema('agenda_publica').rpc('reservar', ps)`,
      ).join('\n'),
    ).toMatch(noLiteral)
    expect(
      revisar(
        `  const ps = { p_turno }\n  await supabase.schema('agenda_publica').rpc('reservar', { ...ps })`,
      ).join('\n'),
    ).toMatch(noLiteral)
  })
})

describe('usar › los archivos de infra', () => {
  it('src/**/infra/** sin pruebas, en orden', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'contrato-usar-'))
    for (const a of [
      'src/modules/b/infra/repo.ts',
      'src/modules/a/infra/sub/lector.tsx',
      'src/modules/a/infra/repo.test.ts',
      'src/modules/a/features/x/accion.ts',
      'src/shared/infra-no/a.ts',
    ]) {
      mkdirSync(dirname(join(raiz, a)), { recursive: true })
      writeFileSync(join(raiz, a), '')
    }
    expect(archivosDeInfra(raiz)).toEqual([
      'src/modules/a/infra/sub/lector.tsx',
      'src/modules/b/infra/repo.ts',
    ])
    expect(archivosDeInfra(join(raiz, 'no-existe'))).toEqual([])
    rmSync(raiz, { recursive: true, force: true })
  })
})
