// El texto del manifiesto del proyecto (lo usa manifiesto-nuevo.mjs): uno nuevo entero, o el previo con lo nuevo insertado por los
// rangos de sus nodos (`parseDocument`), sin reescribir el documento: `yaml` alinea distinto los comentarios (los de la plantilla van
// en columna) y un repo que ya está no se toca, ni sus comentarios. También la copia que lleva cada repo. Todo puro. Se prueba en
// `manifiesto-nuevo.test.mjs`.
import { isMap, isScalar, isSeq, stringify } from 'yaml'
import { Problema } from './problema.mjs'

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

/** Un manifiesto nuevo, entero. Puro. */
export function manifiestoNuevo({ slug, nombre }, repos, contratos) {
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

/**
 * El manifiesto previo con los repos nuevos al final de `repos` y los contratos (o consumidores) que faltan. Puro.
 * @param {string} t  el texto previo  @param {import('yaml').Document} doc  su documento
 * @param {{ slug: string, nuevos: { rol: string, cuenta: string, bloque: number }[], contratos: any[], roles: string[] }} lo
 */
export function textoConLoNuevo(t, doc, { slug, nuevos, contratos, roles }) {
  const cambios = []
  const repos = doc.get('repos', true)
  if (nuevos.length && isSeq(repos) && repos.items[0]) {
    const s = sangriaDe(t, repos.items[0])
    cambios.push(
      alFinal(
        t,
        repos,
        nuevos.map((r) => textoDelRepo({ slug, ...r }, s)),
      ),
    )
  }
  cambios.push(...cambiosDeContratos(t, doc, contratos, roles))
  return cambios.length ? aplicar(t, cambios) : t
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
