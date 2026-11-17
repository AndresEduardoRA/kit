// El manifiesto del proyecto (`z_<slug>/proyecto.yaml`, esquema proyecto/v1) escrito o puesto al día desde la semilla v2, y qué
// repos se crean. Puro: texto y datos adentro, texto y datos afuera (nuevo-proyecto.mjs lee y escribe los archivos).
//
// - Un repo que ya está en el manifiesto no se toca: ni su bloque ni sus comentarios. Por eso lo nuevo se inserta en el texto por los
//   rangos de los nodos (`parseDocument`) y no se reescribe el documento: `yaml` alinea distinto los comentarios de la plantilla.
// - Los bloques de puertos se reparten en el orden de `repos` de comun.md; ocupados son los de los otros `z_*/proyecto.yaml` y los de
//   este proyecto.
// - Cada contrato de comun.md que falta entra con `vigentes: [1]`; a uno que ya está sólo se le suman los consumidores que falten (los
//   que están en el manifiesto). Nunca se quita nada ni se toca `vigentes`.
// - `provee` y `consume` nacen vacíos: con `provee: [x@1]` y sin `contratos/x@1.json` el job `contrato` caería desde el primer PR. Los
//   escribe el paso que publica o adopta el contrato (.claude/rules/contratos.md › «El orden de un cambio»).
// Se prueba en `manifiesto-nuevo.test.mjs`.
import { isMap, isScalar, isSeq, parseDocument, stringify } from 'yaml'
import { BLOQUES, bloqueLibre, bloquesUsados, leerManifiesto } from '../proyecto/manifiesto.mjs'
import { comoProblema, exigir, Problema } from './problema.mjs'

export const PLANTILLA = '_herramientas/kit/docs/semillas/proyecto.plantilla.yaml'
export const VALIDAR_MANIFIESTO =
  'python3 _herramientas/kit/scripts/semilla/validar_semilla.py --manifiesto'

const escalar = (v) => stringify(v, { lineWidth: 0 }).trimEnd()

/** Las líneas de un repo nuevo del manifiesto, con el guion en la columna `sangria`. */
function textoDelRepo({ slug, rol, cuenta, bloque }, sangria) {
  const s = ' '.repeat(sangria)
  return `${[
    `${s}- rol: ${rol}`,
    `${s}  nombre: ${slug}-${rol}`,
    `${s}  github: ${cuenta}/${slug}-${rol}`,
    `${s}  etapa: construccion`,
    `${s}  semilla: null`,
    `${s}  puertos: { bloque: ${String(bloque)} }`,
    `${s}  provee: []`,
    `${s}  consume: []`,
  ].join('\n')}\n`
}

/** Las líneas de un contrato nuevo del manifiesto. */
function textoDelContrato(c, consumidores, sangria) {
  const s = ' '.repeat(sangria)
  return `${[
    `${s}- id: ${c.id}`,
    `${s}  proveedor: ${c.proveedor}`,
    `${s}  consumidores: [${consumidores.join(', ')}]`,
    `${s}  tipo: ${c.tipo}`,
    `${s}  vigentes: [1]`,
  ].join('\n')}\n`
}

const inicioDeLinea = (t, i) => t.lastIndexOf('\n', i - 1) + 1
const finDeLinea = (t, i) => {
  const j = t.indexOf('\n', i)
  return j < 0 ? t.length : j + 1
}
/** La columna del guion de un elemento de una lista en bloque. */
const sangriaDe = (t, item) =>
  Math.max(0, t.slice(inicioDeLinea(t, item.range[0]), item.range[0]).indexOf('-'))
/** Si los elementos de la lista van separados por una línea en blanco (con uno solo, sí: el estilo del generador). */
const separados = (t, seq) =>
  seq.items.length < 2 || t.slice(seq.items[0].range[1], seq.items[1].range[0]).includes('\n')

