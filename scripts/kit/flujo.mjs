// Qué es flujo (docs/KIT.md › «El flujo entre el kit y los proyectos»): lo que lista scripts/kit/flujo.txt, menos lo que nunca es flujo
// (`rutaProhibida`: el producto). Un solo lector para los dos sentidos: `actualizar.mjs` (del kit al proyecto), el aviso al kit del
// orquestador (`tocaFlujo`, por la CLI de abajo) y `traer-de-proyecto.mjs` (del proyecto al kit). Viaja a cada proyecto. Puro salvo
// `patronesDelKit` y la CLI. Se prueba en `mezcla.test.ts` y `scripts/orquestador/kit-aviso.test.ts`.
import { readFileSync } from 'node:fs'

// Lo de docs/ que sí puede ser flujo: el resto de docs/ es del producto.
const DOCS_DEL_FLUJO = ['docs/FLUJO.md', 'docs/LECCIONES.md', 'docs/KIT.md']
// Una línea de docs/LECCIONES.md que sube al kit: termina en «(kit)» (va a las lecciones del kit) o en «(semilla)» (a las de las semillas).
const LECCION_QUE_SUBE = /\((kit|semilla)\)\s*$/

/**
 * Los patrones de un texto con la sintaxis de flujo.txt (y de .kit/omitir): una ruta o patrón por línea, `#` comenta. Puro.
 * @param {string} texto
 */
export const leerPatrones = (texto) =>
  texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))

/** Los patrones del flujo.txt que está junto a este archivo (el del kit, o el que trajo el proyecto). */
export const patronesDelKit = () =>
  leerPatrones(readFileSync(new URL('./flujo.txt', import.meta.url), 'utf8'))

/**
 * Si una ruta coincide con un patrón: `**` cruza carpetas, `*` no; sin comodines, la ruta exacta. Puro.
 * @param {string} ruta  @param {string} patron
 */
export function coincide(ruta, patron) {
  const re = patron
    .split('**')
    .map((parte) =>
      parte
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*'),
    )
    .join('.*')
  return new RegExp(`^${re}$`).test(ruta)
}

/**
 * Lo que nunca es flujo, diga lo que diga flujo.txt: `src/`, `supabase/`, `design/` y `docs/` salvo FLUJO, LECCIONES y KIT. Puro.
 * @param {string} ruta
 */
export const rutaProhibida = (ruta) =>
  /^(src|supabase|design)\//.test(ruta) ||
  (ruta.startsWith('docs/') && !DOCS_DEL_FLUJO.includes(ruta))

/**
 * Si una ruta es flujo según esos patrones (y no está prohibida). Puro.
 * @param {string} ruta  @param {string[]} patrones
 */
export const esFlujo = (ruta, patrones) =>
  !rutaProhibida(ruta) && patrones.some((p) => coincide(ruta, p))

/**
 * Las líneas agregadas de un parche (el `patch` de `pulls/<n>/files`) que terminan en `(kit)` o `(semilla)`, sin el `+`. Puro.
 * @param {string} patch
 */
export function leccionesDelParche(patch) {
  /** @type {{ kit: string[], semilla: string[] }} */
  const out = { kit: [], semilla: [] }
  for (const l of patch.split('\n')) {
    if (!l.startsWith('+') || l.startsWith('+++')) continue
    const m = LECCION_QUE_SUBE.exec(l)
    if (m) out[/** @type {'kit' | 'semilla'} */ (m[1])].push(l.slice(1).trim())
  }
  return out
}

/**
 * Lo de un PR integrado que sube al kit: las rutas de flujo que tocó (también por su nombre de antes, si se renombró) y las lecciones
 * `(kit)` y `(semilla)` que agregó. `docs/LECCIONES.md` cuenta sólo por esas líneas; sin `patch` (un archivo grande), cuenta entero por
 * las dudas. `null` si no toca nada de flujo. Puro.
 * @param {{ filename: string, previous_filename?: string, patch?: string }[]} archivos  los de `pulls/<n>/files`
 * @param {string[]} patrones
 */
export function tocaFlujo(archivos, patrones) {
  /** @type {{ rutas: string[], kit: string[], semilla: string[] }} */
  const toca = { rutas: [], kit: [], semilla: [] }
  for (const a of archivos) {
    if (a.filename === 'docs/LECCIONES.md') {
      if (a.patch === undefined) toca.rutas.push(a.filename)
      else {
        const l = leccionesDelParche(a.patch)
        toca.kit.push(...l.kit)
        toca.semilla.push(...l.semilla)
      }
    } else if ([a.filename, a.previous_filename].some((r) => r && esFlujo(r, patrones)))
      toca.rutas.push(a.filename)
  }
  return toca.rutas.length + toca.kit.length + toca.semilla.length ? toca : null
}
