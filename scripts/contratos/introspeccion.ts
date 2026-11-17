// Lee de `pg_catalog` lo que un contrato de base promete sobre un esquema: las vistas con sus columnas, las funciones con sus
// parámetros y su retorno, los permisos efectivos de anon, authenticated y service_role, y los tipos propios que esos objetos usan.
// Es UNA sentencia `select` que devuelve un `jsonb`, sin `set` de sesión: la corre el adaptador `Consultar` (psql de la pila local en
// `base-local.ts`, PGlite en las pruebas), así que se prueba el mismo SQL de verdad. Los nombres de tipo se arman desde `nspname`,
// nunca con el `search_path` (lección: salen sin esquema según quién mire); `normalizar` decide en JS, puro, qué entra y qué está mal.
import { z } from 'zod'
import {
  IDENTIFICADOR,
  ROLES,
  porCodigo,
  type Columna,
  type Rol,
  type Rpc,
  type Tipo,
  type Vista,
} from './esquemas'

export type Consultar = (sql: string) => Promise<unknown>

const literal = (valor: string) => `'${valor.replaceAll("'", "''")}'`
const lista = (valores: readonly string[]) => `array[${valores.map(literal).join(', ')}]::text[]`

// Las piezas de la consulta. `tn` da el nombre estructurado de cada tipo: un arreglo es el de su elemento (sólo si el elemento lo
// nombra como su arreglo: `int2vector` no es `smallint[]`), y el de `pg_catalog` va con `format_type`, que no lleva esquema.
const CTE_TIPOS = `
tn as (
  select t.oid, jsonb_build_object(
    'esquema', nb.nspname::text,
    'nombre', case when nb.nspname = 'pg_catalog' then format_type(b.oid, null) else b.typname::text end,
    'arreglo', el.oid is not null) as j
  from pg_type t
  left join pg_type el on el.oid = t.typelem and el.typarray = t.oid
  join pg_type b on b.oid = coalesce(el.oid, t.oid)
  join pg_namespace nb on nb.oid = b.typnamespace
)`

const columnasDe = (
  relid: string,
) => `(select coalesce(jsonb_agg(jsonb_build_object('nombre', a.attname::text, 'tipo', tn.j)), '[]'::jsonb)
  from pg_attribute a join tn on tn.oid = a.atttypid where a.attrelid = ${relid} and a.attnum > 0 and not a.attisdropped)`

const RELACIONES = `(select coalesce(jsonb_agg(jsonb_build_object(
    'nombre', rel.relname::text, 'clase', rel.relkind::text, 'columnas', ${columnasDe('rel.oid')},
    'permisos', (select coalesce(jsonb_object_agg(ro.rolname, (select coalesce(jsonb_agg(p.priv), '[]'::jsonb)
      from unnest(array['select', 'insert', 'update', 'delete']) p(priv) where has_table_privilege(ro.rolname, rel.oid, p.priv))), '{}'::jsonb)
      from roles ro))), '[]'::jsonb) from rel)`

const ARGUMENTOS = `(select coalesce(jsonb_agg(jsonb_build_object('nombre', fn.proargnames[a.ord], 'modo', a.modo::text, 'tipo', tn.j) order by a.ord), '[]'::jsonb)
  from unnest(coalesce(fn.proallargtypes, fn.proargtypes::oid[]), coalesce(fn.proargmodes, array_fill('i'::"char", array[fn.pronargs::int])))
    with ordinality a(tipo, modo, ord)
  join tn on tn.oid = a.tipo)`

const FUNCIONES = `(select coalesce(jsonb_agg(jsonb_build_object(
    'nombre', fn.proname::text, 'conjunto', fn.proretset, 'retorno', (select tn.j from tn where tn.oid = fn.prorettype),
    'entradas', fn.pronargs, 'conDefault', fn.pronargdefaults, 'argumentos', ${ARGUMENTOS},
    'permisos', (select coalesce(jsonb_object_agg(ro.rolname, case when has_function_privilege(ro.rolname, fn.oid, 'execute')
      then '["execute"]'::jsonb else '[]'::jsonb end), '{}'::jsonb) from roles ro))), '[]'::jsonb) from fn)`

