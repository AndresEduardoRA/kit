// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { diferencias } from './comparar'
import { textoDelContrato, type Contrato } from './esquemas'
import { AGENDA_1, baseDeEjemplo, type BaseDeEjemplo } from './fixtures/agenda'
import { cargarVersion, probarVersion, versionesAProbar } from './probar'

// `pnpm contrato:probar` contra la base de ejemplo en PGlite: la versión publicada es AGENDA_1 (lo que da la base sin cambios) y
// cada caso cambia la base en una transacción que se revierte. La tabla de qué rompe y qué no: `.claude/rules/contratos.md`.
let base: BaseDeEjemplo
// Arrancar PGlite pasa los 5 s del tope local de una prueba: una por archivo, con su tope.
beforeAll(async () => {
  base = await baseDeEjemplo()
}, 30_000)

const probarCon = (sql: string) =>
  base.conCambio(sql, () => probarVersion(AGENDA_1, base.consultar))

const VISTA = (columnas: string) => `drop view agenda_publica.turnos;
  create view agenda_publica.turnos as select ${columnas} from public.turnos_base t;
  revoke all on agenda_publica.turnos from public;
  grant select on agenda_publica.turnos to anon, authenticated;`
const RESERVAR = (parametros: string) => `drop function agenda_publica.reservar(uuid, text);
  create function agenda_publica.reservar(${parametros}) returns uuid language sql as $$ select gen_random_uuid() $$;
  revoke all on function agenda_publica.reservar from public;
  grant execute on function agenda_publica.reservar to authenticated, service_role;`

describe('probar › quitar o cambiar rompe', () => {
  it('la base sin cambios cumple', async () => {
    expect(await probarVersion(AGENDA_1, base.consultar)).toEqual([])
  })

  it('quitar una columna de la vista', async () => {
    expect(await probarCon(VISTA('t.id, t.inicio, t.estado'))).toEqual([
      'agenda@1 › vista turnos: falta la columna `nota`',
    ])
  })

  it('cambiar el tipo de una columna', async () => {
    expect(await probarCon(VISTA('t.id, t.inicio::date as inicio, t.estado, t.nota'))).toEqual([
      'agenda@1 › vista turnos: la columna `inicio` era `timestamp with time zone` y ahora es `date`',
    ])
  })

  it('renombrar un parámetro', async () => {
    expect(await probarCon(RESERVAR('p_id uuid, p_nota text default null'))).toEqual([
      'agenda@1 › rpc reservar: falta el parámetro `p_turno`',
      'agenda@1 › rpc reservar: parámetro nuevo sin default `p_id`: rompe a quien llama sin él',
    ])
  })

  it('un parámetro nuevo sin default, o uno que pierde su default', async () => {
    expect(
      await probarCon(RESERVAR('p_turno uuid, p_extra int, p_nota text default null')),
    ).toEqual([
      'agenda@1 › rpc reservar: parámetro nuevo sin default `p_extra`: rompe a quien llama sin él',
    ])
    expect(await probarCon(RESERVAR('p_turno uuid, p_nota text'))).toEqual([
      'agenda@1 › rpc reservar: el parámetro `p_nota` perdió su default',
    ])
  })

  it('quitar una vista o una función', async () => {
    expect(await probarCon('drop function agenda_publica.franja_de(uuid)')).toEqual([
      'agenda@1 › falta la rpc `franja_de`',
    ])
    expect(await probarCon('drop view agenda_publica.turnos')).toEqual([
      'agenda@1 › falta la vista `turnos`',
    ])
  })
})

describe('probar › los permisos no admiten ni de más ni de menos', () => {
  it('un grant de más a anon sobre la vista', async () => {
    expect(await probarCon('grant insert on agenda_publica.turnos to anon')).toEqual([
      'agenda@1 › vista turnos: permisos de anon: el contrato dice [select], la base da [insert, select]',
    ])
  })

  it('un revoke de menos: la función quedó con execute para PUBLIC', async () => {
    expect(await probarCon('grant execute on function agenda_publica.reservar to public')).toEqual([
      'agenda@1 › rpc reservar: permisos de anon: el contrato dice [], la base da [execute]',
    ])
  })

  it('un permiso que se fue, y el uso del esquema', async () => {
    expect(await probarCon('revoke select on agenda_publica.turnos from authenticated')).toEqual([
      'agenda@1 › vista turnos: permisos de authenticated: el contrato dice [select], la base da []',
    ])
    expect(await probarCon('revoke usage on schema agenda_publica from anon')).toEqual([
      'agenda@1 › uso del esquema agenda_publica: el contrato dice [anon, authenticated], la base da [authenticated]',
    ])
  })
})

