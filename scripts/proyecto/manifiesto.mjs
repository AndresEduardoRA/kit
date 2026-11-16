// El manifiesto del proyecto (esquema proyecto/v1) visto desde un repo: cada repo sabe quién es (nombre `<proyecto>-<rol>`, cuenta de
// GitHub, puertos, contratos) leyendo sólo su copia `.proyecto/proyecto.yaml`, que es el manifiesto entero; nunca abre la carpeta de
// un hermano. El esquema y sus reglas: `_herramientas/semillas/proyecto.plantilla.yaml`; lo comprueba, entero,
// `python3 _herramientas/semillas/validar_semilla.py --manifiesto <archivo>`. Aquí se revisa lo que este kit usa, sin red ni Python.
//
// Lo de este archivo es puro (texto adentro, datos afuera) salvo `leerManifiestoDe` y `manifiestosDeLaRaiz`, que leen archivos.
// Sin `.proyecto/proyecto.yaml` el repo funciona con el remoto, el bloque 5 y un aviso (`stack-local.mjs`): `leerManifiestoDe` devuelve `null`.
// Se prueba en `manifiesto.test.mjs`; lo leen `scripts/lib/stack-local.mjs`, el generador y, por la CLI de abajo, los guiones de bash.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'

export const RUTA_MANIFIESTO = '.proyecto/proyecto.yaml'
export const VALIDADOR = 'python3 _herramientas/semillas/validar_semilla.py --manifiesto'
// El orden en que se reparten los bloques: el 5 es el del kit, el 4 no existe (choca con los puertos por defecto de Supabase).
export const BLOQUES = [5, 6, 7, 8, 9, 1, 2, 3]

const SLUG = /^[a-z][a-z0-9-]{1,30}$/
const ROL = /^[a-z]{2,12}$/
const GITHUB = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/
const ETAPAS = ['construccion', 'mantenimiento']

export class ManifiestoInvalido extends Error {}

/**
 * Lo que está mal en un manifiesto ya leído, un texto por problema, con el campo adelante. Puro.
 * @param {unknown} m
 * @returns {string[]}
 */
export function problemasDelManifiesto(m) {
  const p = []
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['el archivo no es un mapa YAML']
  const o = /** @type {Record<string, any>} */ (m)
  if (o.esquema !== 'proyecto/v1') p.push('esquema: debe ser proyecto/v1')
  const slug = String(o.proyecto ?? '')
  if (!SLUG.test(slug))
    p.push(`proyecto: «${slug}» no sirve como slug (minúsculas, números y guiones, de 2 a 31)`)
  if (!o.nombre) p.push('nombre: falta')
  const repos = Array.isArray(o.repos) ? o.repos : []
  if (repos.length === 0) p.push('repos: no hay ninguno')
  const roles = new Set()
  const bloques = new Map()
  for (const r of repos) {
    const rol = String(r?.rol ?? '')
    const en = `repos[${rol || '?'}]`
    if (!ROL.test(rol)) p.push(`${en}.rol: «${rol}» no sirve (2 a 12 letras minúsculas)`)
    if (roles.has(rol)) p.push(`${en}.rol: repetido`)
    roles.add(rol)
    if (r?.nombre !== `${slug}-${rol}`) p.push(`${en}.nombre: debe ser ${slug}-${rol}`)
    if (!GITHUB.test(String(r?.github ?? ''))) p.push(`${en}.github: va como cuenta/repo`)
    if (!ETAPAS.includes(r?.etapa)) p.push(`${en}.etapa: construccion o mantenimiento`)
    const pu = r?.puertos ?? {}
    if ('bloque' in pu) {
      if (!BLOQUES.includes(pu.bloque)) p.push(`${en}.puertos.bloque: 1 a 9, nunca 4`)
      else if (bloques.has(pu.bloque))
        p.push(`${en}.puertos.bloque: el ${String(pu.bloque)} ya es de ${bloques.get(pu.bloque)}`)
      else bloques.set(pu.bloque, rol)
    } else if ('heredado' in pu) {
      for (const k of ['api', 'base', 'app'])
        if (!Number.isInteger(pu.heredado?.[k]))
          p.push(`${en}.puertos.heredado.${k}: debe ser un número`)
    } else p.push(`${en}.puertos: lleva bloque: N o heredado: {api, base, app}`)
    for (const lado of ['provee', 'consume'])
      for (const ref of r?.[lado] ?? [])
        if (!/^[a-z][a-z0-9-]{1,30}@\d+$/.test(String(ref)))
          p.push(`${en}.${lado}: «${String(ref)}» va como <contrato>@<versión>`)
  }
  const ids = new Set()
  for (const c of o.contratos ?? []) {
    ids.add(String(c?.id))
    if (!roles.has(c?.proveedor))
      p.push(`contratos[${String(c?.id)}].proveedor: no es un repo del manifiesto`)
  }
  for (const r of repos)
    for (const lado of ['provee', 'consume'])
      for (const ref of r?.[lado] ?? [])
        if (!ids.has(String(ref).split('@')[0]))
          p.push(
            `repos[${String(r?.rol)}].${lado}: el contrato «${String(ref).split('@')[0]}» no está en contratos`,
          )
  return p
}

