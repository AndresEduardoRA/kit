// Trae a un repo de proyecto el flujo del kit (docs/KIT.md › «El flujo entre el kit y los proyectos»): baja por GitHub el kit en
// `.kit/version` (base) y en main (nuevo) y, por cada archivo de flujo, decide con una mezcla de tres vías (mezcla.mjs). Todo o nada:
// con un solo choque no escribe nada. Sin choques escribe, avanza `.kit/version` y commitea (con los hooks).
//
//   node scripts/kit/actualizar.mjs [--revisar] [--tomar-kit <ruta>]… [--dejar <ruta>]…
//
// Trabaja sobre el repo del directorio actual: un repo de antes de este archivo se pone al día una vez, desde su raíz, con
// `node <kit>/scripts/kit/actualizar.mjs`. Sale con 0 (hecho o al día), 1 (no pudo), 3 (choques), 10 (`--revisar`: está atrás) o 64
// (uso). Viaja a cada proyecto; lo corre la tarea semanal del orquestador (kit.sh). Se prueba en `actualizar.test.ts`.
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { puertosDelRepo, repoDeEsteWorktree } from '../proyecto/manifiesto.mjs'
import { esFlujo, leerPatrones, patronesDelKit } from './flujo.mjs'
import { archivoDe, bajarArbol, comparar, ghDe, kitGithub, shaDe, SinAcceso } from './kit-gh.mjs'
import { decidir } from './mezcla.mjs'

const USO =
  'uso: node scripts/kit/actualizar.mjs [--revisar] [--tomar-kit <ruta>]… [--dejar <ruta>]…'
// Con 300 archivos o más, `compare` corta la lista: se da por atrás.
const TOPE_DE_COMPARE = 300
export const mensajeDelCommit = (/** @type {string} */ sha) =>
  `chore(kit): traer el flujo del kit ${sha.slice(0, 7)}`

class Fallo extends Error {
  /** @param {string} mensaje  @param {number} [codigo] */
  constructor(mensaje, codigo = 1) {
    super(mensaje)
    this.codigo = codigo
  }
}

/** @param {string[]} argv */
function leerArgs(argv) {
  const o = {
    revisar: false,
    tomarKit: /** @type {string[]} */ ([]),
    dejar: /** @type {string[]} */ ([]),
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--revisar') o.revisar = true
    else if ((a === '--tomar-kit' || a === '--dejar') && argv[i + 1])
      (a === '--dejar' ? o.dejar : o.tomarKit).push(String(argv[++i]))
    else throw new Fallo(USO, 64)
  }
  return o
}

/** @param {string} raiz  @param {string[]} args */
const git = (raiz, ...args) => spawnSync('git', ['-C', raiz, ...args], { encoding: 'utf8' })
/** @param {string} f */
const leerSiHay = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '')

/** El repo del directorio actual y lo que hace falta para personalizar; se niega con el motivo si no es un repo de proyecto. */
function elRepo({ revisar = false }) {
  const top = git(process.cwd(), 'rev-parse', '--show-toplevel')
  if (top.status !== 0) throw new Fallo('no estoy dentro de un repo de git')
  const raiz = top.stdout.trim()
  if (existsSync(join(raiz, '.kit/plantilla')))
    throw new Fallo('esto es el kit: actualizar.mjs trae el flujo a un repo de proyecto')
  const version = leerSiHay(join(raiz, '.kit/version')).trim()
  if (!version)
    throw new Fallo('sin .kit/version: escribe en él el commit del kit del que trae el flujo')
  const propio = repoDeEsteWorktree(raiz)
  if (!propio)
    throw new Fallo('sin .proyecto/proyecto.yaml: actualizar.mjs necesita el manifiesto del repo')
  if (!revisar && git(raiz, 'status', '--porcelain').stdout.trim())
    throw new Fallo('hay cambios sin commitear: commitéalos o descártalos antes')
  const puertos = puertosDelRepo(propio.repo)
  const funciones = leerPatrones(leerSiHay(join(raiz, 'e2e/funciones.txt')))
    .flatMap((l) => l.split(/\s+/))
    .join(' ')
  const local = join(raiz, 'scripts/kit/flujo.txt')
  return {
    raiz,
    version,
    valores: {
      nombre: propio.repo.nombre,
      slug: propio.manifiesto.proyecto,
      bloque: 'bloque' in puertos ? puertos.bloque : null,
      funciones,
    },
    omitir: leerPatrones(leerSiHay(join(raiz, '.kit/omitir'))),
    patrones: existsSync(local) ? leerPatrones(readFileSync(local, 'utf8')) : patronesDelKit(),
  }
}

/** `--revisar` (D1 de docs/KIT.md): atrás si `compare` cambió algún archivo de flujo (o cortó la lista). */
function revisar(r, gh, kit, main) {
  let archivos
  try {
    archivos = comparar(gh, kit, r.version, main)
  } catch (e) {
    if (!(e instanceof SinAcceso)) throw e
    throw new Fallo(
      `no encuentro en el kit el commit de .kit/version (${r.version.slice(0, 7)}): ${e.message}`,
    )
  }
  const omitido = (/** @type {string} */ f) => esFlujo(f, r.omitir)
  const deFlujo = archivos.filter((a) =>
    [a.filename, a.previous_filename].some((f) => f && esFlujo(f, r.patrones) && !omitido(f)),
  )
  if (deFlujo.length === 0 && archivos.length < TOPE_DE_COMPARE) {
    console.log(`al día: el kit avanzó fuera del flujo (${main.slice(0, 7)})`)
    return 0
  }
  const n = archivos.length >= TOPE_DE_COMPARE ? `${TOPE_DE_COMPARE} o más` : String(deFlujo.length)
  console.log(`${main.slice(0, 7)} · ${n} archivos de flujo`)
  return 10
}

