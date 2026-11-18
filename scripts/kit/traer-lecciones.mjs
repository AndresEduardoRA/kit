// Las lecciones que sube un proyecto al kit (docs/KIT.md › «El flujo entre el kit y los proyectos»): las viñetas nuevas de su
// docs/LECCIONES.md (con sus líneas de continuación) que terminan en `(kit)` (van al docs/LECCIONES.md del kit, en la misma sección) o en `(semilla)` (a
// docs/semillas/LECCIONES.md › «Sugerencias de los proyectos»), cada una con el sufijo `(<repo>, PR #<n>)`: así `quitarRepetidas`
// (mezcla.mjs) la reconoce al bajar al proyecto. Todo puro. Sólo del kit (no viaja). Se prueba en `traer-de-proyecto.test.ts`.

export const SUGERENCIAS = 'Sugerencias de los proyectos'
const QUE_SUBE = /\((kit|semilla)\)\s*$/

/**
 * El texto de una lección sin su paréntesis final ni sus saltos de línea: dos lecciones con el mismo son la misma, aunque una venga
 * partida en dos líneas. @param {string} l
 */
const clave = (l) =>
  l
    .replace(/\s*\([^()]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Las viñetas de un markdown (`- …` con sus líneas de continuación, las sangradas que la siguen), cada una con la sección `## `
 * donde está y sus líneas unidas con `\n`. Puro.
 * @param {string} md
 */
function vinetas(md) {
  /** @type {{ seccion: string, lineas: string[] }[]} */
  const out = []
  /** @type {string[] | null} */
  let actual = null
  let seccion = ''
  for (const l of md.split('\n')) {
    const h = /^## (.+?)\s*$/.exec(l)
    if (h) seccion = h[1] ?? ''
    if (/^\s*- /.test(l)) out.push({ seccion, lineas: (actual = [l.trimEnd()]) })
    else if (actual && /^\s+\S/.test(l)) actual.push(l.trimEnd())
    else actual = null
  }
  return out.map((v) => ({ seccion: v.seccion, texto: v.lineas.join('\n') }))
}

/**
 * Las lecciones `(kit)` y `(semilla)` que están en `despues` y no en `antes`, con la sección `## ` donde quedaron. Una lección es la
 * viñeta entera: si sigue en líneas sangradas, `linea` las lleva (unidas con `\n`) y la marca va al final de la última. Puro.
 * @param {string} antes  @param {string} despues
 * @returns {{ seccion: string, linea: string, tipo: 'kit' | 'semilla' }[]}
 */
export function leccionesNuevas(antes, despues) {
  const viejas = new Set(vinetas(antes).map((v) => clave(v.texto)))
  /** @type {{ seccion: string, linea: string, tipo: 'kit' | 'semilla' }[]} */
  const out = []
  for (const { seccion, texto } of vinetas(despues)) {
    const m = QUE_SUBE.exec(texto)
    if (m && !viejas.has(clave(texto)))
      out.push({ seccion, linea: texto, tipo: /** @type {'kit' | 'semilla'} */ (m[1]) })
  }
  return out
}

/**
 * La lección con el sufijo de dónde salió en lugar de `(kit)` o `(semilla)`. Puro.
 * @param {string} linea  @param {string} repo  @param {string} pr
 */
export const conOrigen = (linea, repo, pr) => linea.replace(QUE_SUBE, `(${repo}, PR #${pr})`)

/**
 * `md` con la lección al final de su sección (la sección se crea al final si falta); igual si ya tenía una con el mismo texto. Puro.
 * @param {string} md  @param {string} seccion  @param {string} linea
 */
export function sumarLeccion(md, seccion, linea) {
  if (vinetas(md).some((v) => clave(v.texto) === clave(linea))) return md
  const lineas = md.replace(/\s+$/, '').split('\n')
  const i = lineas.findIndex((l) => l.trim() === `## ${seccion}`)
  if (i < 0) return `${[...lineas, '', `## ${seccion}`, '', linea].join('\n')}\n`
  let fin = lineas.findIndex((l, k) => k > i && /^## /.test(l))
  if (fin < 0) fin = lineas.length
  // Tras la última línea con texto de la sección (las vacías antes del título siguiente quedan después).
  while (fin > i + 1 && !lineas[fin - 1]?.trim()) fin--
  // Tras un párrafo (la cabecera de la sección) va una línea vacía; tras una viñeta o su continuación, no.
  const parrafo = fin === i + 1 || !/^(\s|- )/.test(lineas[fin - 1] ?? '')
  lineas.splice(fin, 0, ...(parrafo ? [''] : []), ...linea.split('\n'))
  return `${lineas.join('\n')}\n`
}