// Los compuestos sólo si son tipos sueltos (`relkind = 'c'`): el tipo fila de una vista o una tabla no es un tipo propio.
const TIPOS = `(select coalesce(jsonb_agg(jsonb_build_object(
    'nombre', t.typname::text, 'clase', t.typtype::text,
    'valores', (select jsonb_agg(e.enumlabel::text order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid),
    'campos', case when t.typtype = 'c' then ${columnasDe('t.typrelid')} end,
    'base', (select tn.j from tn where tn.oid = t.typbasetype))), '[]'::jsonb)
  from pg_type t left join pg_class c on c.oid = t.typrelid
  where t.typnamespace = (select oid from esq) and (t.typtype in ('e', 'd') or (t.typtype = 'c' and c.relkind = 'c')))`

/** La consulta: una sentencia, un `jsonb` en la columna `r`. Los nombres se validan antes y entran como literales. Puro. */
export function sqlDeIntrospeccion(esquema: string, nombres: readonly string[]): string {
  for (const n of [esquema, ...nombres])
    if (!IDENTIFICADOR.test(n)) throw new Error(`«${n}» no es un identificador sin comillas`)
  return `with
esq as (select n.oid from pg_namespace n where n.nspname = ${literal(esquema)}),
roles as (select r.rolname::text as rolname from pg_roles r where r.rolname = any(${lista(ROLES)})),
${CTE_TIPOS},
rel as (
  select c.oid, c.relname, c.relkind from pg_class c
  where c.relnamespace = (select oid from esq) and c.relname = any(${lista(nombres)}) and c.relkind in ('v', 'm', 'r', 'p', 'f')
),
fn as (
  select p.* from pg_proc p
  where p.pronamespace = (select oid from esq) and p.prokind = 'f' and p.proname = any(${lista(nombres)})
)
select jsonb_build_object(
  'existe', exists (select 1 from esq),
  'usoDelEsquema', (select coalesce(jsonb_agg(ro.rolname), '[]'::jsonb) from roles ro, esq where has_schema_privilege(ro.rolname, esq.oid, 'usage')),
  'relaciones', ${RELACIONES},
  'funciones', ${FUNCIONES},
  'tipos', ${TIPOS}
) as r`
}

const nombreDeTipo = z.object({ esquema: z.string(), nombre: z.string(), arreglo: z.boolean() })
type NombreDeTipo = z.infer<typeof nombreDeTipo>
const columnaCruda = z.object({ nombre: z.string(), tipo: nombreDeTipo })
const permisosCrudos = z.record(z.string(), z.array(z.string()))

const esquemaCrudo = z.object({
  existe: z.boolean(),
  usoDelEsquema: z.array(z.string()),
  relaciones: z.array(
    z.object({
      nombre: z.string(),
      clase: z.string(),
      columnas: z.array(columnaCruda),
      permisos: permisosCrudos,
    }),
  ),
  funciones: z.array(
    z.object({
      nombre: z.string(),
      conjunto: z.boolean(),
      retorno: nombreDeTipo,
      entradas: z.number(),
      conDefault: z.number(),
      argumentos: z.array(
        z.object({ nombre: z.string().nullable(), modo: z.string(), tipo: nombreDeTipo }),
      ),
      permisos: permisosCrudos,
    }),
  ),
  tipos: z.array(
    z.object({
      nombre: z.string(),
      clase: z.enum(['e', 'c', 'd']),
      valores: z.array(z.string()).nullable(),
      campos: z.array(columnaCruda).nullable(),
      base: nombreDeTipo.nullable(),
    }),
  ),
})
type Crudo = z.infer<typeof esquemaCrudo>
type TipoCrudo = Crudo['tipos'][number]
type FuncionCruda = Crudo['funciones'][number]

export type Lectura = {
  usoDelEsquema: Rol[]
  vistas: Vista[]
  rpc: Rpc[]
  tipos: Tipo[]
  /** Todos los tipos propios del esquema, los use o no un objeto listado: contra éstos compara `probar`. */
  tiposDelEsquema: Tipo[]
  /** Los nombres pedidos que no son ni una relación ni una función del esquema. */
  faltan: string[]
  problemas: string[]
}