/** Texto para insertar al final de una lista en bloque: en una línea propia, con su separación. */
function alFinal(t, seq, bloques) {
  const pos = seq.range[1]
  const salto = pos > 0 && t[pos - 1] !== '\n' ? '\n' : ''
  const sep = separados(t, seq) ? '\n' : ''
  return { pos, quitar: 0, texto: salto + bloques.map((b) => sep + b).join('') }
}

/** Aplica los cambios de atrás para adelante (los rangos siguen valiendo); a igual posición, el primero queda primero. */
function aplicar(t, cambios) {
  const orden = cambios.map((c, i) => ({ ...c, i })).sort((a, b) => b.pos - a.pos || b.i - a.i)
  let r = t
  for (const c of orden) r = r.slice(0, c.pos) + c.texto + r.slice(c.pos + c.quitar)
  return r
}

/** Los cambios de texto de la lista `contratos` del manifiesto previo: consumidores nuevos y contratos nuevos. */
function cambiosDeContratos(t, doc, contratos, roles) {
  const cambios = []
  const nodo = doc.get('contratos', true)
  const previos = isSeq(nodo) ? nodo.items : []
  const nuevos = []
  for (const c of contratos) {
    const consumidores = (c.consumidores ?? []).filter((k) => roles.includes(k))
    const item = previos.find((i) => isMap(i) && i.get('id') === c.id)
    if (!item) {
      nuevos.push({ c, consumidores })
      continue
    }
    const actuales = item.get('consumidores', true)
    const lista = isSeq(actuales)
      ? actuales.items.map((x) => (isScalar(x) ? String(x.value) : ''))
      : []
    const faltan = consumidores.filter((k) => !lista.includes(k))
    if (!faltan.length) continue
    if (!actuales) {
      const s = ' '.repeat(sangriaDe(t, item) + 2)
      cambios.push({
        pos: item.range[1],
        quitar: 0,
        texto: `${s}consumidores: [${faltan.join(', ')}]\n`,
      })
    } else if (isSeq(actuales) && actuales.flow) {
      const [ini, fin] = actuales.range
      cambios.push({ pos: ini, quitar: fin - ini, texto: `[${[...lista, ...faltan].join(', ')}]` })
    } else if (isSeq(actuales) && actuales.items[0]) {
      const s = ' '.repeat(sangriaDe(t, actuales.items[0]))
      const pos = actuales.range[1]
      const salto = t[pos - 1] === '\n' ? '' : '\n'
      cambios.push({ pos, quitar: 0, texto: salto + faltan.map((k) => `${s}- ${k}\n`).join('') })
    } else throw new Problema(`contratos[${c.id}].consumidores: no es una lista`)
  }
  if (!nuevos.length) return cambios
  if (isSeq(nodo) && !nodo.flow && nodo.items[0]) {
    const s = sangriaDe(t, nodo.items[0])
    cambios.push(
      alFinal(
        t,
        nodo,
        nuevos.map((n) => textoDelContrato(n.c, n.consumidores, s)),
      ),
    )
  } else if (
    !nodo ||
    (isScalar(nodo) && nodo.value === null) ||
    (isSeq(nodo) && !nodo.items.length)
  ) {
    const bloque = nuevos.map((n) => textoDelContrato(n.c, n.consumidores, 2)).join('')
    if (!nodo) {
      const salto = t.endsWith('\n') ? '' : '\n'
      cambios.push({ pos: t.length, quitar: 0, texto: `${salto}\ncontratos:\n${bloque}` })
    } else {
      // `contratos: []` (o vacío): se quita el `[]` y la lista va debajo; un comentario de esa línea se queda donde estaba.
      const [ini, fin] = nodo.range
      const quitar = fin - ini + (t[ini - 1] === ' ' && /[ \n]/.test(t[fin] ?? '\n') ? 1 : 0)
      cambios.push({ pos: ini - (quitar > fin - ini ? 1 : 0), quitar, texto: '' })
      cambios.push({ pos: finDeLinea(t, fin), quitar: 0, texto: bloque })
    }
  } else
    throw new Problema(
      'contratos: el manifiesto la escribe como lista en una línea; pásala a una lista en bloque para sumar un contrato',
    )
  return cambios
}

