// Las lecciones que sube un proyecto al kit (docs/KIT.md › «El flujo entre el kit y los proyectos»): las líneas nuevas de su
// docs/LECCIONES.md que terminan en `(kit)` (van al docs/LECCIONES.md del kit, en la misma sección) o en `(semilla)` (a
// docs/semillas/LECCIONES.md › «Sugerencias de los proyectos»), cada una con el sufijo `(<repo>, PR #<n>)`: así `quitarRepetidas`
// (mezcla.mjs) la reconoce al bajar al proyecto. Todo puro. Sólo del kit (no viaja). Se prueba en `traer-de-proyecto.test.ts`.

export const SUGERENCIAS = 'Sugerencias de los proyectos'
const QUE_SUBE = /\((kit|semilla)\)\s*$/

/** El texto de una lección sin su paréntesis final: dos lecciones con el mismo, son la misma. @param {string} l */
const clave = (l) => l.replace(/\s*\([^()]*\)\s*$/, '').trim()

/**
 * Las lecciones `(kit)` y `(semilla)` que están en `despues` y no en `antes`, con la sección `## ` donde quedaron. Puro.
 * @param {string} antes  @param {string} despues
 * @returns {{ seccion: string, linea: string, tipo: 'kit' | 'semilla' }[]}
 */
export function leccionesNuevas(antes, despues) {
  const viejas = new Set(antes.split('\n').map(clave))
  /** @type {{ seccion: string, linea: string, tipo: 'kit' | 'semilla' }[]} */
  const out = []
  let seccion = ''
  for (const l of despues.split('\n')) {
    const h = /^## (.+?)\s*$/.exec(l)
    if (h) seccion = h[1] ?? ''
    const m = QUE_SUBE.exec(l)
    if (m && /^\s*- /.test(l) && !viejas.has(clave(l)))
      out.push({ seccion, linea: l.trimEnd(), tipo: /** @type {'kit' | 'semilla'} */ (m[1]) })
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
  const lineas = md.replace(/\s+$/, '').split('\n')
  if (lineas.some((l) => clave(l) === clave(linea))) return md
  const i = lineas.findIndex((l) => l.trim() === `## ${seccion}`)
  if (i < 0) return `${[...lineas, '', `## ${seccion}`, '', linea].join('\n')}\n`
  let fin = lineas.findIndex((l, k) => k > i && /^## /.test(l))
  if (fin < 0) fin = lineas.length
  // Tras la última línea con texto de la sección (las vacías antes del título siguiente quedan después).
  while (fin > i + 1 && !lineas[fin - 1]?.trim()) fin--
  // Tras un párrafo (la cabecera de la sección) va una línea vacía; tras una viñeta o su continuación, no.
  const parrafo = fin === i + 1 || !/^(\s|- )/.test(lineas[fin - 1] ?? '')
  lineas.splice(fin, 0, ...(parrafo ? ['', linea] : [linea]))
  return `${lineas.join('\n')}\n`
}
