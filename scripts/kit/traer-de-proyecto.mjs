// Trae al kit lo de flujo de un PR integrado de un proyecto (docs/KIT.md › «El flujo entre el kit y los proyectos»): la parte
// determinista de la skill traer-de-proyecto (.claude/skills/traer-de-proyecto/SKILL.md). Baja por GitHub el proyecto antes y después
// del squash del PR y, por cada archivo de flujo que cambió, aplica ese cambio sobre el kit genérico (`traerArchivo`, la mezcla doble:
// las líneas que el PR no tocó conservan sus marcadores). Sube las lecciones `(kit)` y `(semilla)`. Lo que pide criterio (generalizar
// nombres, resolver un choque, decidir un borrado) queda listado para la sesión.
//
//   node scripts/kit/traer-de-proyecto.mjs <cuenta/repo> <pr>                         sale con 0, 3 (choques) o 1
//   node scripts/kit/traer-de-proyecto.mjs comprobar --nombre <repo> --slug <slug>     sale con 1 si quedó un nombre sin generalizar
//
// Sólo del kit (no viaja). Se prueba en `traer-de-proyecto.test.ts`.
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
import { leerManifiesto, puertosDelRepo, repoPropio } from '../proyecto/manifiesto.mjs'
import { esFlujo, leerPatrones, patronesDelKit } from './flujo.mjs'
import { archivoDe, bajarArbol, ghDe, SinAcceso } from './kit-gh.mjs'
import { mezclar3 } from './mezcla.mjs'
import { personalizar, SinBloque } from './personalizar.mjs'
import { conOrigen, leccionesNuevas, SUGERENCIAS, sumarLeccion } from './traer-lecciones.mjs'

const USO =
  'uso: node scripts/kit/traer-de-proyecto.mjs <cuenta/repo> <pr> | comprobar --nombre <repo> --slug <slug>'
// Las lecciones llevan el nombre del repo en su sufijo: `comprobar` no las mira.
const CON_NOMBRE_A_PROPOSITO = ['docs/LECCIONES.md', 'docs/semillas/LECCIONES.md']

class Fallo extends Error {
  /** @param {string} m  @param {number} [codigo] */
  constructor(m, codigo = 1) {
    super(m)
    this.codigo = codigo
  }
}

/**
 * El cambio del PR (de `antes` a `despues`, los dos del proyecto, personalizados) sobre el kit genérico, sin perder sus marcadores:
 * r1 = mezcla(kit personalizado, antes, despues); r2 = mezcla(kit, kit personalizado, r1). Un cambio pegado a una línea con
 * marcador choca en r2: lo aplica la sesión a mano.
 * @param {{ ruta: string, kit: string, antes: string, despues: string, valores: Parameters<typeof personalizar>[2] }} e
 * @returns {{ texto: string, choque: string }}
 */
export function traerArchivo({ ruta, kit, antes, despues, valores }) {
  let pk
  try {
    pk = personalizar(ruta, kit, valores)
  } catch (e) {
    if (e instanceof SinBloque) return { texto: '', choque: e.message }
    throw e
  }
  const r1 = mezclar3({ propio: pk, base: antes, nuevo: despues })
  if (r1.choques) return { texto: '', choque: 'el cambio del PR choca con el kit' }
  const r2 = mezclar3({ propio: kit, base: pk, nuevo: r1.texto })
  if (r2.choques)
    return { texto: '', choque: 'el cambio del PR toca líneas con marcadores del kit' }
  return { texto: r2.texto, choque: '' }
}

