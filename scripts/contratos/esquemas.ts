// La forma de un contrato de base (`contratos/<id>@<n>.json`), la de su configuración (`contratos/<id>.config.json`) y el texto
// canónico que se escribe: claves en un orden fijo armado a mano, listas ordenadas por código (nunca `localeCompare`: PGlite ordena
// con colación C y la base real con ICU) y `JSON.stringify(…, null, 2)`. La guarda de versiones publicadas compara bytes, así que
// dos corridas sobre la misma base tienen que dar el mismo texto. Reglas: `.claude/rules/contratos.md`.
import { z } from 'zod'

export const ROLES = ['anon', 'authenticated', 'service_role'] as const
export type Rol = (typeof ROLES)[number]

// Un identificador de Postgres sin comillas: lo único que entra como literal en el SQL de la introspección.
export const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/
const identificador = z
  .string()
  .regex(IDENTIFICADOR, { error: 'va en minúsculas, números y _ (un identificador sin comillas)' })

export const esquemaDeConfig = z.strictObject({
  esquema: identificador,
  objetos: z.array(identificador).min(1, { error: 'lista al menos una vista o función' }),
})
export type ConfigDeContrato = z.infer<typeof esquemaDeConfig>

const PRIVILEGIOS_DE_VISTA = ['delete', 'insert', 'select', 'update'] as const
const porRol = <T extends z.ZodType>(privilegio: T) =>
  z.strictObject({
    anon: z.array(privilegio),
    authenticated: z.array(privilegio),
    service_role: z.array(privilegio),
  })

const columna = z.strictObject({ nombre: z.string().min(1), tipo: z.string().min(1) })
export type Columna = z.infer<typeof columna>

const vista = z.strictObject({
  nombre: z.string().min(1),
  columnas: z.array(columna),
  permisos: porRol(z.enum(PRIVILEGIOS_DE_VISTA)),
})
export type Vista = z.infer<typeof vista>

const parametro = z.strictObject({
  nombre: z.string().min(1),
  tipo: z.string().min(1),
  conDefault: z.boolean(),
})
export type Parametro = z.infer<typeof parametro>

const retorno = z.strictObject({
  conjunto: z.boolean(),
  tipo: z.string().min(1),
  columnas: z.array(columna).optional(),
})
export type Retorno = z.infer<typeof retorno>

const rpc = z.strictObject({
  nombre: z.string().min(1),
  parametros: z.array(parametro),
  retorno,
  permisos: porRol(z.literal('execute')),
})
export type Rpc = z.infer<typeof rpc>

const tipo = z.discriminatedUnion('clase', [
  z.strictObject({
    nombre: z.string().min(1),
    clase: z.literal('enum'),
    valores: z.array(z.string()),
  }),
  z.strictObject({
    nombre: z.string().min(1),
    clase: z.literal('compuesto'),
    campos: z.array(columna),
  }),
  z.strictObject({
    nombre: z.string().min(1),
    clase: z.literal('dominio'),
    base: z.string().min(1),
  }),
])
export type Tipo = z.infer<typeof tipo>

export const esquemaDeContrato = z.strictObject({
  contrato: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/),
  version: z.int().positive(),
  tipo: z.literal('base'),
  esquema: identificador,
  usoDelEsquema: z.array(z.enum(ROLES)),
  vistas: z.array(vista),
  rpc: z.array(rpc),
  tipos: z.array(tipo),
})
export type Contrato = z.infer<typeof esquemaDeContrato>
export type PermisosDeVista = Vista['permisos']
export type PermisosDeRpc = Rpc['permisos']

// Por código: los bytes UTF-8 se ordenan como los puntos de código, igual que `collate "C"`.
export const porCodigo = (a: string, b: string): number =>
  Buffer.compare(Buffer.from(a), Buffer.from(b))
const porNombre = <T extends { nombre: string }>(lista: readonly T[]): T[] =>
  [...lista].sort((a, b) => porCodigo(a.nombre, b.nombre))
const ordenados = <T extends string>(lista: readonly T[]): T[] => [...lista].sort(porCodigo)

const columnas = (lista: readonly Columna[]) =>
  porNombre(lista).map((c) => ({ nombre: c.nombre, tipo: c.tipo }))

function permisos<T extends string>(p: Record<Rol, readonly T[]>): Record<Rol, T[]> {
  return {
    anon: ordenados(p.anon),
    authenticated: ordenados(p.authenticated),
    service_role: ordenados(p.service_role),
  }
}

function tipoCanonico(t: Tipo): Tipo {
  switch (t.clase) {
    case 'enum':
      // El orden de un enum es el de la base (`enumsortorder`): es parte del tipo.
      return { nombre: t.nombre, clase: 'enum', valores: [...t.valores] }
    case 'compuesto':
      return { nombre: t.nombre, clase: 'compuesto', campos: columnas(t.campos) }
    case 'dominio':
      return { nombre: t.nombre, clase: 'dominio', base: t.base }
  }
}

function rpcCanonica(r: Rpc): Rpc {
  return {
    nombre: r.nombre,
    // Los parámetros, en el orden declarado.
    parametros: r.parametros.map((p) => ({
      nombre: p.nombre,
      tipo: p.tipo,
      conDefault: p.conDefault,
    })),
    retorno: {
      conjunto: r.retorno.conjunto,
      tipo: r.retorno.tipo,
      ...(r.retorno.columnas ? { columnas: columnas(r.retorno.columnas) } : {}),
    },
    permisos: permisos(r.permisos),
  }
}

/** El contrato con sus claves en el orden fijo y sus listas ordenadas. Puro. */
export function canonico(c: Contrato): Contrato {
  return {
    contrato: c.contrato,
    version: c.version,
    tipo: c.tipo,
    esquema: c.esquema,
    usoDelEsquema: ordenados(c.usoDelEsquema),
    vistas: porNombre(c.vistas).map((v) => ({
      nombre: v.nombre,
      columnas: columnas(v.columnas),
      permisos: permisos(v.permisos),
    })),
    rpc: porNombre(c.rpc).map(rpcCanonica),
    tipos: porNombre(c.tipos).map(tipoCanonico),
  }
}

/** El texto que se escribe en `contratos/<id>@<n>.json`: el mismo byte a byte para el mismo contrato. Puro. */
export const textoDelContrato = (c: Contrato): string => `${JSON.stringify(canonico(c), null, 2)}\n`

/** Lee un contrato ya escrito: el JSON validado, o los problemas con la ruta de cada campo. Puro. */
export function leerContrato(
  texto: string,
  archivo: string,
): { ok: true; contrato: Contrato } | { ok: false; problemas: string[] } {
  let crudo: unknown
  try {
    crudo = JSON.parse(texto)
  } catch {
    return { ok: false, problemas: [`${archivo}: no es JSON válido`] }
  }
  const r = esquemaDeContrato.safeParse(crudo)
  if (r.success) return { ok: true, contrato: r.data }
  return {
    ok: false,
    problemas: r.error.issues.map(
      (i) => `${archivo}: ${i.path.join('.') || '(raíz)'}: ${i.message}`,
    ),
  }
}
