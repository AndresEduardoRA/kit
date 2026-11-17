// ¿Cumple la base lo que prometió una versión publicada? «Tener más está bien» vale para objetos, columnas y campos; no vale para los
// permisos (de más o de menos, incluido el uso del esquema) ni para los valores de un enum: un valor nuevo rompe al consumidor que lee.
// Los parámetros se comparan por nombre (PostgREST llama por nombre): renombrar, cambiar el tipo, perder el default o sumar uno sin
// default rompe a quien llama; ganar un default o sumar uno con default, no. La tabla está en `.claude/rules/contratos.md`. Puro.
import {
  ROLES,
  type Columna,
  type Contrato,
  type Parametro,
  type Retorno,
  type Rpc,
  type Tipo,
  type Vista,
} from './esquemas'

const lista = (xs: readonly string[]) => `[${xs.join(', ')}]`
const mismos = (a: readonly string[], b: readonly string[]) => lista(a) === lista(b)

// Las columnas (o campos) prometidas que faltan o cambiaron de tipo; las de más pasan.
function columnas(
  prometidas: readonly Columna[],
  actuales: readonly Columna[],
  que: string,
): string[] {
  const hoy = new Map(actuales.map((c) => [c.nombre, c.tipo]))
  return prometidas.flatMap((c) => {
    const tipo = hoy.get(c.nombre)
    if (tipo === undefined) return [`falta ${que} \`${c.nombre}\``]
    if (tipo !== c.tipo) return [`${que} \`${c.nombre}\` era \`${c.tipo}\` y ahora es \`${tipo}\``]
    return []
  })
}

function permisos(
  prometidos: Record<string, readonly string[]>,
  actuales: Record<string, readonly string[]>,
) {
  return ROLES.flatMap((rol) => {
    const dice = [...(prometidos[rol] ?? [])].sort()
    const da = [...(actuales[rol] ?? [])].sort()
    return mismos(dice, da)
      ? []
      : [`permisos de ${rol}: el contrato dice ${lista(dice)}, la base da ${lista(da)}`]
  })
}

function vista(v: Vista, hoy: Vista | undefined): string[] {
  if (!hoy) return [`falta la vista \`${v.nombre}\``]
  return [
    ...columnas(v.columnas, hoy.columnas, 'la columna'),
    ...permisos(v.permisos, hoy.permisos),
  ].map((d) => `vista ${v.nombre}: ${d}`)
}

function parametros(prometidos: readonly Parametro[], actuales: readonly Parametro[]): string[] {
  const hoy = new Map(actuales.map((p) => [p.nombre, p]))
  const antes = new Set(prometidos.map((p) => p.nombre))
  const viejos = prometidos.flatMap((p) => {
    const a = hoy.get(p.nombre)
    if (!a) return [`falta el parámetro \`${p.nombre}\``]
    if (a.tipo !== p.tipo)
      return [`el parámetro \`${p.nombre}\` era \`${p.tipo}\` y ahora es \`${a.tipo}\``]
    if (p.conDefault && !a.conDefault) return [`el parámetro \`${p.nombre}\` perdió su default`]
    return []
  })
  const nuevos = actuales
    .filter((a) => !antes.has(a.nombre) && !a.conDefault)
    .map((a) => `parámetro nuevo sin default \`${a.nombre}\`: rompe a quien llama sin él`)
  return [...viejos, ...nuevos]
}

function retorno(r: Retorno, hoy: Retorno): string[] {
  const d: string[] = []
  if (r.conjunto !== hoy.conjunto)
    d.push(
      `el retorno ${r.conjunto ? 'era un conjunto y ahora no' : 'no era un conjunto y ahora sí'}`,
    )
  if (r.tipo !== hoy.tipo) d.push(`el retorno era \`${r.tipo}\` y ahora es \`${hoy.tipo}\``)
  if (!r.columnas !== !hoy.columnas)
    d.push(
      `el retorno ${r.columnas ? 'eran filas y ahora es un valor' : 'era un valor y ahora son filas'}`,
    )
  return [...d, ...columnas(r.columnas ?? [], hoy.columnas ?? [], 'la columna del retorno')]
}

function rpc(r: Rpc, hoy: Rpc | undefined): string[] {
  if (!hoy) return [`falta la rpc \`${r.nombre}\``]
  return [
    ...parametros(r.parametros, hoy.parametros),
    ...retorno(r.retorno, hoy.retorno),
    ...permisos(r.permisos, hoy.permisos),
  ].map((d) => `rpc ${r.nombre}: ${d}`)
}

function tipo(t: Tipo, hoy: Tipo | undefined): string[] {
  if (!hoy) return [`falta el tipo \`${t.nombre}\``]
  const en = `tipo ${t.nombre}`
  if (t.clase !== hoy.clase) return [`${en}: era ${t.clase} y ahora es ${hoy.clase}`]
  if (t.clase === 'enum' && hoy.clase === 'enum')
    return mismos(t.valores, hoy.valores)
      ? []
      : [`${en}: el enum tenía ${lista(t.valores)} y ahora tiene ${lista(hoy.valores)}`]
  if (t.clase === 'compuesto' && hoy.clase === 'compuesto')
    return columnas(t.campos, hoy.campos, 'el campo').map((d) => `${en}: ${d}`)
  if (t.clase === 'dominio' && hoy.clase === 'dominio' && t.base !== hoy.base)
    return [`${en}: el dominio era de \`${t.base}\` y ahora es de \`${hoy.base}\``]
  return []
}

const porNombre = <T extends { nombre: string }>(xs: readonly T[]) =>
  new Map(xs.map((x) => [x.nombre, x]))

/** Lo que la base (`actual`, leída con los mismos objetos) ya no cumple de `publicado`, un texto por diferencia. Puro. */
export function diferencias(publicado: Contrato, actual: Contrato): string[] {
  const vistas = porNombre(actual.vistas)
  const rpcs = porNombre(actual.rpc)
  const tipos = porNombre(actual.tipos)
  const uso = mismos([...publicado.usoDelEsquema].sort(), [...actual.usoDelEsquema].sort())
    ? []
    : [
        `uso del esquema ${publicado.esquema}: el contrato dice ${lista(publicado.usoDelEsquema)}, la base da ${lista(actual.usoDelEsquema)}`,
      ]
  return [
    ...uso,
    ...publicado.vistas.flatMap((v) => vista(v, vistas.get(v.nombre))),
    ...publicado.rpc.flatMap((r) => rpc(r, rpcs.get(r.nombre))),
    ...publicado.tipos.flatMap((t) => tipo(t, tipos.get(t.nombre))),
  ]
}
