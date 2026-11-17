// `pnpm contrato:tipos`: de la copia fijada (`.proyecto/contratos/<id>@<n>.json`) a `src/shared/types/contratos/<id>.ts`, con la forma
// de `Database` de Supabase (`{ <esquema>: { Tables, Views, Functions, Enums, CompositeTypes } }`) para tipar el cliente con
// `Database & Contrato<Id>`. El mapeo de tipos es el de `supabase gen types` (postgres-meta); lo que no conoce, `unknown`. Puro.
import {
  porCodigo,
  type Columna,
  type Contrato,
  type Parametro,
  type Rpc,
  type Vista,
} from './esquemas'

const NUMERO = ['smallint', 'integer', 'bigint', 'real', 'double precision', 'numeric']
const TEXTO = [
  'bytea',
  'bpchar',
  'character',
  'character varying',
  'date',
  'text',
  'time without time zone',
  'time with time zone',
  'timestamp without time zone',
  'timestamp with time zone',
  'uuid',
]

function deCatalogo(tipo: string): string {
  if (tipo === 'boolean') return 'boolean'
  if (NUMERO.includes(tipo)) return 'number'
  if (TEXTO.includes(tipo)) return 'string'
  if (tipo === 'json' || tipo === 'jsonb') return 'Json'
  if (tipo === 'void') return 'undefined'
  if (tipo === 'record') return 'Record<string, unknown>'
  return 'unknown'
}

/** `agenda` → `ContratoAgenda`; `agenda-publica` → `ContratoAgendaPublica`. Puro. */
export const nombreDelTipo = (id: string): string =>
  `Contrato${id
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')}`

const clave = (n: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n) ? n : JSON.stringify(n))
const q = (n: string) => JSON.stringify(n)

// El tipo TS de un tipo del contrato: los de pg_catalog por la tabla; los propios por referencia indexada al mismo tipo generado.
function tsDeTipo(c: Contrato, tipo: string): string {
  if (tipo.endsWith('[]')) return `(${tsDeTipo(c, tipo.slice(0, -2))})[]`
  if (!tipo.startsWith(`${c.esquema}.`)) return deCatalogo(tipo)
  const nombre = tipo.slice(c.esquema.length + 1)
  const raiz = `${nombreDelTipo(c.contrato)}[${q(c.esquema)}]`
  const propio = c.tipos.find((t) => t.nombre === nombre)
  if (propio?.clase === 'enum') return `${raiz}["Enums"][${q(nombre)}]`
  if (propio?.clase === 'compuesto') return `${raiz}["CompositeTypes"][${q(nombre)}]`
  if (propio?.clase === 'dominio') return tsDeTipo(c, propio.base)
  if (c.vistas.some((v) => v.nombre === nombre)) return `${raiz}["Views"][${q(nombre)}]["Row"]`
  return 'unknown'
}

const sangria = (n: number) => '  '.repeat(n)
const vacio = (n: number) => [`${sangria(n)}[_ in never]: never`]

function bloque(n: number, nombre: string, cuerpo: string[]): string[] {
  return [`${sangria(n)}${nombre}: {`, ...cuerpo, `${sangria(n)}}`]
}

const campos = (c: Contrato, n: number, cols: readonly Columna[], nulo: boolean) =>
  cols.map(
    (col) => `${sangria(n)}${clave(col.nombre)}: ${tsDeTipo(c, col.tipo)}${nulo ? ' | null' : ''}`,
  )

function vista(c: Contrato, v: Vista): string[] {
  return bloque(4, clave(v.nombre), [
    ...bloque(5, 'Row', campos(c, 6, v.columnas, true)),
    `${sangria(5)}Relationships: []`,
  ])
}

const argumento = (c: Contrato, p: Parametro) =>
  `${sangria(6)}${clave(p.nombre)}${p.conDefault ? '?' : ''}: ${tsDeTipo(c, p.tipo)}`

function retorno(c: Contrato, r: Rpc): string[] {
  const conjunto = r.retorno.conjunto ? '[]' : ''
  if (!r.retorno.columnas)
    return [`${sangria(5)}Returns: ${tsDeTipo(c, r.retorno.tipo)}${conjunto}`]
  return [
    `${sangria(5)}Returns: {`,
    ...campos(c, 6, r.retorno.columnas, false),
    `${sangria(5)}}${conjunto}`,
  ]
}

function funcion(c: Contrato, r: Rpc): string[] {
  const args = [...r.parametros].sort((a, b) => porCodigo(a.nombre, b.nombre))
  return bloque(4, clave(r.nombre), [
    ...(args.length
      ? bloque(
          5,
          'Args',
          args.map((p) => argumento(c, p)),
        )
      : [`${sangria(5)}Args: never`]),
    ...retorno(c, r),
  ])
}

function enumsYCompuestos(c: Contrato): string[] {
  const enums = c.tipos.flatMap((t) =>
    t.clase === 'enum'
      ? [`${sangria(4)}${clave(t.nombre)}: ${t.valores.map(q).join(' | ') || 'never'}`]
      : [],
  )
  const compuestos = c.tipos.flatMap((t) =>
    t.clase === 'compuesto' ? bloque(4, clave(t.nombre), campos(c, 5, t.campos, true)) : [],
  )
  return [
    ...bloque(3, 'Enums', enums.length ? enums : vacio(4)),
    ...bloque(3, 'CompositeTypes', compuestos.length ? compuestos : vacio(4)),
  ]
}

/** El archivo TS de un contrato fijado (`origen`: la copia de la que sale). Determinista: el CI lo regenera y exige cero diff. */
export function tiposDeTs(c: Contrato, origen: string): string {
  const vistas = c.vistas.flatMap((v) => vista(c, v))
  const funciones = c.rpc.flatMap((r) => funcion(c, r))
  const esquema = bloque(2, clave(c.esquema), [
    ...bloque(3, 'Tables', vacio(4)),
    ...bloque(3, 'Views', vistas.length ? vistas : vacio(4)),
    ...bloque(3, 'Functions', funciones.length ? funciones : vacio(4)),
    ...enumsYCompuestos(c),
  ])
  // `Json` sólo si algo lo usa: el `typecheck` del proyecto corre con `noUnusedLocals`.
  const json = esquema.some((l) => /\bJson\b/.test(l))
    ? [
        'type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]',
        '',
      ]
    : []
  return [
    `// Generado por \`pnpm contrato:tipos\` desde ${origen}. No se edita.`,
    `// Tipa el cliente con \`Database & ${nombreDelTipo(c.contrato)}\` (.claude/rules/contratos.md).`,
    '',
    ...json,
    `export type ${nombreDelTipo(c.contrato)} = {`,
    ...esquema.map((l) => l.slice(2)),
    '}',
    '',
  ].join('\n')
}
