// Lo que el generador personaliza en los archivos del flujo de un repo (docs/KIT.md › «Lo que el generador reemplaza»): el nombre del
// repo en la prosa y en los identificadores, y los puertos de su bloque en el CI. Viaja a cada proyecto (scripts/kit/flujo.txt): el
// generador (reemplazos.mjs) y `actualizar.mjs` usan estas mismas funciones; si personalizaran distinto, cada actualización chocaría.
// Todo puro: texto adentro, texto afuera. Se prueba en `mezcla.test.ts` y en `nuevo-proyecto.test.mjs`.
import { baseDelBloque } from '../lib/stack-local.mjs'

// Los marcadores del kit que el generador reemplaza: ninguno puede quedar en un repo de proyecto.
export const MARCADORES = [
  '{{NOMBRE}}',
  '{{DESCRIPCION}}',
  '{{SCOPES}}',
  '{{SCOPES_MODULOS}}',
  '{{API_PORT}}',
  '{{DB_PORT}}',
  '{{FUNCIONES}}',
  '{{PUERTOS_PILA}}',
  'cambiar-slug',
]
// Los archivos del flujo (vienen de calesa-app) que nombran al repo: `{{NOMBRE}}` en la prosa y `cambiar-slug-app` en lo que es un
// identificador (el servicio del orquestador, su tema de ntfy; PROYECTO de config.env va vacío: sale del manifiesto). Sólo esos: los
// `{{ID}}`, `{{RAMA}}`… de los prompts los reemplaza el orquestador.
export const CON_NOMBRE = [
  '.claude/agents/revisor.md',
  '.claude/skills/entregar/SKILL.md',
  '.claude/skills/feature/SKILL.md',
  '.claude/skills/revisar/SKILL.md',
  'scripts/orquestador/README.md',
  'scripts/orquestador/prompts/tarea.md',
  'scripts/orquestador/prompts/arreglar.md',
  'scripts/orquestador/prompts/planificar.md',
  'scripts/orquestador/prompts/redactar.md',
]
// Los dos archivos del flujo que llevan los puertos del bloque: sin bloque (puertos heredados) no se pueden personalizar.
export const CON_PUERTOS_DEL_FLUJO = [
  '.github/workflows/ci.yml',
  '.github/acciones/pila/action.yml',
]

/** Sin bloque de puertos no hay con qué llenar `ci.yml` ni `action.yml`: `decidir` lo vuelve un choque con este motivo. */
export class SinBloque extends Error {}

/**
 * El nombre del repo (`<slug>-<rol>`) donde el kit dice `{{NOMBRE}}` o `cambiar-slug-app`, y el slug donde dice `cambiar-slug`. Puro.
 * @param {string} t  @param {{ nombre: string, slug: string }} v
 */
export const conNombre = (t, { nombre, slug }) =>
  t
    .replaceAll('{{NOMBRE}}', nombre)
    .replaceAll('cambiar-slug-app', nombre)
    .replaceAll('cambiar-slug', slug)

/**
 * Las personalizaciones de los archivos del flujo, como funciones por archivo. Puro.
 * @param {{ nombre: string, slug: string, bloque: number | null, funciones: string }} v
 * @returns {Record<string, (t: string) => string>}
 */
export function personalizacionesDelFlujo({ nombre, slug, bloque, funciones }) {
  /** @type {Record<string, (t: string) => string>} */
  const r = {}
  for (const f of CON_NOMBRE) r[f] = (t) => conNombre(t, { nombre, slug })
  if (bloque === null) {
    for (const f of CON_PUERTOS_DEL_FLUJO)
      r[f] = () => {
        throw new SinBloque(
          `${f} lleva los puertos del bloque y este repo tiene puertos heredados (sin bloque en .proyecto/proyecto.yaml)`,
        )
      }
    return r
  }
  const p = baseDelBloque(bloque)
  r['.github/workflows/ci.yml'] = (t) =>
    t
      .replace(
        / semilla-a-repo reemplaza \{\{API_PORT\}\}[\s\S]*?con e2e\/funciones\.txt\./,
        ` Puertos del bloque ${bloque}.`,
      )
      .replaceAll('{{API_PORT}}', String(p.SUPABASE_API_PORT))
      .replaceAll('{{DB_PORT}}', String(p.SUPABASE_DB_PORT))
      .replaceAll('{{FUNCIONES}}', funciones)
  r['.github/acciones/pila/action.yml'] = (t) =>
    t
      .replace(
        / semilla-a-repo reemplaza \{\{PUERTOS_PILA\}\}[^.]*\./,
        ` Puertos del bloque ${bloque}.`,
      )
      .replaceAll(
        '{{PUERTOS_PILA}}',
        `${p.SUPABASE_DB_SHADOW_PORT}-${p.SUPABASE_EDGE_RUNTIME_INSPECTOR_PORT}`,
      )
  return r
}

/**
 * Un archivo del kit tal como queda en el repo: personalizado si es de los que nombran al repo o llevan sus puertos; si no, igual.
 * Puro. Lanza `SinBloque` si el archivo lleva puertos y el repo no tiene bloque.
 * @param {string} ruta  @param {string} texto  @param {{ nombre: string, slug: string, bloque: number | null, funciones: string }} valores
 */
export function personalizar(ruta, texto, valores) {
  const f = personalizacionesDelFlujo(valores)[ruta]
  return f ? f(texto) : texto
}

/**
 * Lo que se revisa por marcadores sueltos: todo menos la semilla, docs/KIT.md (que los documenta), scripts/kit/ (lo que viaja de ahí
 * escribe los marcadores para personalizar) y lo binario. Puro.
 * @param {string} f
 */
export const seRevisa = (f) =>
  f !== 'docs/KIT.md' &&
  !f.startsWith('docs/semilla/') &&
  !f.startsWith('scripts/kit/') &&
  !/\.(png|jpg|ico|woff2?|tgz)$/.test(f)

/**
 * Los marcadores que quedarían sin reemplazar, `archivo: marcador`, de un mapa archivo → texto. Puro.
 * @param {Record<string, string>} textos
 */
export function marcadoresSueltos(textos) {
  const quedan = []
  for (const [f, t] of Object.entries(textos))
    for (const m of MARCADORES) if (t.includes(m)) quedan.push(`${f}: ${m}`)
  return quedan
}
