// El manifiesto del proyecto (`z_<slug>/proyecto.yaml`, esquema proyecto/v1) escrito o puesto al día desde la semilla v2, y qué
// repos se crean. Puro: datos adentro, texto y datos afuera (nuevo-proyecto.mjs lee y escribe los archivos; el texto lo arma
// manifiesto-texto.mjs).
//
// - Un repo que ya está en el manifiesto no se toca: ni su bloque ni sus comentarios.
// - Los bloques de puertos se reparten en el orden de `repos` de comun.md; ocupados son los de los otros `z_*/proyecto.yaml` y los de
//   este proyecto.
// - Cada contrato de comun.md que falta entra con `vigentes: [1]`; a uno que ya está sólo se le suman los consumidores que falten (los
//   que están en el manifiesto). Nunca se quita nada ni se toca `vigentes`.
// - `provee` y `consume` nacen vacíos: con `provee: [x@1]` y sin `contratos/x@1.json` el job `contrato` caería desde el primer PR. Los
//   escribe el paso que publica o adopta el contrato (.claude/rules/contratos.md › «El orden de un cambio»).
// Se prueba en `manifiesto-nuevo.test.mjs`.
import { parseDocument } from 'yaml'
import { BLOQUES, bloqueLibre, bloquesUsados, leerManifiesto } from '../proyecto/manifiesto.mjs'
import { manifiestoNuevo, textoConLoNuevo, textoDeLaCopia } from './manifiesto-texto.mjs'
import { comoProblema, exigir } from './problema.mjs'

export { textoDeLaCopia }

const enMantenimiento = (slug, repos) =>
  `${repos.map((r) => `${slug}-${r.rol}`).join(', ')}: en mantenimiento y fuera del manifiesto. Agrégalo a mano a ` +
  `z_${slug}/proyecto.yaml con sus puertos (heredado o bloque): no se pueden adivinar`
const ocupada = (slug, rol) => ({ rol, motivo: `z_${slug}/${rol} ya existe y no está vacía` })

/** Los repos de la semilla que entran ahora al manifiesto (y los saltados), o el motivo para negarse. */
function queAgregar({ comun, previo, ocupadas, sumar }) {
  const { slug, repos: deLaSemilla } = comun
  const saltados = []
  if (!previo) {
    exigir(
      !sumar,
      `--sumar ${String(sumar)} es para un proyecto que ya existe, y ${slug} no tiene manifiesto: corre sin --sumar`,
    )
    const mant = deLaSemilla.filter((r) => r.etapa !== 'construccion')
    exigir(!mant.length, enMantenimiento(slug, mant))
    const agregar = deLaSemilla.filter((r) => !ocupadas.has(r.rol))
    for (const r of deLaSemilla) if (ocupadas.has(r.rol)) saltados.push(ocupada(slug, r.rol))
    return { agregar, saltados }
  }
  const roles = previo.repos.map((r) => r.rol)
  if (!sumar) {
    const faltan = deLaSemilla.filter((r) => !roles.includes(r.rol))
    const mant = faltan.filter((r) => r.etapa !== 'construccion')
    exigir(!mant.length, enMantenimiento(slug, mant))
    exigir(
      !faltan.length,
      `el proyecto ya existe: para sumar ${faltan.map((r) => r.rol).join(', ')} usa --sumar <rol> (uno por vez)`,
    )
    return { agregar: [], saltados }
  }
  const r = deLaSemilla.find((x) => x.rol === sumar)
  exigir(
    r,
    `${sumar} no es un repo de la semilla (son: ${deLaSemilla.map((x) => x.rol).join(', ')})`,
  )
  exigir(
    !roles.includes(sumar),
    `${slug}-${sumar} ya está en el manifiesto: sin --sumar se crea si le falta la carpeta`,
  )
  exigir(r.etapa === 'construccion', enMantenimiento(slug, [r]))
  if (ocupadas.has(sumar)) return { agregar: [], saltados: [ocupada(slug, sumar)] }
  return { agregar: [r], saltados }
}

