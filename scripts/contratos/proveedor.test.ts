// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { explicarFalloDeLaPila } from './base-local'
import { textoDelContrato, type ConfigDeContrato } from './esquemas'
import { AGENDA_1, CONFIG_AGENDA, baseDeEjemplo, type BaseDeEjemplo } from './fixtures/agenda'
import {
  decidirEscritura,
  esquemasExpuestos,
  generarContrato,
  leerConfig,
  problemaDeExposicion,
} from './generar'

// `pnpm contrato:generar` contra la base de ejemplo en PGlite (Postgres 18; la pila real es 17): el mismo SQL de introspección que
// corre por psql. Cada cambio de la base va en una transacción que se revierte (el DDL de Postgres es transaccional).
let base: BaseDeEjemplo
// Arrancar PGlite pasa los 5 s del tope local de una prueba: una por archivo, con su tope.
beforeAll(async () => {
  base = await baseDeEjemplo()
}, 30_000)

const generar = async (config: ConfigDeContrato = CONFIG_AGENDA) => {
  const r = await generarContrato({
    ref: { id: 'agenda', version: 1 },
    config,
    consultar: base.consultar,
  })
  return r.ok ? textoDelContrato(r.valor) : r.problemas
}
const problemas = async (config: ConfigDeContrato) => {
  const r = await generarContrato({
    ref: { id: 'agenda', version: 1 },
    config,
    consultar: base.consultar,
  })
  return r.ok ? [] : r.problemas
}

// Las vistas y funciones de la base de ejemplo, recreadas al revés: otro orden de creación y otro orden de columnas.
const RECREAR_AL_REVES = `
drop function agenda_publica.franja_de(uuid);
drop function agenda_publica.turnos_del_dia(date);
drop function agenda_publica.reservar(uuid, text);
drop view agenda_publica.turnos;
create function agenda_publica.franja_de(p_turno uuid) returns agenda_publica.franja language sql stable set search_path = ''
  as $$ select row(t.inicio, t.estado)::agenda_publica.franja from public.turnos_base t where t.id = p_turno $$;
revoke all on function agenda_publica.franja_de(uuid) from public;
grant execute on function agenda_publica.franja_de(uuid) to service_role, authenticated;
create function agenda_publica.turnos_del_dia(p_dia date) returns table (id uuid, inicio timestamptz) language sql stable
  set search_path = '' as $$ select t.id, t.inicio from public.turnos_base t where t.inicio::date = p_dia $$;
revoke all on function agenda_publica.turnos_del_dia(date) from public;
grant execute on function agenda_publica.turnos_del_dia(date) to service_role, authenticated, anon;
create view agenda_publica.turnos with (security_invoker = true) as
  select t.nota, t.estado, t.inicio, t.id from public.turnos_base t;
revoke all on agenda_publica.turnos from public;
grant select on agenda_publica.turnos to authenticated, anon;
create function agenda_publica.reservar(p_turno uuid, p_nota text default null) returns uuid language sql security definer
  set search_path = '' as $$ select p_turno $$;
revoke all on function agenda_publica.reservar(uuid, text) from public;
grant execute on function agenda_publica.reservar(uuid, text) to service_role, authenticated;
`

describe('generar › determinista', () => {
  it('da el contrato fijado, byte a byte, y dos corridas dan el mismo texto', async () => {
    const texto = await generar()
    expect(texto).toBe(`${JSON.stringify(AGENDA_1, null, 2)}\n`)
    expect(await generar()).toBe(texto)
  })

  it('recrear las vistas y las funciones en otro orden (y las columnas en otro orden) da el mismo texto', async () => {
    const antes = await generar()
    expect(await base.conCambio(RECREAR_AL_REVES, () => generar())).toBe(antes)
  })

  it('entran los tipos propios que usa un objeto listado, aunque sea a través de otro tipo; los demás no', async () => {
    const r = await generarContrato({
      ref: { id: 'agenda', version: 1 },
      config: { esquema: 'agenda_publica', objetos: ['franja_de'] },
      consultar: base.consultar,
    })
    expect(r.ok && r.valor.tipos.map((t) => t.nombre)).toEqual(['estado', 'franja'])
    expect(r.ok && r.valor.vistas).toEqual([])
  })
})