/** Un manifiesto nuevo, entero. */
function manifiestoNuevo({ slug, nombre }, repos, contratos) {
  const roles = repos.map((r) => r.rol)
  const lineas = [
    `# Manifiesto de ${nombre} (esquema proyecto/v1). Vive suelto, sin versionar, en z_${slug}/proyecto.yaml; cada repo lleva una copia`,
    '# en .proyecto/proyecto.yaml. Lo escribe semilla-a-repo (scripts/kit/nuevo-proyecto.mjs), que no toca un repo que ya está.',
    `# Reglas: ${PLANTILLA}; se revisa con`,
    `#   ${VALIDAR_MANIFIESTO} proyecto.yaml`,
    'esquema: proyecto/v1',
    `proyecto: ${slug}`,
    `nombre: ${escalar(nombre)}`,
    'semilla: semilla/',
    '',
    'repos:',
  ]
  const cuerpo = repos.map((r) => textoDelRepo({ slug, ...r }, 2)).join('\n')
  const conContratos = contratos.length
    ? `contratos:\n${contratos
        .map((c) =>
          textoDelContrato(
            c,
            (c.consumidores ?? []).filter((k) => roles.includes(k)),
            2,
          ),
        )
        .join('')}`
    : 'contratos: []\n'
  return `${lineas.join('\n')}\n${cuerpo}\n${conContratos}`
}