/**
 * Lee un manifiesto: el YAML, revisado. Si algo falla, el error dice qué campo y con qué comando se valida a fondo. Puro.
 * @param {string} texto  @param {string} [archivo]  el nombre que sale en los errores
 */
export function leerManifiesto(texto, archivo = RUTA_MANIFIESTO) {
  const pie = `Revísalo con: ${VALIDADOR} ${archivo}`
  let m
  try {
    m = parse(texto)
  } catch (e) {
    throw new ManifiestoInvalido(
      `${archivo}: no es YAML válido (${e instanceof Error ? e.message.split('\n')[0] : String(e)}). ${pie}`,
    )
  }
  const problemas = problemasDelManifiesto(m)
  if (problemas.length)
    throw new ManifiestoInvalido(
      `${archivo}: manifiesto inválido:\n- ${problemas.join('\n- ')}\n${pie}`,
    )
  return /** @type {Manifiesto} */ (m)
}

/**
 * El repo propio: el que se llama `nombre`. Un manifiesto de un solo repo no necesita el nombre; con varios, uno que no está falla
 * diciendo cuáles son. Puro.
 * @param {Manifiesto} m  @param {string | null | undefined} nombre
 */
export function repoPropio(m, nombre) {
  const r = m.repos.find((x) => x.nombre === nombre)
  if (r) return r
  if (m.repos.length === 1 && m.repos[0]) return m.repos[0]
  throw new ManifiestoInvalido(
    `el repo «${nombre ?? ''}» no está en el manifiesto de ${m.proyecto} (son: ${m.repos.map((x) => x.nombre).join(', ')})`,
  )
}

/**
 * Los puertos de un repo: su bloque o los heredados (un repo que ya tenía los suyos y no los mueve). Puro.
 * @param {Repo} repo
 * @returns {{ bloque: number } | { heredado: { api: number, base: number, app: number } }}
 */
export function puertosDelRepo(repo) {
  const p = repo.puertos
  if ('bloque' in p) return { bloque: p.bloque }
  return { heredado: p.heredado }
}

/** La cuenta de GitHub dueña del repo: la parte de `cuenta/repo`. Puro. @param {Repo} repo */
export const cuentaDelRepo = (repo) => repo.github.split('/')[0] ?? ''

/**
 * Los contratos de un repo: lo que provee y consume, y la definición de cada contrato en el que participa (como proveedor o como
 * consumidor). Puro.
 * @param {Manifiesto} m  @param {Repo} repo
 */
export function contratosDelRepo(m, repo) {
  const definiciones = (m.contratos ?? []).filter(
    (c) => c.proveedor === repo.rol || (c.consumidores ?? []).includes(repo.rol),
  )
  return { provee: repo.provee ?? [], consume: repo.consume ?? [], contratos: definiciones }
}

// ---------- el bloque libre entre los manifiestos de la máquina ----------

/**
 * Los bloques que usa cada manifiesto, con su archivo. Puro.
 * @param {{ archivo: string, manifiesto: Manifiesto }[]} manifiestos
 * @returns {{ bloque: number, archivo: string, repo: string }[]}
 */
export function bloquesUsados(manifiestos) {
  return manifiestos.flatMap(({ archivo, manifiesto }) =>
    manifiesto.repos.flatMap((r) =>
      'bloque' in r.puertos ? [{ bloque: r.puertos.bloque, archivo, repo: r.nombre }] : [],
    ),
  )
}

/**
 * Dos manifiestos (o dos repos) con el mismo bloque: un texto por bloque repetido, que nombra a los dos. Puro.
 * @param {{ bloque: number, archivo: string, repo: string }[]} usados
 */
export function bloquesRepetidos(usados) {
  const vistos = new Map()
  const choques = []
  for (const u of usados) {
    const antes = vistos.get(u.bloque)
    if (antes)
      choques.push(
        `el bloque ${u.bloque} lo usan ${antes.repo} (${antes.archivo}) y ${u.repo} (${u.archivo})`,
      )
    else vistos.set(u.bloque, u)
  }
  return choques
}

/**
 * El primer bloque de [5,6,7,8,9,1,2,3] que ningún manifiesto usa. Falla nombrando a los dos si hay un bloque repetido, y si ya no
 * queda ninguno. Puro.
 * @param {{ archivo: string, manifiesto: Manifiesto }[]} manifiestos
 */
export function bloqueLibre(manifiestos) {
  const usados = bloquesUsados(manifiestos)
  const choques = bloquesRepetidos(usados)
  if (choques.length)
    throw new ManifiestoInvalido(
      `dos manifiestos con el mismo bloque de puertos:\n- ${choques.join('\n- ')}`,
    )
  const ocupados = new Set(usados.map((u) => u.bloque))
  const libre = BLOQUES.find((b) => !ocupados.has(b))
  if (!libre)
    throw new ManifiestoInvalido(
      `no queda un bloque de puertos libre: los ${BLOQUES.length} están en ${[...new Set(usados.map((u) => u.archivo))].join(', ')}`,
    )
  return libre
}