/** El nombre de un tipo como va en el contrato: `uuid`, `timestamp with time zone`, `agenda_publica.estado[]`. Puro. */
export const textoDeTipo = (t: NombreDeTipo): string =>
  `${t.esquema === 'pg_catalog' ? t.nombre : `${t.esquema}.${t.nombre}`}${t.arreglo ? '[]' : ''}`

// Lo que se va juntando al normalizar: los tipos propios alcanzados y los problemas.
type Contexto = {
  esquema: string
  propios: Map<string, TipoCrudo>
  vistas: Set<string>
  alcanzados: Set<string>
  problemas: string[]
}

// Revisa un tipo usado por `donde`: de pg_catalog, propio del esquema (y entonces lo que él usa) o el tipo fila de una vista listada.
function usar(ctx: Contexto, t: NombreDeTipo, donde: string): string {
  const texto = textoDeTipo(t)
  if (t.esquema === 'pg_catalog') return texto
  if (t.esquema !== ctx.esquema) {
    ctx.problemas.push(
      `${donde} usa el tipo \`${texto}\`, que no es del esquema \`${ctx.esquema}\`: castéalo o muévelo al esquema.`,
    )
    return texto
  }
  const propio = ctx.propios.get(t.nombre)
  if (propio) alcanzar(ctx, propio)
  else if (!ctx.vistas.has(t.nombre))
    ctx.problemas.push(
      `${donde} usa el tipo \`${texto}\`, que no es una vista del contrato ni un tipo propio del esquema (enum, compuesto o dominio).`,
    )
  return texto
}

function alcanzar(ctx: Contexto, t: TipoCrudo): void {
  if (ctx.alcanzados.has(t.nombre)) return
  ctx.alcanzados.add(t.nombre)
  const donde = `el tipo \`${ctx.esquema}.${t.nombre}\``
  for (const c of t.campos ?? []) usar(ctx, c.tipo, donde)
  if (t.base) usar(ctx, t.base, donde)
}

const columnas = (
  ctx: Contexto,
  lista: Crudo['relaciones'][number]['columnas'],
  donde: string,
): Columna[] => lista.map((c) => ({ nombre: c.nombre, tipo: usar(ctx, c.tipo, donde) }))

function permisosDe<T extends string>(
  crudos: Record<string, string[]>,
  validos: readonly T[],
): Record<Rol, T[]> {
  const de = (rol: Rol) =>
    (crudos[rol] ?? []).filter((p): p is T => (validos as readonly string[]).includes(p))
  return { anon: de('anon'), authenticated: de('authenticated'), service_role: de('service_role') }
}

const ENTRADA = ['i', 'b', 'v']
const SALIDA = ['o', 't', 'b']

function rpcDe(ctx: Contexto, f: FuncionCruda): Rpc | null {
  const donde = `\`${ctx.esquema}.${f.nombre}\``
  const entradas = f.argumentos.filter((a) => ENTRADA.includes(a.modo))
  const sinNombre = entradas.findIndex((a) => !a.nombre)
  if (sinNombre >= 0) {
    ctx.problemas.push(
      `${donde}: el parámetro ${sinNombre + 1} no tiene nombre (PostgREST llama por nombre).`,
    )
    return null
  }
  const desde = f.entradas - f.conDefault
  const salidas = f.argumentos.filter((a) => SALIDA.includes(a.modo))
  const salidaSinNombre = salidas.findIndex((a) => !a.nombre)
  if (salidaSinNombre >= 0) {
    ctx.problemas.push(
      `${donde}: la salida ${salidaSinNombre + 1} no tiene nombre (el consumidor la lee por nombre).`,
    )
    return null
  }
  return {
    nombre: f.nombre,
    parametros: entradas.map((a, i) => ({
      nombre: a.nombre ?? '',
      tipo: usar(ctx, a.tipo, donde),
      conDefault: i >= desde,
    })),
    retorno: {
      conjunto: f.conjunto,
      tipo: usar(ctx, f.retorno, donde),
      ...(salidas.length
        ? {
            columnas: salidas.map((a) => ({
              nombre: a.nombre ?? '',
              tipo: usar(ctx, a.tipo, donde),
            })),
          }
        : {}),
    },
    permisos: permisosDe(f.permisos, ['execute'] as const),
  }
}

