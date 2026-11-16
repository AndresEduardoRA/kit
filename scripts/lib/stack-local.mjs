// El stack local de Supabase de ESTE worktree: su project_id (los contenedores se llaman `supabase_<servicio>_<project_id>`) y sus
// puertos. Manda, en este orden: la variable `SUPABASE_*` del entorno, `.env.carril` (lo escribe scripts/worktree/preparar.sh en un
// carril) y `supabase/config.toml` (la principal). La CLI de Supabase lee las mismas variables, así que un carril tiene su stack sin
// tocar config.toml. Viene de importadora.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { puertosDelRepo, repoDeEsteWorktree } from '../proyecto/manifiesto.mjs'

// Varios proyectos corren a la vez en la misma máquina: cada uno tiene su BLOQUE (1 a 9, `puertos.bloque` de su manifiesto
// `.proyecto/proyecto.yaml`; sin manifiesto, el 5 y un aviso) y sus puertos no se cruzan con los de otro. Supabase:
// 5<bloque>320–5<bloque>329 en la principal; la app, <bloque+3>000 y el e2e, <bloque+3>210. Cada carril suma su desfase (100, 200 y 300:
// a, b y c). El bloque 4 choca con los puertos por defecto de Supabase (54321) y con importadora (546xx): no se usa.
export const BLOQUE_POR_DEFECTO = 5

export function baseDelBloque(bloque) {
  const b = Number(bloque)
  if (!Number.isInteger(b) || b < 1 || b > 9)
    throw new Error(`el bloque de puertos debe ser un entero de 1 a 9 (es «${bloque}»)`)
  if (b === 4)
    throw new Error(
      'el bloque de puertos 4 choca con los puertos por defecto de Supabase y con importadora: elige otro',
    )
  const s = 50320 + 1000 * b
  const app = 3000 + 1000 * b
  return {
    SUPABASE_DB_SHADOW_PORT: s,
    SUPABASE_API_PORT: s + 1,
    SUPABASE_DB_PORT: s + 2,
    SUPABASE_STUDIO_PORT: s + 3,
    SUPABASE_LOCAL_SMTP_PORT: s + 4,
    SUPABASE_ANALYTICS_PORT: s + 7,
    SUPABASE_EDGE_RUNTIME_INSPECTOR_PORT: s + 9,
    PUERTO_APP: app,
    E2E_PORT: app + 210,
  }
}

/**
 * Los puertos de un repo que ya tenía los suyos y no los mueve (`puertos.heredado` del manifiesto: calesa-app, en 546xx), con las
 * mismas claves que `baseDelBloque`. El resto sale de los tres que el manifiesto da, con el desfase de Supabase de siempre
 * (`supabase/config.toml` de calesa-app: shadow 54620, API 54621, base 54622, studio 54623, mailpit 54624, analytics 54627); el
 * inspector de edge se queda en 8083 y el e2e va 210 sobre la app (3210).
 * @param {{ api: number, base: number, app: number }} heredado
 */
export function baseHeredada({ api, base, app }) {
  return {
    SUPABASE_DB_SHADOW_PORT: api - 1,
    SUPABASE_API_PORT: api,
    SUPABASE_DB_PORT: base,
    SUPABASE_STUDIO_PORT: api + 2,
    SUPABASE_LOCAL_SMTP_PORT: api + 3,
    SUPABASE_ANALYTICS_PORT: api + 6,
    SUPABASE_EDGE_RUNTIME_INSPECTOR_PORT: 8083,
    PUERTO_APP: app,
    E2E_PORT: app + 210,
  }
}

/**
 * Los puertos de la principal de este repo: los de su manifiesto (el bloque o los heredados). Sin manifiesto, los del bloque por
 * defecto (el 5) y un aviso por `aviso` (stderr): dos proyectos sin manifiesto chocarían. Un manifiesto inválido falla diciendo qué campo.
 * @param {string} [raiz]  @param {(texto: string) => void} [aviso]
 */
export function baseDelRepo(raiz = process.cwd(), aviso = (texto) => console.error(texto)) {
  const propio = repoDeEsteWorktree(raiz)
  if (!propio) {
    aviso(
      `aviso: ${raiz} no tiene .proyecto/proyecto.yaml: uso el bloque de puertos ${String(BLOQUE_POR_DEFECTO)}, que otro proyecto puede estar usando.`,
    )
    return baseDelBloque(BLOQUE_POR_DEFECTO)
  }
  const p = puertosDelRepo(propio.repo)
  return 'bloque' in p ? baseDelBloque(p.bloque) : baseHeredada(p.heredado)
}

/**
 * El nombre del proyecto: el del manifiesto o, sin manifiesto, el `project_id` de supabase/config.toml (con un aviso por `aviso`).
 * Sin ninguno de los dos falla.
 * @param {string} [raiz]  @param {(texto: string) => void} [aviso]
 */
