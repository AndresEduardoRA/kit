// Qué es flujo (docs/KIT.md › «El flujo entre el kit y los proyectos»): lo que lista scripts/kit/flujo.txt, menos lo que nunca es flujo
// (`rutaProhibida`: el producto). Un solo lector para los dos sentidos: `actualizar.mjs` (del kit al proyecto), el aviso al kit del
// orquestador (`tocaFlujo`, por la CLI de abajo) y `traer-de-proyecto.mjs` (del proyecto al kit). Viaja a cada proyecto. Puro salvo
// `patronesDelKit` y la CLI. Se prueba en `mezcla.test.ts` y `scripts/orquestador/kit-aviso.test.ts`.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Lo de docs/ que sí puede ser flujo: el resto de docs/ es del producto.
const DOCS_DEL_FLUJO = ['docs/FLUJO.md', 'docs/LECCIONES.md', 'docs/KIT.md']
// Una línea de docs/LECCIONES.md que sube al kit: termina en «(kit)» (va a las lecciones del kit) o en «(semilla)» (a las de las semillas).
const LECCION_QUE_SUBE = /\((kit|semilla)\)\s*$/
// Las rutas que lista la tarea del kit: las primeras, y «y N más».
const TOPE_DE_RUTAS = 50

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

// Lo que llega al issue del kit sale de un PR, no del kit: una lección queda en una línea con tope, y una ruta con caracteres de
// control o comillas invertidas (que romperían su `código`) no se lista.
const TOPE_DE_LECCION = 300
const RUTA_RARA = /[\u0000-\u001f\u007f`]/
/** @param {string} l */
function vineta(l) {
  const una = l.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  const corta = una.length > TOPE_DE_LECCION ? `${una.slice(0, TOPE_DE_LECCION)}…` : una
  return corta.startsWith('- ') ? corta : `- ${corta}`
}

/**
 * La spec de la tarea del kit (plantillas/traer-de-proyecto.md) para un PR integrado: `{{REPO_GH}}`, `{{REPO}}`, `{{PR}}`, `{{RUTAS}}`
 * (viñetas, con tope) y `{{LECCIONES}}`, en una sola pasada (un valor con `{{X}}` no se vuelve a reemplazar). Puro.
 * @param {string} plantilla
 * @param {{ repoGh: string, nombre: string, pr: string, toca: { rutas: string[], kit: string[], semilla: string[] } }} d
 */
export function specAlKit(plantilla, { repoGh, nombre, pr, toca }) {
  const listables = toca.rutas.filter((r) => !RUTA_RARA.test(r))
  const raras = toca.rutas.length - listables.length
  const sobran = listables.length - TOPE_DE_RUTAS
  const rutas = toca.rutas.length
    ? [
        ...listables.slice(0, TOPE_DE_RUTAS).map((r) => `- \`${r}\``),
        ...(sobran > 0 ? [`- y ${sobran} más`] : []),
        ...(raras > 0 ? [`- y ${raras} con caracteres que no se listan (míralas en el PR)`] : []),
      ].join('\n')
    : '- ninguna: sólo lecciones'
  const lecciones =
    [
      ...(toca.kit.length
        ? ['Para `docs/LECCIONES.md` del kit:', '', ...toca.kit.map(vineta), '']
        : []),
      ...(toca.semilla.length
        ? [
            'Para `docs/semillas/LECCIONES.md` › «Sugerencias de los proyectos»:',
            '',
            ...toca.semilla.map(vineta),
          ]
        : []),
    ]
      .join('\n')
      .trim() || 'Ninguna.'
  /** @type {Record<string, string>} */
  const valores = { REPO_GH: repoGh, REPO: nombre, PR: pr, RUTAS: rutas, LECCIONES: lecciones }
  return plantilla.replace(/\{\{(REPO_GH|REPO|PR|RUTAS|LECCIONES)\}\}/g, (_, k) => valores[k] ?? '')
}

// ---------- la CLI, para el aviso al kit del orquestador (kit.sh) ----------
//
//   node scripts/kit/flujo.mjs spec-al-kit <plantilla> <cuenta/repo> <nombre> <pr>   < los archivos del PR (JSON de pulls/<n>/files)
//
// Imprime la spec de la tarea del kit, o nada si el PR no toca flujo (según el flujo.txt de este repo).
/** @param {string[]} argv */
function principal(argv) {
  const [orden, plantilla, repoGh, nombre, pr = ''] = argv
  if (orden !== 'spec-al-kit' || !plantilla || !repoGh || !nombre || !/^\d+$/.test(pr)) {
    console.error(
      'uso: node scripts/kit/flujo.mjs spec-al-kit <plantilla> <cuenta/repo> <nombre> <pr> < archivos.json',
    )
    process.exit(64)
  }
  const toca = tocaFlujo(JSON.parse(readFileSync(0, 'utf8')), patronesDelKit())
  if (toca)
    process.stdout.write(specAlKit(readFileSync(plantilla, 'utf8'), { repoGh, nombre, pr, toca }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  principal(process.argv.slice(2))