/** @param {string} nombre  @param {string} slug */
const nombresDe = (nombre, slug) => {
  const esc = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9_-])(${esc(nombre)}|${esc(slug)})(?![A-Za-z0-9_])`, 'i')
}

/** @param {string} raiz  @param {string[]} a */
const git = (raiz, ...a) => spawnSync('git', ['-C', raiz, ...a], { encoding: 'utf8' })
/** @param {{ contenido: Buffer } | null} a */
const texto = (a) => (a ? a.contenido.toString('utf8') : '')
const esBinario = (/** @type {{ contenido: Buffer } | null} */ a) => !!a && a.contenido.includes(0)

/** Los valores para personalizar, del manifiesto y las funciones del proyecto después del PR. */
function valoresDe(dir, repo) {
  const m = texto(archivoDe(dir, '.proyecto/proyecto.yaml'))
  if (!m) throw new Fallo(`${repo} no tiene .proyecto/proyecto.yaml: no sé qué nombres generalizar`)
  const manifiesto = leerManifiesto(m)
  const propio = repoPropio(manifiesto, repo.split('/')[1])
  const p = puertosDelRepo(propio)
  const funciones = leerPatrones(texto(archivoDe(dir, 'e2e/funciones.txt')))
  return {
    nombre: propio.nombre,
    slug: manifiesto.proyecto,
    bloque: 'bloque' in p ? p.bloque : null,
    funciones: funciones.flatMap((l) => l.split(/\s+/)).join(' '),
  }
}

/** Lo que pasa con una ruta de flujo que cambió en el PR; escribe en el kit lo que se puede aplicar solo. */
function traerRuta(c, ruta) {
  const a = archivoDe(c.antes, ruta)
  const d = archivoDe(c.despues, ruta)
  const k = archivoDe(c.raiz, ruta)
  const choque = (motivo) => {
    for (const [lado, x] of [
      ['antes', a],
      ['despues', d],
      ['kit', k],
    ])
      if (x) {
        mkdirSync(dirname(join(c.copias, lado, ruta)), { recursive: true })
        writeFileSync(join(c.copias, lado, ruta), x.contenido)
      }
    c.r.choques.push(`${ruta}: ${motivo}`)
  }
  if (!d) return void c.r.porDecidir.push(`${ruta}: el PR lo borró`)
  if (!k && a) return void c.r.porDecidir.push(`${ruta}: el PR lo cambió y el kit ya no lo tiene`)
  if (k && !a) return choque('el PR lo creó y el kit ya lo tiene')
  let nuevo = d.contenido
  if (k && a && (esBinario(a) || esBinario(d) || esBinario(k))) {
    if (!k.contenido.equals(a.contenido)) return choque('es binario y el kit tiene otro')
  } else if (k && a) {
    const t = traerArchivo({
      ruta,
      kit: texto(k),
      antes: texto(a),
      despues: texto(d),
      valores: c.valores,
    })
    if (t.choque) return choque(t.choque)
    nuevo = Buffer.from(t.texto)
  }
  const f = join(c.raiz, ruta)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, nuevo)
  chmodSync(f, d.modo & 0o111 ? 0o755 : 0o644)
  ;(k ? c.r.aplicados : c.r.nuevos).push(ruta)
  const viejas = new Set(texto(k).split('\n'))
  nuevo
    .toString('utf8')
    .split('\n')
    .forEach((l, i) => {
      if (!viejas.has(l) && c.nombres.test(l)) c.r.generalizar.push(`${ruta}:${i + 1}: ${l.trim()}`)
    })
}

/** Las lecciones `(kit)` y `(semilla)` nuevas del PR, en las lecciones del kit y en las de las semillas. */
function traerLecciones(c, pr) {
  const nuevas = leccionesNuevas(
    texto(archivoDe(c.antes, 'docs/LECCIONES.md')),
    texto(archivoDe(c.despues, 'docs/LECCIONES.md')),
  )
  for (const l of nuevas) {
    const [ruta, seccion] =
      l.tipo === 'kit'
        ? ['docs/LECCIONES.md', l.seccion || 'Del flujo']
        : ['docs/semillas/LECCIONES.md', SUGERENCIAS]
    const f = join(c.raiz, ruta)
    const antes = existsSync(f) ? readFileSync(f, 'utf8') : `# Lecciones\n`
    const despues = sumarLeccion(antes, seccion, conOrigen(l.linea, c.valores.nombre, pr))
    if (despues !== antes) writeFileSync(f, despues)
    c.r.lecciones.push(`${ruta} › ${seccion}: ${l.linea}`)
  }
}

/** @param {string} titulo  @param {string[]} cosas */
const seccion = (titulo, cosas) => {
  if (cosas.length)
    console.log(`· ${titulo} (${cosas.length}):\n${cosas.map((x) => `  ${x}`).join('\n')}`)
}