export function proyectoDelRepo(raiz = process.cwd(), aviso = (texto) => console.error(texto)) {
  const delManifiesto = repoDeEsteWorktree(raiz)?.manifiesto.proyecto
  if (delManifiesto) return delManifiesto
  const delConfig = deConfig(raiz).SUPABASE_PROJECT_ID
  if (!delConfig)
    throw new Error(
      `no sé el nombre del proyecto: ${raiz} no tiene .proyecto/proyecto.yaml ni project_id en supabase/config.toml.`,
    )
  aviso(
    `aviso: ${raiz} no tiene .proyecto/proyecto.yaml: el proyecto es «${delConfig}» (supabase/config.toml).`,
  )
  return delConfig
}

// Los carriles del orquestador (scripts/orquestador): un worktree por tarea, en una rama `<tipo>/<tema>`, que toma la primera letra
// libre (scripts/worktree/preparar.sh). Como en calesa-app, a, b y c; cada uno con su desfase de puertos.
export const DESFASES_DE_LOS_CARRILES = { a: 100, b: 200, c: 300 }
export const CARRILES_DEL_ORQUESTADOR = Object.keys(DESFASES_DE_LOS_CARRILES)

/**
 * El `.env.carril` de un carril: el project_id, los puertos y lo que leen los e2e. Puro: sin I/O.
 * @param {string} proyecto  @param {string} carril  @param {Record<string, number>} tabla  los desfases (`DESFASES_DE_LOS_CARRILES`)
 * @param {number | string | Record<string, number>} bloque  el bloque del proyecto, o ya sus puertos (`baseDelRepo`: un repo con
 *   puertos heredados no tiene bloque)
 */
export function variablesDelCarril(proyecto, carril, tabla, bloque) {
  const base = typeof bloque === 'object' ? bloque : baseDelBloque(bloque)
  const desfase = tabla[carril]
  if (desfase === undefined)
    throw new Error(`carril desconocido: «${carril}» (son: ${Object.keys(tabla).join(', ')})`)
  // Un desfase de 100 por carril deja lugar a 9 carriles antes de chocar con el puerto siguiente de la principal.
  if (desfase >= 1000)
    throw new Error(`demasiados carriles: el desfase ${desfase} pisaría otros puertos`)
  const puertos = Object.fromEntries(
    Object.entries(base).map(([clave, puerto]) => [clave, puerto + desfase]),
  )
  return {
    SUPABASE_PROJECT_ID: `${proyecto}-${carril}`,
    ...puertos,
    SUPABASE_AUTH_SITE_URL: `http://localhost:${String(puertos.PUERTO_APP)}`,
    E2E_MAILPIT_URL: `http://127.0.0.1:${String(puertos.SUPABASE_LOCAL_SMTP_PORT)}`,
    E2E_SUPABASE_URL: `http://127.0.0.1:${String(puertos.SUPABASE_API_PORT)}`,
  }
}

export function leerEnvCarril(raiz = process.cwd()) {
  const archivo = join(raiz, '.env.carril')
  return existsSync(archivo) ? parseEnv(readFileSync(archivo, 'utf8')) : {}
}

function deConfig(raiz) {
  const archivo = join(raiz, 'supabase/config.toml')
  if (!existsSync(archivo)) return {}
  const toml = readFileSync(archivo, 'utf8')
  const seccion = (nombre) =>
    new RegExp(`^\\[${nombre}\\]\\s*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm').exec(toml)?.[1] ?? ''
  const puerto = (nombre, clave = 'port') =>
    Number(new RegExp(`^${clave}\\s*=\\s*(\\d+)`, 'm').exec(seccion(nombre))?.[1])
  return {
    SUPABASE_PROJECT_ID: /^project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1],
    SUPABASE_API_PORT: puerto('api'),
    SUPABASE_DB_PORT: puerto('db'),
    SUPABASE_LOCAL_SMTP_PORT: puerto('local_smtp'),
  }
}

/** El stack de este worktree. `entorno` y `raiz` se inyectan en las pruebas. */
export function stackLocal(raiz = process.cwd(), entorno = process.env) {
  const carril = leerEnvCarril(raiz)
  const config = deConfig(raiz)
  const valor = (clave) => entorno[clave] || carril[clave] || config[clave]
  const proyecto = valor('SUPABASE_PROJECT_ID')
  if (!proyecto)
    throw new Error(
      'No sé el project_id del stack local (ni SUPABASE_PROJECT_ID, ni .env.carril, ni config.toml).',
    )
  const puertoApi = Number(valor('SUPABASE_API_PORT'))
  const puertoDb = Number(valor('SUPABASE_DB_PORT'))
  const puertoMailpit = Number(valor('SUPABASE_LOCAL_SMTP_PORT'))
  return {
    proyecto,
    contenedorDb: `supabase_db_${proyecto}`,
    puertoApi,
    puertoDb,
    urlApi: `http://127.0.0.1:${String(puertoApi)}`,
    urlDb: `postgresql://postgres:postgres@127.0.0.1:${String(puertoDb)}/postgres`,
    urlMailpit: `http://127.0.0.1:${String(puertoMailpit)}`,
  }
}