describe('generar › lo que no entra a un contrato', () => {
  it('una tabla en objetos', async () => {
    const config = { esquema: 'agenda_publica', objetos: ['turnos', 'interna'] }
    expect(
      await base.conCambio('create table agenda_publica.interna (id int)', () => problemas(config)),
    ).toEqual(['`agenda_publica.interna` es una tabla: el contrato expone vistas.'])
  })

  it('un objeto que no existe', async () => {
    expect(
      await problemas({ esquema: 'agenda_publica', objetos: ['turnos', 'no_existe'] }),
    ).toEqual(['`agenda_publica.no_existe` no existe en la base local. ¿Corriste `pnpm db:reset`?'])
    expect(await problemas({ esquema: 'otro', objetos: ['turnos'] })).toEqual([
      'El esquema `otro` no existe en la base local. ¿Corriste `pnpm db:reset`?',
    ])
  })

  it('una función con sobrecargas (lo que deja un `create or replace` con otros argumentos)', async () => {
    const sobrecarga = `create function agenda_publica.reservar(p_turno uuid, p_nota text, p_extra int) returns uuid
      language sql as $$ select p_turno $$`
    expect(await base.conCambio(sobrecarga, () => problemas(CONFIG_AGENDA))).toEqual([
      '`agenda_publica.reservar` tiene 2 sobrecargas: el contrato pide una sola firma (borra la vieja con `drop function`).',
    ])
  })

  it('un tipo de otro esquema', async () => {
    const ajeno = `create type public.color as enum ('rojo');
      create function agenda_publica.colorear(p_color public.color) returns void language sql as $$ select $$`
    const config = { esquema: 'agenda_publica', objetos: ['colorear'] }
    expect(await base.conCambio(ajeno, () => problemas(config))).toEqual([
      '`agenda_publica.colorear` usa el tipo `public.color`, que no es del esquema `agenda_publica`: castéalo o muévelo al esquema.',
    ])
  })

  it('un parámetro sin nombre (PostgREST llama por nombre)', async () => {
    const sinNombre =
      'create function agenda_publica.eco(uuid) returns uuid language sql as $$ select $1 $$'
    const config = { esquema: 'agenda_publica', objetos: ['eco'] }
    expect(await base.conCambio(sinNombre, () => problemas(config))).toEqual([
      '`agenda_publica.eco`: el parámetro 1 no tiene nombre (PostgREST llama por nombre).',
    ])
  })

  it('una salida sin nombre (el consumidor la lee por nombre)', async () => {
    const sinNombre =
      'create function agenda_publica.doble(p_x int, out int) language sql as $$ select p_x * 2 $$'
    const config = { esquema: 'agenda_publica', objetos: ['doble'] }
    expect(await base.conCambio(sinNombre, () => problemas(config))).toEqual([
      '`agenda_publica.doble`: la salida 1 no tiene nombre (el consumidor la lee por nombre).',
    ])
  })

  it('una función sin parámetros sí entra', async () => {
    const ahora =
      'create function agenda_publica.ahora() returns timestamptz language sql stable as $$ select now() $$'
    const r = await base.conCambio(ahora, () =>
      generarContrato({
        ref: { id: 'agenda', version: 1 },
        config: { esquema: 'agenda_publica', objetos: ['ahora'] },
        consultar: base.consultar,
      }),
    )
    expect(r.ok && r.valor.rpc[0]).toMatchObject({
      nombre: 'ahora',
      parametros: [],
      retorno: { conjunto: false, tipo: 'timestamp with time zone' },
    })
  })

  it('el esquema public', async () => {
    expect((await problemas({ esquema: 'public', objetos: ['turnos_base'] })).join('\n')).toMatch(
      /no puede ser `public`: el consumidor no distinguiría sus RPC/,
    )
  })
})