/** El bloque de cada repo que entra: el pedido (uno solo) o el primero libre entre los de la máquina y los de este proyecto. */
function asignarBloques({ slug, agregar, enElPrevio, otros, archivo, bloque }) {
  const propio = (extra) => ({ archivo, manifiesto: { repos: [...enElPrevio, ...extra] } })
  comoProblema(() => bloqueLibre([...otros, propio([])])) // falla si ya hay un bloque repetido
  if (bloque !== undefined) {
    const b = Number(bloque)
    exigir(
      agregar.length === 1,
      `--bloque ${String(bloque)} sirve sólo si se suma un solo repo al manifiesto (aquí son ${agregar.length})`,
    )
    exigir(BLOQUES.includes(b), `--bloque ${String(bloque)}: el bloque es de 1 a 9, nunca 4`)
    const choque = bloquesUsados([...otros, propio([])]).find((u) => u.bloque === b)
    exigir(!choque, `el bloque ${b} ya lo usa ${choque?.repo} (${choque?.archivo})`)
    return [{ ...agregar[0], bloque: b }]
  }
  const asignados = []
  for (const r of agregar) {
    const ya = asignados.map((a) => ({ nombre: `${slug}-${a.rol}`, puertos: { bloque: a.bloque } }))
    asignados.push({ ...r, bloque: comoProblema(() => bloqueLibre([...otros, propio(ya)])) })
  }
  return asignados
}

/** Sin --sumar, lo que ya estaba en el manifiesto: se crea si está en construcción, tiene semilla y le falta la carpeta. */
function queCrearDelPrevio({ slug, enElPrevio, deLaSemilla, ocupadas }) {
  const crear = []
  const saltados = []
  for (const r of enElPrevio) {
    if (r.etapa !== 'construccion')
      saltados.push({ rol: r.rol, motivo: 'en mantenimiento: no se toca' })
    else if (!deLaSemilla.some((x) => x.rol === r.rol))
      saltados.push({ rol: r.rol, motivo: 'no está en la semilla' })
    else if (ocupadas.has(r.rol)) saltados.push(ocupada(slug, r.rol))
    else {
      exigir(
        'bloque' in r.puertos,
        `${r.nombre} tiene puertos heredados: el generador sólo crea repos con bloque`,
      )
      crear.push({ rol: r.rol, bloque: r.puertos.bloque, github: r.github })
    }
  }
  return { crear, saltados }
}

/**
 * El manifiesto nuevo o puesto al día y qué repos se crean.
 * @param {{ comun: { slug: string, nombre: string, repos: { rol: string, cuenta_github: string, etapa: string }[],
 *   contratos?: { id: string, proveedor: string, consumidores?: string[], tipo: string }[] }, previo?: string | null,
 *   archivo?: string, otros?: { archivo: string, manifiesto: any }[], ocupadas?: Set<string>, sumar?: string,
 *   bloque?: number | string }} entrada
 */
export function manifiestoDelProyecto({
  comun,
  previo = null,
  archivo = 'proyecto.yaml',
  otros = [],
  ocupadas = new Set(),
  sumar,
  bloque,
}) {
  const { slug } = comun
  const m = previo === null ? null : comoProblema(() => leerManifiesto(previo, archivo))
  exigir(!m || m.proyecto === slug, `${archivo} es del proyecto «${m?.proyecto}», no de «${slug}»`)
  const enElPrevio = m?.repos ?? []
  const { agregar, saltados } = queAgregar({ comun, previo: m, ocupadas, sumar })
  const asignados = asignarBloques({ slug, agregar, enElPrevio, otros, archivo, bloque })
  const nuevos = asignados.map((a) => ({ rol: a.rol, cuenta: a.cuenta_github, bloque: a.bloque }))
  const contratos = comun.contratos ?? []
  const texto =
    previo === null
      ? manifiestoNuevo(comun, nuevos, contratos)
      : textoConLoNuevo(previo, parseDocument(previo), {
          slug,
          nuevos,
          contratos,
          roles: [...enElPrevio.map((r) => r.rol), ...nuevos.map((r) => r.rol)],
        })
  const manifiesto = comoProblema(() => leerManifiesto(texto, archivo))
  const crear = asignados.map((a) => ({
    rol: a.rol,
    bloque: a.bloque,
    github: `${a.cuenta_github}/${slug}-${a.rol}`,
  }))
  if (m && !sumar) {
    const delPrevio = queCrearDelPrevio({ slug, enElPrevio, deLaSemilla: comun.repos, ocupadas })
    crear.push(...delPrevio.crear)
    saltados.push(...delPrevio.saltados)
  }
  const orden = (rol) => comun.repos.findIndex((r) => r.rol === rol)
  crear.sort((a, b) => orden(a.rol) - orden(b.rol))
  return {
    texto,
    manifiesto,
    crear,
    agregados: asignados.map((a) => a.rol),
    saltados,
    cambio: texto !== previo,
  }
}