/** Las decisiones de cada archivo de flujo de los dos árboles del kit. */
function decisiones(r, base, nuevo, archivos, opciones) {
  const nuevoTxt = archivoDe(nuevo, 'scripts/kit/flujo.txt')
  const patrones = nuevoTxt ? leerPatrones(nuevoTxt.contenido.toString('utf8')) : r.patrones
  const rutas = [...new Set([...archivos.base, ...archivos.nuevo])]
    .filter((f) => esFlujo(f, patrones))
    .sort()
  return rutas.map((ruta) => ({
    ruta,
    ...decidir({
      ruta,
      base: archivoDe(base, ruta),
      nuevo: archivoDe(nuevo, ruta),
      propio: archivoDe(r.raiz, ruta),
      valores: r.valores,
      omitir: r.omitir,
      tomarKit: opciones.tomarKit,
      dejar: opciones.dejar,
    }),
  }))
}

/** @param {string[]} rutas */
const lista = (rutas) =>
  rutas.length > 20
    ? `${rutas.slice(0, 20).join(', ')} y ${rutas.length - 20} más`
    : rutas.join(', ')

const SECCIONES = [
  ['traido', 'traídos del kit'],
  ['mezclado', 'mezclados'],
  ['nuevo', 'nuevos'],
  ['restaurado', 'restaurados (si no lo quieres, bórralo y anótalo en .kit/omitir)'],
  ['borrado', 'borrados'],
  ['omitido', 'omitidos por .kit/omitir'],
  ['tomado', 'tomados del kit (--tomar-kit)'],
  ['dejado', 'dejados como están (--dejar)'],
]

/** @param {{ ruta: string, como: string }[]} ds */
function resumen(ds) {
  for (const [como, titulo] of SECCIONES) {
    const rutas = ds.filter((d) => d.como === como).map((d) => d.ruta)
    if (rutas.length) console.log(`· ${titulo} (${rutas.length}): ${lista(rutas)}`)
  }
}

/** Escribe lo decidido, avanza `.kit/version` y commitea sólo eso. */
function aplicar(r, ds, main) {
  const tocadas = []
  for (const d of ds) {
    const f = join(r.raiz, d.ruta)
    if (d.accion === 'escribir' && d.contenido) {
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, d.contenido)
      chmodSync(f, (d.modo ?? 0) & 0o111 ? 0o755 : 0o644)
      tocadas.push(d.ruta)
    } else if (d.accion === 'borrar') {
      rmSync(f, { force: true })
      tocadas.push(d.ruta)
    }
  }
  writeFileSync(join(r.raiz, '.kit/version'), `${main}\n`)
  const add = git(r.raiz, 'add', '-A', '--', ...tocadas, '.kit/version')
  if (add.status !== 0) throw new Fallo(`apliqué, pero git add cayó: ${add.stderr.trim()}`)
  const c = git(r.raiz, 'commit', '-q', '-m', mensajeDelCommit(main))
  if (c.status !== 0) {
    const por = `${c.stdout}${c.stderr}`.trim().split('\n').slice(-5).join(' · ')
    throw new Fallo(
      `apliqué, pero el commit cayó: ${por} ; arregla y commitea con «${mensajeDelCommit(main)}»`,
    )
  }
  return git(r.raiz, 'rev-parse', '--short', 'HEAD').stdout.trim()
}

/** @param {string[]} argv @returns {number} el código de salida */
export function principal(argv) {
  const opciones = leerArgs(argv)
  const r = elRepo(opciones)
  const kit = kitGithub()
  const gh = ghDe(kit)
  const main = shaDe(gh, kit, 'main')
  if (main === r.version) {
    console.log(`al día con el kit (${main.slice(0, 7)})`)
    return 0
  }
  if (opciones.revisar) return revisar(r, gh, kit, main)
  try {
    shaDe(gh, kit, r.version)
  } catch {
    throw new Fallo(`no encuentro en el kit el commit de .kit/version (${r.version.slice(0, 7)})`)
  }
  const tmp = mkdtempSync(join(tmpdir(), 'kit-'))
  try {
    const base = join(tmp, 'base')
    const nuevo = join(tmp, 'nuevo')
    const archivos = {
      base: bajarArbol(gh, kit, r.version, base),
      nuevo: bajarArbol(gh, kit, main, nuevo),
    }
    const ds = decisiones(r, base, nuevo, archivos, opciones)
    const choques = ds.filter((d) => d.accion === 'choque')
    if (choques.length) {
      console.log(`✗ choques con el kit (${choques.length}): no toqué nada`)
      for (const d of choques) console.log(`  ${d.ruta}: ${d.motivo}`)
      console.log(
        'Para responder: --tomar-kit <ruta> · --dejar <ruta> · o una línea en .kit/omitir',
      )
      return 3
    }
    const commit = aplicar(r, ds, main)
    console.log(`✓ traje el flujo del kit hasta ${main.slice(0, 7)} · commit ${commit}`)
    resumen(ds)
    return 0
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = principal(process.argv.slice(2))
  } catch (e) {
    if (!(e instanceof Fallo || e instanceof SinAcceso)) throw e
    console.error(`actualizar: ${e.message}`)
    process.exitCode = e instanceof Fallo ? e.codigo : 1
  }
}