describe('generar › la configuración y la escritura', () => {
  it('la configuración: falta, no es JSON, o no tiene la forma', () => {
    expect(leerConfig('agenda', null)).toMatchObject({
      ok: false,
      problemas: [expect.stringMatching(/^Falta contratos\/agenda\.config\.json/)],
    })
    expect(leerConfig('agenda', '{')).toEqual({
      ok: false,
      problemas: ['contratos/agenda.config.json: no es JSON válido.'],
    })
    expect(leerConfig('agenda', '{"esquema":"agenda_publica","objetos":[]}').ok).toBe(false)
    expect(leerConfig('agenda', '{"esquema":"agenda_publica","objetos":["x"],"extra":1}').ok).toBe(
      false,
    )
    expect(leerConfig('agenda', JSON.stringify(CONFIG_AGENDA))).toEqual({
      ok: true,
      valor: CONFIG_AGENDA,
    })
  })

  it('una versión ya publicada no se reescribe: igual es «sin cambios», distinta pide subir provee', () => {
    const texto = textoDelContrato(AGENDA_1)
    expect(decidirEscritura(AGENDA_1, undefined, 'origin/main')).toMatchObject({
      escribir: true,
      error: false,
    })
    expect(decidirEscritura(AGENDA_1, texto, 'origin/main')).toMatchObject({
      escribir: false,
      error: false,
      mensaje: expect.stringContaining('sin cambios') as string,
    })
    const otra = decidirEscritura(AGENDA_1, texto.replace('"nota"', '"notas"'), 'origin/main')
    expect(otra).toMatchObject({ escribir: false, error: true })
    expect(otra.mensaje).toMatch(
      /contratos\/agenda@1\.json ya está publicada en origin\/main.*Sube `provee` a agenda@2/,
    )
  })
})

describe('el esquema expuesto por PostgREST', () => {
  const TOML =
    '[db]\nport = 1\n\n[api]\nenabled = true\nschemas = ["public", "graphql_public"]\n\n[auth]\n'

  it('lee [api] schemas de config.toml; sin la clave, los de fábrica; sin config.toml, no revisa', () => {
    expect(esquemasExpuestos(TOML)).toEqual(['public', 'graphql_public'])
    expect(esquemasExpuestos('[api]\nschemas = [\n  "public",\n  "agenda_publica",\n]\n')).toEqual([
      'public',
      'agenda_publica',
    ])
    expect(esquemasExpuestos('[api]\nenabled = true\n')).toEqual(['public', 'graphql_public'])
    expect(esquemasExpuestos(null)).toBeNull()
  })

  it('un esquema de contrato que PostgREST no expone cae (todo daría verde y el consumidor, un 404)', () => {
    expect(problemaDeExposicion('agenda_publica', TOML).join('\n')).toMatch(
      /^`agenda_publica` no está en `\[api\] schemas` de supabase\/config\.toml \(public, graphql_public\)/,
    )
    expect(problemaDeExposicion('public', TOML)).toEqual([])
    expect(problemaDeExposicion('agenda_publica', null)).toEqual([])
  })
})

describe('la pila local apagada', () => {
  it('dice cómo levantarla, en la principal y en un carril', () => {
    const texto = explicarFalloDeLaPila(
      { stderr: 'Error response from daemon: No such container: supabase_db_x' },
      'supabase_db_x',
      'generar',
    )
    expect(texto).toContain('no encuentro `supabase_db_x`')
    expect(texto).toContain('`pnpm exec supabase start`')
    expect(texto).toContain('`bash scripts/worktree/preparar.sh`')
    expect(texto).toContain('`pnpm db:reset`')
    expect(texto).toContain('`pnpm contrato:generar`')
  })

  it('sin docker lo dice; otro error de la consulta, también', () => {
    expect(explicarFalloDeLaPila({ code: 'ENOENT' }, 'c', 'probar')).toMatch(
      /^No encuentro `docker`/,
    )
    expect(explicarFalloDeLaPila(new Error('ERROR: syntax error'), 'c', 'probar')).toMatch(
      /falló: ERROR: syntax error/,
    )
  })
})