/** @param {string} repo  @param {string} pr  @returns {number} */
function traer(repo, pr) {
  const raiz = git(process.cwd(), 'rev-parse', '--show-toplevel').stdout.trim()
  if (!raiz || !existsSync(join(raiz, '.kit/plantilla')))
    throw new Fallo('traer-de-proyecto.mjs corre en el kit')
  const gh = ghDe(repo, 'al proyecto')
  const p = JSON.parse(
    String(gh(['api', `repos/${repo}/pulls/${pr}`, '--jq', '{merged, merge_commit_sha}'])),
  )
  if (!p.merged || !p.merge_commit_sha) throw new Fallo(`el PR #${pr} de ${repo} no está integrado`)
  const padre = String(
    gh(['api', `repos/${repo}/commits/${p.merge_commit_sha}`, '--jq', '.parents[0].sha // ""']),
  ).trim()
  if (!padre) throw new Fallo(`el commit integrado del PR #${pr} no tiene padre`)
  const tmp = mkdtempSync(join(tmpdir(), 'traer-'))
  try {
    const c = {
      raiz,
      antes: join(tmp, 'antes'),
      despues: join(tmp, 'despues'),
      copias: join(tmpdir(), `traer-${repo.split('/')[1]}-${pr}`),
    }
    const enAntes = bajarArbol(gh, repo, padre, c.antes)
    const enDespues = bajarArbol(gh, repo, p.merge_commit_sha, c.despues)
    const valores = valoresDe(c.despues, repo)
    const propio = join(raiz, 'scripts/kit/flujo.txt')
    const patrones = existsSync(propio)
      ? leerPatrones(readFileSync(propio, 'utf8'))
      : patronesDelKit()
    const r = {
      aplicados: [],
      nuevos: [],
      porDecidir: [],
      choques: [],
      generalizar: [],
      lecciones: [],
    }
    const ctx = { ...c, valores, r, nombres: nombresDe(valores.nombre, valores.slug) }
    rmSync(c.copias, { recursive: true, force: true })
    const cambiaron = [...new Set([...enAntes, ...enDespues])].filter((f) => {
      if (f === 'docs/LECCIONES.md' || !esFlujo(f, patrones)) return false
      const a = archivoDe(c.antes, f)
      const d = archivoDe(c.despues, f)
      return !a || !d || !a.contenido.equals(d.contenido)
    })
    for (const ruta of cambiaron.sort()) traerRuta(ctx, ruta)
    traerLecciones(ctx, pr)
    console.log(
      `traer de ${repo} el PR #${pr} (squash ${p.merge_commit_sha.slice(0, 7)}) · ${valores.nombre}, slug ${valores.slug}`,
    )
    seccion('aplicados sobre el kit', r.aplicados)
    seccion('nuevos en el kit (generalízalos)', r.nuevos)
    seccion('lecciones', r.lecciones)
    seccion('por decidir (no apliqué nada)', r.porDecidir)
    seccion('por generalizar', r.generalizar)
    if (!cambiaron.length && !r.lecciones.length) console.log('· nada de flujo cambió en este PR')
    if (!r.choques.length) return 0
    seccion(
      `✗ choques: las tres versiones (antes, despues, kit) quedaron en ${c.copias}`,
      r.choques,
    )
    return 3
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** `comprobar`: las líneas agregadas respecto de origin/main (y los archivos sin seguir) que nombran el repo o su slug. */
function comprobar(argv) {
  const nombre = argv[argv.indexOf('--nombre') + 1]
  const slug = argv[argv.indexOf('--slug') + 1]
  if (!argv.includes('--nombre') || !argv.includes('--slug') || !nombre || !slug)
    throw new Fallo(USO, 64)
  const raiz = git(process.cwd(), 'rev-parse', '--show-toplevel').stdout.trim()
  const re = nombresDe(nombre, slug)
  const quedan = []
  let archivo = ''
  let n = 0
  for (const l of git(raiz, 'diff', '-U0', '--no-color', 'origin/main').stdout.split('\n')) {
    const h = /^@@ -\S+ \+(\d+)/.exec(l)
    if (l.startsWith('+++ ')) archivo = l.replace(/^\+\+\+ (b\/)?/, '')
    else if (h) n = Number(h[1])
    else if (l.startsWith('+')) {
      if (!CON_NOMBRE_A_PROPOSITO.includes(archivo) && re.test(l))
        quedan.push(`${archivo}:${n}: ${l.slice(1).trim()}`)
      n++
    }
  }
  for (const f of git(raiz, 'ls-files', '--others', '--exclude-standard')
    .stdout.split('\n')
    .filter(Boolean))
    readFileSync(join(raiz, f), 'utf8')
      .split('\n')
      .forEach((l, i) => {
        if (re.test(l)) quedan.push(`${f}:${i + 1}: ${l.trim()}`)
      })
  if (!quedan.length) {
    console.log(`✓ ningún ${nombre} ni ${slug} sin generalizar`)
    return 0
  }
  console.log(
    `✗ quedan nombres de ${nombre} sin generalizar (${quedan.length}):\n${quedan.map((q) => `  ${q}`).join('\n')}`,
  )
  return 1
}

/** @param {string[]} argv  @returns {number} */
export function principal(argv) {
  if (argv[0] === 'comprobar') return comprobar(argv.slice(1))
  const [repo = '', pr = ''] = argv
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo) || !/^\d+$/.test(pr) || argv.length !== 2)
    throw new Fallo(USO, 64)
  return traer(repo, pr)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = principal(process.argv.slice(2))
  } catch (e) {
    if (!(e instanceof Fallo || e instanceof SinAcceso)) throw e
    console.error(`traer-de-proyecto: ${e.message}`)
    process.exitCode = e instanceof Fallo ? e.codigo : 1
  }
}