// ---------- los archivos ----------

/**
 * El manifiesto de un repo (su copia `.proyecto/proyecto.yaml`), o `null` si no tiene: el repo funciona como antes.
 * @param {string} [raiz]
 */
export function leerManifiestoDe(raiz = process.cwd()) {
  const archivo = join(raiz, RUTA_MANIFIESTO)
  return existsSync(archivo) ? leerManifiesto(readFileSync(archivo, 'utf8'), RUTA_MANIFIESTO) : null
}

/**
 * La raíz de proyectos: dos carpetas arriba del kit (`proyectos/_herramientas/kit` → `proyectos/`), donde viven los `z_<proyecto>/`.
 * @param {string} kit
 */
export const raizDeProyectos = (kit) => resolve(kit, '../..')

/**
 * Todos los `<raíz>/z_*\/proyecto.yaml`, leídos y revisados, en orden de nombre. Uno inválido falla nombrando el archivo.
 * @param {string} raiz
 * @returns {{ archivo: string, manifiesto: Manifiesto }[]}
 */
export function manifiestosDeLaRaiz(raiz) {
  if (!existsSync(raiz)) return []
  return readdirSync(raiz, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('z_'))
    .map((d) => join(raiz, d.name, 'proyecto.yaml'))
    .filter((archivo) => existsSync(archivo))
    .sort()
    .map((archivo) => ({
      archivo,
      manifiesto: leerManifiesto(readFileSync(archivo, 'utf8'), archivo),
    }))
}

/**
 * El nombre de este repo, para elegirlo en el manifiesto: el del remoto `origin` (`cuenta/<nombre>.git`) o, sin remoto, el de su carpeta.
 * Puro. @param {string | null | undefined} remoto  @param {string} carpeta
 */
export function nombreDelRepo(remoto, carpeta) {
  const m = /[:/]([^/:]+?)(?:\.git)?\/?$/.exec(remoto ?? '')
  return m?.[1] ?? carpeta.split('/').filter(Boolean).pop() ?? ''
}

/**
 * El manifiesto de un repo y el repo propio dentro de él (elegido por el nombre del remoto `origin`, o el de la carpeta), o `null` si
 * el repo no tiene `.proyecto/proyecto.yaml`.
 * @param {string} [raiz]
 */
export function repoDeEsteWorktree(raiz = process.cwd()) {
  const manifiesto = leerManifiestoDe(raiz)
  if (!manifiesto) return null
  let remoto = null
  try {
    remoto = execFileSync('git', ['-C', raiz, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    // sin remoto: vale el nombre de la carpeta, o el único repo del manifiesto
  }
  return { manifiesto, repo: repoPropio(manifiesto, nombreDelRepo(remoto, raiz)) }
}

// ---------- la CLI, para los guiones de bash ----------
//
//   node scripts/proyecto/manifiesto.mjs proyecto|nombre|cuenta|bloque [<raíz del repo>]
//
// Imprime el campo (`proyecto`: el slug; `nombre`: el del repo propio, <proyecto>-<rol>; `cuenta`; `bloque`), o nada (y sale con 0) si el repo no tiene manifiesto: el guion cae a lo de antes. Un manifiesto
// inválido sale con 1 y el motivo.
function principal(argv) {
  const [campo, dir] = argv
  if (!['proyecto', 'nombre', 'cuenta', 'bloque'].includes(campo ?? '')) {
    console.error(
      'uso: node scripts/proyecto/manifiesto.mjs proyecto|nombre|cuenta|bloque [<raíz del repo>]',
    )
    process.exit(64)
  }
  try {
    const propio = repoDeEsteWorktree(resolve(dir ?? process.cwd()))
    if (!propio) return
    if (campo === 'proyecto') console.log(propio.manifiesto.proyecto)
    else if (campo === 'nombre') console.log(propio.repo.nombre)
    else if (campo === 'cuenta') console.log(cuentaDelRepo(propio.repo))
    else {
      const p = puertosDelRepo(propio.repo)
      if ('bloque' in p) console.log(p.bloque)
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  principal(process.argv.slice(2))

/**
 * @typedef {{ rol: string, nombre: string, github: string, etapa: string, semilla?: string | null,
 *   puertos: { bloque: number } | { heredado: { api: number, base: number, app: number } },
 *   provee?: string[], consume?: string[] }} Repo
 * @typedef {{ id: string, proveedor: string, consumidores?: string[], tipo?: string, vigentes?: number[] }} Contrato
 * @typedef {{ esquema: string, proyecto: string, nombre: string, semilla?: string | null, repos: Repo[], contratos?: Contrato[] }} Manifiesto
 */