describe('probar › agregar no rompe', () => {
  it('una columna nueva en la vista', async () => {
    const conColumna = `create or replace view agenda_publica.turnos with (security_invoker = true) as
      select t.id, t.inicio, t.estado, t.nota, t.inicio::date as dia from public.turnos_base t`
    expect(await probarCon(conColumna)).toEqual([])
  })

  it('un parámetro nuevo con default, o uno que gana su default', async () => {
    expect(
      await probarCon(RESERVAR('p_turno uuid, p_nota text default null, p_extra int default 0')),
    ).toEqual([])
    expect(
      await probarCon(RESERVAR('p_turno uuid default null, p_nota text default null')),
    ).toEqual([])
  })

  it('una vista y una función nuevas', async () => {
    const nuevas = `create view agenda_publica.libres as select t.id from public.turnos_base t where t.estado = 'libre';
      grant select on agenda_publica.libres to anon;
      create function agenda_publica.liberar(p_turno uuid) returns void language sql as $$ select $$;`
    expect(await probarCon(nuevas)).toEqual([])
  })
})

// Lo que no se cambia bien dentro de una transacción (un valor de enum: `alter type … add value`) o que es pura comparación.
describe('diferencias › enums, retorno y tipos', () => {
  const con = (cambio: (c: Contrato) => void): Contrato => {
    const c = structuredClone(AGENDA_1)
    cambio(c)
    return c
  }

  it('un valor de enum de más rompe al que lee', () => {
    const hoy = con((c) => {
      const e = c.tipos[0]
      if (e?.clase === 'enum') e.valores.push('cancelado')
    })
    expect(diferencias(AGENDA_1, hoy)).toEqual([
      'tipo estado: el enum tenía [libre, tomado] y ahora tiene [libre, tomado, cancelado]',
    ])
  })

  it('el retorno: conjunto, tipo y columnas', () => {
    const hoy = con((c) => {
      const r = c.rpc[2]
      if (r)
        r.retorno = {
          conjunto: false,
          tipo: 'record',
          columnas: [
            { nombre: 'id', tipo: 'text' },
            { nombre: 'x', tipo: 'int' },
          ],
        }
    })
    expect(diferencias(AGENDA_1, hoy)).toEqual([
      'rpc turnos_del_dia: el retorno era un conjunto y ahora no',
      'rpc turnos_del_dia: la columna del retorno `id` era `uuid` y ahora es `text`',
      'rpc turnos_del_dia: falta la columna del retorno `inicio`',
    ])
  })

  it('el retorno que pasa de un valor a filas, o al revés', () => {
    const aFilas = con((c) => {
      const r = c.rpc[1]
      if (r) r.retorno = { ...r.retorno, columnas: [{ nombre: 'id', tipo: 'uuid' }] }
    })
    expect(diferencias(AGENDA_1, aFilas)).toEqual([
      'rpc reservar: el retorno era un valor y ahora son filas',
    ])
  })

  it('un campo de compuesto que falta o una clase distinta; los de más pasan', () => {
    const sinCampo = con((c) => {
      c.tipos[1] = {
        nombre: 'franja',
        clase: 'compuesto',
        campos: [
          { nombre: 'inicio', tipo: 'timestamp with time zone' },
          { nombre: 'fin', tipo: 'date' },
        ],
      }
    })
    expect(diferencias(AGENDA_1, sinCampo)).toEqual(['tipo franja: falta el campo `estado`'])
    const dominio = con((c) => {
      c.tipos[0] = { nombre: 'estado', clase: 'dominio', base: 'text' }
    })
    expect(diferencias(AGENDA_1, dominio)).toEqual(['tipo estado: era enum y ahora es dominio'])
  })
})

describe('probar › qué versiones y sus archivos', () => {
  const provisto = { id: 'agenda', version: 3, vigentes: [2, 1] }

  it('prueba las vigentes y la de provee, sin repetir', () => {
    expect(versionesAProbar(provisto)).toEqual([1, 2, 3])
    expect(versionesAProbar({ id: 'agenda', version: 2, vigentes: [2] })).toEqual([2])
  })

  it('una vigente sin archivo es un error; la de provee sin archivo pide generarla', () => {
    expect(cargarVersion(provisto, 1, null)).toEqual({
      ok: false,
      problemas: [
        'Falta contratos/agenda@1.json: está en `vigentes`. Restáurala desde main, o sácala de vigentes sólo si nadie la consume (.claude/rules/contratos.md).',
      ],
    })
    expect(cargarVersion(provisto, 3, null)).toMatchObject({
      ok: false,
      problemas: [expect.stringContaining('`pnpm contrato:generar`')],
    })
  })

  it('un archivo que adentro dice otra versión cae', () => {
    expect(cargarVersion(provisto, 2, textoDelContrato(AGENDA_1))).toMatchObject({
      ok: false,
      problemas: [expect.stringContaining('adentro dice agenda@1')],
    })
    expect(cargarVersion({ ...provisto, version: 1 }, 1, textoDelContrato(AGENDA_1))).toEqual({
      ok: true,
      valor: AGENDA_1,
    })
  })
})