function rpcsDe(ctx: Contexto, funciones: FuncionCruda[]): Rpc[] {
  const porNombre = Map.groupBy(funciones, (f) => f.nombre)
  const rpcs: Rpc[] = []
  for (const [nombre, firmas] of [...porNombre].sort(([a], [b]) => porCodigo(a, b))) {
    const [unica] = firmas
    if (firmas.length > 1 || !unica) {
      ctx.problemas.push(
        `\`${ctx.esquema}.${nombre}\` tiene ${firmas.length} sobrecargas: el contrato pide una sola firma (borra la vieja con \`drop function\`).`,
      )
      continue
    }
    const r = rpcDe(ctx, unica)
    if (r) rpcs.push(r)
  }
  return rpcs
}

function vistasDe(ctx: Contexto, relaciones: Crudo['relaciones']): Vista[] {
  const vistas: Vista[] = []
  for (const r of [...relaciones].sort((a, b) => porCodigo(a.nombre, b.nombre))) {
    if (!ctx.vistas.has(r.nombre)) {
      ctx.problemas.push(`\`${ctx.esquema}.${r.nombre}\` es una tabla: el contrato expone vistas.`)
      continue
    }
    vistas.push({
      nombre: r.nombre,
      columnas: columnas(ctx, r.columnas, `la vista \`${ctx.esquema}.${r.nombre}\``),
      permisos: permisosDe(r.permisos, ['delete', 'insert', 'select', 'update'] as const),
    })
  }
  return vistas
}

// Los campos y la base ya se revisaron al alcanzarlo (`alcanzar`): aquí sólo se nombran.
function tipoDe(t: TipoCrudo): Tipo {
  if (t.clase === 'e') return { nombre: t.nombre, clase: 'enum', valores: t.valores ?? [] }
  if (t.clase === 'd')
    return { nombre: t.nombre, clase: 'dominio', base: t.base ? textoDeTipo(t.base) : 'unknown' }
  const campos = (t.campos ?? []).map((c) => ({ nombre: c.nombre, tipo: textoDeTipo(c.tipo) }))
  return { nombre: t.nombre, clase: 'compuesto', campos }
}

/** La salida cruda de la consulta, pasada en limpio: qué entra al contrato, qué falta y qué está mal. Puro. */
export function normalizar(crudo: unknown, esquema: string, nombres: readonly string[]): Lectura {
  const c = esquemaCrudo.parse(crudo)
  if (!c.existe)
    return {
      usoDelEsquema: [],
      vistas: [],
      rpc: [],
      tipos: [],
      tiposDelEsquema: [],
      faltan: [],
      problemas: [
        `El esquema \`${esquema}\` no existe en la base local. ¿Corriste \`pnpm db:reset\`?`,
      ],
    }
  const ctx: Contexto = {
    esquema,
    propios: new Map(c.tipos.map((t) => [t.nombre, t])),
    vistas: new Set(
      c.relaciones.filter((r) => r.clase === 'v' || r.clase === 'm').map((r) => r.nombre),
    ),
    alcanzados: new Set(),
    problemas: [],
  }
  const vistas = vistasDe(ctx, c.relaciones)
  const rpc = rpcsDe(ctx, c.funciones)
  const encontrados = new Set([
    ...c.relaciones.map((r) => r.nombre),
    ...c.funciones.map((f) => f.nombre),
  ])
  return {
    usoDelEsquema: ROLES.filter((r) => c.usoDelEsquema.includes(r)),
    vistas,
    rpc,
    tipos: c.tipos.filter((t) => ctx.alcanzados.has(t.nombre)).map(tipoDe),
    tiposDelEsquema: c.tipos.map(tipoDe),
    faltan: nombres.filter((n) => !encontrados.has(n)),
    problemas: ctx.problemas,
  }
}

/** Corre la consulta con `consultar` y la normaliza. */
export async function leerEsquema(e: {
  esquema: string
  nombres: readonly string[]
  consultar: Consultar
}): Promise<Lectura> {
  const crudo = await e.consultar(sqlDeIntrospeccion(e.esquema, e.nombres))
  return normalizar(crudo, e.esquema, e.nombres)
}
