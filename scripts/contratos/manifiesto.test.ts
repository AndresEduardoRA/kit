import { describe, expect, it } from 'vitest'
import { leerManifiesto } from '../proyecto/manifiesto.mjs'
import { textoDelContrato } from './esquemas'
import { AGENDA_1 } from './fixtures/agenda'
import {
  contratosQueConsume,
  contratosQueProvee,
  problemasDeLasCopias,
  referencia,
  type Consumido,
} from './manifiesto'

// Lo que el manifiesto dice de los contratos de un repo, revisado aparte de `problemasDelManifiesto`: un contrato mal escrito no
// tumba los puertos ni el orquestador. Un proyecto de dos repos: `api` provee `agenda`, `web` la consume.
const manifiesto = (contratos: string, provee = '[agenda@2]', consume = '[agenda@1]') =>
  leerManifiesto(`esquema: proyecto/v1
proyecto: turnos
nombre: Turnos
repos:
  - { rol: api, nombre: turnos-api, github: cuenta/turnos-api, etapa: construccion, puertos: { bloque: 6 }, provee: ${provee}, consume: [] }
  - { rol: web, nombre: turnos-web, github: cuenta/turnos-web, etapa: construccion, puertos: { bloque: 7 }, provee: [], consume: ${consume} }
contratos:
${contratos}
`)

const AGENDA =
  '  - { id: agenda, proveedor: api, consumidores: [web], tipo: base, vigentes: [1, 2] }'
const repo = (m: ReturnType<typeof manifiesto>, rol: string) => {
  const r = m.repos.find((x) => x.rol === rol)
  if (!r) throw new Error(rol)
  return r
}

describe('manifiesto › lo que provee y consume un repo', () => {
  it('referencia: <id>@<n>', () => {
    expect(referencia('agenda@12')).toEqual({ id: 'agenda', version: 12 })
    expect(() => referencia('agenda')).toThrow(/<contrato>@<versión>/)
  })

  it('el proveedor ve su versión y sus vigentes; el consumidor, la versión y el GitHub de quien la provee', () => {
    const m = manifiesto(AGENDA)
    expect(contratosQueProvee(m, repo(m, 'api'))).toEqual({
      contratos: [{ id: 'agenda', version: 2, vigentes: [1, 2] }],
      problemas: [],
    })
    expect(contratosQueConsume(m, repo(m, 'web'))).toEqual({
      contratos: [{ id: 'agenda', version: 1, proveedor: 'api', github: 'cuenta/turnos-api' }],
      problemas: [],
    })
  })

  it.each(['http', 'archivo'])('tipo %s: todavía no soportado', (tipo) => {
    const m = manifiesto(AGENDA.replace('tipo: base', `tipo: ${tipo}`))
    expect(contratosQueProvee(m, repo(m, 'api')).problemas).toEqual([
      `contratos[agenda].tipo: «${tipo}» todavía no soportado (sólo «base»).`,
    ])
  })

  it('sin tipo, o con vigentes que no son versiones', () => {
    const m = manifiesto(AGENDA.replace('tipo: base, ', '').replace('[1, 2]', '[0, 2]'))
    expect(contratosQueConsume(m, repo(m, 'web')).problemas).toEqual([
      'contratos[agenda].tipo: falta (sólo «base» está soportado).',
      'contratos[agenda].vigentes: «0» no es una versión (enteros mayores que 0).',
    ])
  })
})

describe('manifiesto › lo que no le toca a un repo', () => {
  it('dos versiones de un mismo contrato', () => {
    const m = manifiesto(AGENDA, '[agenda@1, agenda@2]')
    expect(contratosQueProvee(m, repo(m, 'api')).problemas).toEqual([
      'repos[api].provee: dos versiones de agenda (agenda@1, agenda@2): va una sola.',
    ])
  })

  it('proveer un contrato ajeno, o consumir uno del que no es consumidor', () => {
    const m = manifiesto(AGENDA, '[]', '[agenda@1]')
    const web = repo(m, 'web')
    web.provee = ['agenda@3']
    expect(contratosQueProvee(m, web).problemas).toEqual([
      'repos[web].provee: «agenda@3» es de api, no de web.',
    ])
    const api = repo(m, 'api')
    api.consume = ['agenda@1']
    expect(contratosQueConsume(m, api).problemas).toEqual([
      'repos[api].consume: «agenda@1»: api no está entre los consumidores de agenda (son: web).',
    ])
  })
})

describe('manifiesto › las copias fijadas', () => {
  const consume: Consumido[] = [
    { id: 'agenda', version: 1, proveedor: 'api', github: 'cuenta/turnos-api' },
  ]
  const leer = () => textoDelContrato(AGENDA_1)

  it('la copia que nombra consume pasa y se lee', () => {
    expect(problemasDeLasCopias(consume, ['agenda@1.json'], leer)).toEqual({
      copias: [AGENDA_1],
      problemas: [],
    })
  })

  it('una copia que consume no nombra', () => {
    expect(
      problemasDeLasCopias(consume, ['agenda@1.json', 'agenda@0.json'], leer).problemas,
    ).toEqual([
      '.proyecto/contratos/agenda@0.json: no está en `consume` (consume: agenda@1). Bórrala o nómbrala.',
    ])
  })

  it('un consume sin su copia', () => {
    expect(problemasDeLasCopias(consume, [], leer).problemas).toEqual([
      'Falta .proyecto/contratos/agenda@1.json: cópiala de contratos/agenda@1.json en main de cuenta/turnos-api (.claude/rules/contratos.md).',
    ])
  })

  it('dos copias con el mismo esquema: contrato:usar no las distinguiría', () => {
    const pagos = { ...consume[0], id: 'pagos' } as Consumido
    const leerDos = (a: string) =>
      a.startsWith('pagos')
        ? textoDelContrato({ ...AGENDA_1, contrato: 'pagos' })
        : textoDelContrato(AGENDA_1)
    expect(
      problemasDeLasCopias([...consume, pagos], ['agenda@1.json', 'pagos@1.json'], leerDos)
        .problemas,
    ).toEqual([
      'dos copias fijadas usan el esquema `agenda_publica` (agenda@1, pagos@1): `contrato:usar` no podría distinguirlas.',
    ])
  })

  it('una copia que adentro es otra versión, o que no es un contrato', () => {
    const otra = { ...consume[0], version: 2 } as Consumido
    expect(problemasDeLasCopias([otra], ['agenda@2.json'], leer).problemas).toEqual([
      '.proyecto/contratos/agenda@2.json: adentro dice agenda@1: la copia va tal cual sale de main del proveedor.',
    ])
    expect(problemasDeLasCopias(consume, ['agenda@1.json'], () => '{}').problemas[0]).toMatch(
      /^\.proyecto\/contratos\/agenda@1\.json: contrato: /,
    )
  })
})
