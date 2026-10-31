// El stack local de Supabase de ESTE worktree: su project_id (los contenedores se llaman `supabase_<servicio>_<project_id>`) y sus
// puertos. Manda, en este orden: la variable `SUPABASE_*` del entorno, `.env.carril` (lo escribe scripts/worktree/preparar.sh en un
// carril) y `supabase/config.toml` (la principal). La CLI de Supabase lee las mismas variables, así que un carril tiene su stack sin
// tocar config.toml. Viene de importadora; aquí los carriles salen de plan.yaml en vez de estar escritos a mano (a y b).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { desfases, leerPlan } from '../coordinador/plan.mjs'

// Varios proyectos corren a la vez en la misma máquina: cada uno tiene su BLOQUE (1 a 9, en piloto.config) y sus puertos no se cruzan
// con los de otro. Supabase: 5<bloque>320–5<bloque>329 en la principal; la app, <bloque+3>000 y el e2e, <bloque+3>210. Cada carril
// suma su desfase (100, 200, … en el orden de plan.yaml; hasta 9 carriles). El bloque 4 choca con los puertos por defecto de Supabase
// (54321) y con importadora (546xx): no se usa.
export function baseDelBloque(bloque) {
  const b = Number(bloque)
  if (!Number.isInteger(b) || b < 1 || b > 9)
    throw new Error(`PILOTO_BLOQUE debe ser un entero de 1 a 9 (es «${bloque}»)`)
  if (b === 4)
    throw new Error(
      'PILOTO_BLOQUE 4 choca con los puertos por defecto de Supabase y con importadora: elige otro',
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

/** Los desfases de los carriles de este repo, leídos de plan.yaml (COORD_PLAN o docs/semilla/plan.yaml). */
export function desfasesDelRepo(raiz = process.cwd()) {
  const ruta = process.env.COORD_PLAN || join(raiz, 'docs/semilla/plan.yaml')
  if (!existsSync(ruta)) throw new Error(`no está el plan en ${ruta}: los carriles salen de ahí`)
  return desfases(leerPlan(readFileSync(ruta, 'utf8')))
}

/**
 * El `.env.carril` de un carril: el project_id, los puertos y lo que leen los e2e y el piloto. Puro: sin I/O.
 * @param {string} proyecto  @param {string} carril  @param {Record<string, number>} tabla  los desfases (`desfasesDelRepo`)
 * @param {number} bloque  PILOTO_BLOQUE del proyecto
 */
export function variablesDelCarril(proyecto, carril, tabla, bloque) {
  const base = baseDelBloque(bloque)
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
    PILOTO_SUPABASE_URL: `http://127.0.0.1:${String(puertos.SUPABASE_API_PORT)}`,
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