const enMantenimiento = (slug, repos) =>
  `${repos.map((r) => `${slug}-${r.rol}`).join(', ')}: en mantenimiento y fuera del manifiesto. Agrégalo a mano a ` +
  `z_${slug}/proyecto.yaml con sus puertos (heredado o bloque): no se pueden adivinar`

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
  const deLaSemilla = comun.repos
  const saltados = []
  const ocupada = (rol) => ({ rol, motivo: `z_${slug}/${rol} ya existe y no está vacía` })
  /** @type {typeof deLaSemilla} */
  let agregar = []
  /** @type {any[]} */
  let enElPrevio = []
  let doc = null

  if (previo === null) {
    exigir(
      !sumar,
      `--sumar ${String(sumar)} es para un proyecto que ya existe, y ${slug} no tiene manifiesto: corre sin --sumar`,
    )
    const mant = deLaSemilla.filter((r) => r.etapa !== 'construccion')
    exigir(!mant.length, enMantenimiento(slug, mant))
    for (const r of deLaSemilla)
      if (ocupadas.has(r.rol)) saltados.push(ocupada(r.rol))
      else agregar.push(r)
  } else {
    const m = comoProblema(() => leerManifiesto(previo, archivo))
    exigir(m.proyecto === slug, `${archivo} es del proyecto «${m.proyecto}», no de «${slug}»`)
    doc = parseDocument(previo)
    enElPrevio = m.repos
    const roles = m.repos.map((r) => r.rol)
    const faltan = deLaSemilla.filter((r) => !roles.includes(r.rol))
    if (sumar) {
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
      if (ocupadas.has(sumar)) saltados.push(ocupada(sumar))
      else agregar = [r]
    } else {
      const mant = faltan.filter((r) => r.etapa !== 'construccion')
      exigir(!mant.length, enMantenimiento(slug, mant))
      exigir(
        !faltan.length,
        `el proyecto ya existe: para sumar ${faltan.map((r) => r.rol).join(', ')} usa --sumar <rol> (uno por vez)`,
      )
    }
  }

  // Los bloques: los de los otros manifiestos y los de éste, sin repetidos.
  const propio = (extra) => ({ archivo, manifiesto: { repos: [...enElPrevio, ...extra] } })
  comoProblema(() => bloqueLibre([...otros, propio([])]))
  const asignados = []
  if (bloque !== undefined) {
    const b = Number(bloque)
    exigir(
      agregar.length === 1,
      `--bloque ${String(bloque)} sirve sólo si se suma un solo repo al manifiesto (aquí son ${agregar.length})`,
    )
    exigir(BLOQUES.includes(b), `--bloque ${String(bloque)}: el bloque es de 1 a 9, nunca 4`)
    const choque = bloquesUsados([...otros, propio([])]).find((u) => u.bloque === b)
    exigir(!choque, `el bloque ${b} ya lo usa ${choque?.repo} (${choque?.archivo})`)
    asignados.push({ ...agregar[0], bloque: b })
  } else
    for (const r of agregar) {
      const ya = asignados.map((a) => ({
        nombre: `${slug}-${a.rol}`,
        puertos: { bloque: a.bloque },
      }))
      asignados.push({ ...r, bloque: comoProblema(() => bloqueLibre([...otros, propio(ya)])) })
    }
  const nuevosDelManifiesto = asignados.map((a) => ({
    rol: a.rol,
    cuenta: a.cuenta_github,
    bloque: a.bloque,
  }))

  // El texto: entero si no había, o el previo con lo nuevo insertado.
  const contratos = comun.contratos ?? []
  let texto
  if (previo === null) texto = manifiestoNuevo(comun, nuevosDelManifiesto, contratos)
  else {
    const t = previo
    const roles = [...enElPrevio.map((r) => r.rol), ...nuevosDelManifiesto.map((r) => r.rol)]
    const cambios = []
    const repos = doc.get('repos', true)
    if (nuevosDelManifiesto.length) {
      const s = sangriaDe(t, repos.items[0])
      cambios.push(
        alFinal(
          t,
          repos,
          nuevosDelManifiesto.map((r) => textoDelRepo({ slug, ...r }, s)),
        ),
      )
    }
    cambios.push(...cambiosDeContratos(t, doc, contratos, roles))
    texto = cambios.length ? aplicar(t, cambios) : t
  }
  const manifiesto = comoProblema(() => leerManifiesto(texto, archivo))

  // Qué se crea: lo que entra ahora y, sin --sumar, lo que ya estaba en construcción sin carpeta.
  const crear = asignados.map((a) => ({
    rol: a.rol,
    bloque: a.bloque,
    github: `${a.cuenta_github}/${slug}-${a.rol}`,
  }))
  if (previo !== null && !sumar)
    for (const r of enElPrevio) {
      if (r.etapa !== 'construccion')
        saltados.push({ rol: r.rol, motivo: 'en mantenimiento: no se toca' })
      else if (!deLaSemilla.some((x) => x.rol === r.rol))
        saltados.push({ rol: r.rol, motivo: 'no está en la semilla' })
      else if (ocupadas.has(r.rol)) saltados.push(ocupada(r.rol))
      else {
        exigir(
          'bloque' in r.puertos,
          `${r.nombre} tiene puertos heredados: el generador sólo crea repos con bloque`,
        )
        crear.push({ rol: r.rol, bloque: r.puertos.bloque, github: r.github })
      }
    }
  const orden = (rol) => deLaSemilla.findIndex((r) => r.rol === rol)
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

/** La copia que lleva cada repo (`.proyecto/proyecto.yaml`): el manifiesto entero con la cabecera de copia. Puro. */
export function textoDeLaCopia(texto, slug) {
  const lineas = texto.split('\n')
  let i = 0
  while (i < lineas.length && (lineas[i]?.startsWith('#') || lineas[i]?.trim() === '')) i++
  return `${[
    `# Copia del manifiesto del proyecto ${slug} (esquema proyecto/v1): el repo sólo lee ésta, nunca la carpeta de un hermano. Sale de`,
    `# z_${slug}/proyecto.yaml, que manda en lo del proyecto; si cambia, una tarea «sincronizar manifiesto» pone al día esta copia. La`,
    `# lee scripts/proyecto/manifiesto.mjs. Reglas: ${PLANTILLA}; se revisa con`,
    `#   ${VALIDAR_MANIFIESTO} .proyecto/proyecto.yaml`,
  ].join('\n')}\n${lineas.slice(i).join('\n')}`
}
