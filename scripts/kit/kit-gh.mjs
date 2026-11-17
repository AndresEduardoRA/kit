// Leer un repo por GitHub con el token de su cuenta, sin cambiar la cuenta activa de `gh` (docs/LECCIONES.md: dos cuentas en gh):
// el sha de una referencia, la comparación de dos commits y el árbol de un commit bajado como tarball a una carpeta temporal vacía
// (nunca la carpeta hermana del kit). Lo usan `actualizar.mjs` (el kit, desde un proyecto) y `traer-de-proyecto.mjs` (un proyecto,
// desde el kit). Viaja a cada proyecto. Se prueba con el `gh` falso (scripts/orquestador/prueba/gh-falso-git.mjs) en
// `actualizar.test.ts`.
import { spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// El de KIT_GITHUB en scripts/orquestador/config.env (mezcla.test.ts los compara).
export const KIT_POR_DEFECTO = 'AndresEduardoRA/kit'

/** El `cuenta/repo` del kit: KIT_GITHUB del entorno (el orquestador lo pasa desde su config.env) o el de siempre. */
export const kitGithub = () => process.env['KIT_GITHUB'] || KIT_POR_DEFECTO

/** GitHub no respondió o no dio acceso: el mensaje es una línea, con el repo y la primera línea de `gh`. */
export class SinAcceso extends Error {}

/**
 * El token de una cuenta de `gh` (`gh auth token --user`); sin sesión de esa cuenta, el GH_TOKEN del entorno (o ninguno).
 * @param {string} cuenta
 */
export function tokenDe(cuenta) {
  const r = spawnSync('gh', ['auth', 'token', '--user', cuenta], { encoding: 'utf8' })
  const t = r.status === 0 ? r.stdout.trim() : ''
  return t || process.env['GH_TOKEN'] || ''
}

/**
 * `gh` contra un repo con el token de su cuenta. Devuelve una función: argumentos → la salida (texto, o Buffer con `binario`).
 * @param {string} repo  `cuenta/repo`
 * @param {string} [quien]  cómo lo nombra el error («al kit»)
 */
export function ghDe(repo, quien = 'al kit') {
  const token = tokenDe(repo.split('/')[0] ?? '')
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env
  /** @param {string[]} args  @param {{ binario?: boolean }} [o] */
  return (args, { binario = false } = {}) => {
    const r = spawnSync('gh', args, {
      env,
      encoding: binario ? 'buffer' : 'utf8',
      maxBuffer: 1024 * 1024 * 1024,
    })
    if (r.status !== 0) {
      const err = String(r.stderr || r.error?.message || 'gh falló').trim()
      throw new SinAcceso(`sin acceso ${quien} por GitHub (${repo}): ${err.split('\n')[0]}`)
    }
    return r.stdout
  }
}
/** @typedef {ReturnType<typeof ghDe>} Gh */

/**
 * El sha de una referencia (una rama o un commit).
 * @param {Gh} gh  @param {string} repo  @param {string} ref
 */
export const shaDe = (gh, repo, ref) =>
  String(gh(['api', `repos/${repo}/commits/${ref}`, '--jq', '.sha'])).trim()

/**
 * Los archivos que cambiaron entre dos commits, como los da `compare` (GitHub corta en 300).
 * @param {Gh} gh  @param {string} repo  @param {string} a  @param {string} b
 * @returns {{ filename: string, previous_filename?: string }[]}
 */
export function comparar(gh, repo, a, b) {
  const salida = gh([
    'api',
    `repos/${repo}/compare/${a}...${b}`,
    '--jq',
    '[.files[]? | {filename, previous_filename}]',
  ])
  return JSON.parse(String(salida)).map(
    (/** @type {{ filename: string, previous_filename?: string | null }} */ f) =>
      f.previous_filename ? f : { filename: f.filename },
  )
}

/**
 * Baja el árbol de un commit a `dir` (que se crea vacío) y devuelve sus archivos, relativos a él. Nada se ejecuta desde ahí.
 * @param {Gh} gh  @param {string} repo  @param {string} sha  @param {string} dir
 */
export function bajarArbol(gh, repo, sha, dir) {
  const tar = gh(['api', `repos/${repo}/tarball/${sha}`], { binario: true })
  mkdirSync(dir, { recursive: true })
  // La carpeta raíz del tarball es `<cuenta>-<repo>-<sha>/`: se quita.
  const r = spawnSync('tar', ['-xzf', '-', '--strip-components=1', '-C', dir], { input: tar })
  if (r.status !== 0)
    throw new SinAcceso(
      `el tarball de ${repo} en ${sha.slice(0, 7)} no se abre: ${String(r.stderr).trim().split('\n')[0]}`,
    )
  return archivosDe(dir)
}

/**
 * Los archivos comunes (ni carpetas ni enlaces) de una carpeta, relativos a ella, sin `.git/`.
 * @param {string} dir  @param {string} [pre]
 * @returns {string[]}
 */
export function archivosDe(dir, pre = '') {
  return readdirSync(join(dir, pre), { withFileTypes: true }).flatMap((d) => {
    const rel = pre + d.name
    if (d.isDirectory()) return d.name === '.git' ? [] : archivosDe(dir, `${rel}/`)
    return d.isFile() ? [rel] : []
  })
}

/**
 * Un archivo de una carpeta con su modo, o `null` si no está (o no es un archivo común).
 * @param {string} dir  @param {string} ruta
 * @returns {{ contenido: Buffer, modo: number } | null}
 */
export function archivoDe(dir, ruta) {
  try {
    const st = lstatSync(join(dir, ruta))
    return st.isFile() ? { contenido: readFileSync(join(dir, ruta)), modo: st.mode & 0o777 } : null
  } catch {
    return null
  }
}
