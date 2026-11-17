// El aviso de la noche (.github/workflows/ci.yml › aviso-noche, docs/FLUJO.md): después del e2e completo de cada noche, abre, comenta o
// cierra el issue con la etiqueta `noche-roja`. Rojo: lo abre (o le suma la noche) con el enlace de la corrida y los specs caídos, y
// lleva la cuenta de noches seguidas en `<!-- noches: N -->`. A la segunda noche seguida reescribe el cuerpo como spec y le pone
// `cola` y `cola:urgente`: el orquestador lo toma como tarea («se arregla si cae dos noches seguidas», .claude/rules/e2e.md). Verde:
// cierra el que no está en la cola. Corre en el runner sólo con node (sin `pnpm install`) y `gh` con GITHUB_TOKEN.
//
//   NECESIDADES='${{ toJSON(needs) }}' FALLOS=<artefactos e2e-bloque-*> node scripts/flujo/noche.mjs
//
// (y GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SERVER_URL, que pone Actions). Aquí, qué hacer en GitHub (puro) y la CLI; los textos del
// issue, en noche-textos.mjs. Se prueba en noche.test.ts (lo puro) y noche-gh.test.ts (la CLI con un gh falso).
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { comentarioDeNoche, cuerpoDeAviso, cuerpoDeSpec, PREFIJO } from './noche-textos.mjs'

export { PREFIJO }

export const ETIQUETA = 'noche-roja'
export const TITULO = 'e2e de la noche en rojo'
// El mismo nombre que CAIDOS de scripts/e2e-fallos.ts (lo escribe el reporter de fallos; noche.test.ts los compara).
export const CAIDOS = 'caidos.txt'
export const MARCA = /<!--\s*noches:\s*(\d+)\s*-->/
export const MARCA_DUPLICADO = '<!-- noche: duplicado -->'
const ROJO = ['failure', 'cancelled']

/**
 * @typedef {{ result?: string }} Necesidad
 * @typedef {{ number: number, body: string, labels: string[], comentarios: string[] }} Abierto
 * @typedef {{ tipo: 'crear', titulo: string, cuerpo: string, etiquetas: string[] }
 *   | { tipo: 'comentar', n: number, texto: string }
 *   | { tipo: 'editar', n: number, cuerpo: string, etiquetas: string[] }
 *   | { tipo: 'cerrar', n: number }} Accion
 */

/**
 * Cómo salió la noche: `rojo` si la compilación o un bloque del e2e cayó o se canceló, `verde` si el e2e pasó, `nada` si no corrió
 * (una noche sin commits, o el kit, que salta los e2e). Puro.
 * @param {Record<string, Necesidad>} necesidades el `needs` del job
 * @returns {'rojo' | 'verde' | 'nada'}
 */
export function resultadoDeLaNoche(necesidades) {
  const build = necesidades['e2e-build']?.result ?? ''
  const e2e = necesidades['e2e']?.result ?? ''
  if (ROJO.includes(build) || ROJO.includes(e2e)) return 'rojo'
  return e2e === 'success' ? 'verde' : 'nada'
}

/** Las noches seguidas que lleva el cuerpo (0 sin marca). Puro. @param {string} cuerpo */
export const nochesDe = (cuerpo) => Number(MARCA.exec(cuerpo)?.[1] ?? 0)

// Una noche anotada, como la escribe `decidir`: la fecha y el enlace de la corrida. Otra línea del cuerpo (alguien lo editó) no pasa a
// la spec: el cuerpo es el prompt de una sesión.
const LINEA_DE_NOCHE = /^- \d{4}-\d{2}-\d{2}: https:\/\/\S+\/actions\/runs\/\d+$/

/**
 * Las noches anotadas en la sección «Noches en rojo» del cuerpo (sólo las líneas con el formato de LINEA_DE_NOCHE). Puro.
 * @param {string} cuerpo
 */
export function lineasDeNoches(cuerpo) {
  const lineas = cuerpo.replace(/\r\n/g, '\n').split('\n')
  const ini = lineas.findIndex((l) => /^##\s+Noches en rojo\s*$/.test(l))
  if (ini < 0) return []
  const resto = lineas.slice(ini + 1)
  const fin = resto.findIndex((l) => /^#{1,2}\s/.test(l))
  return (fin < 0 ? resto : resto.slice(0, fin)).filter((l) => LINEA_DE_NOCHE.test(l))
}

/** Si el texto nombra esa corrida (y no otra que empieza igual: …/runs/12 no es …/runs/123). Puro. */
const menciona = (/** @type {string} */ texto, /** @type {string} */ enlace) =>
  texto.split(enlace).length > 1 &&
  !texto
    .split(enlace)
    .slice(1)
    .every((r) => /^\d/.test(r))

/**
 * Lo que hay que hacer en GitHub esta noche. Manda el abierto de número menor; los otros reciben una sola vez el comentario de
 * duplicado. Un issue en la cola no se edita más (editarlo dispararía el «vi el cambio» del espejo con la tarea corriendo): sólo se
 * comenta. La misma corrida otra vez (volver a correr lo que cayó) no cuenta otra noche. Puro.
 * @param {{ resultado: 'rojo' | 'verde' | 'nada', abiertos: Abierto[], caidos: string[], enlace: string, fecha: string, corrida: string }} a
 * @returns {Accion[]}
 */
export function decidir({ resultado, abiertos, caidos, enlace, fecha, corrida }) {
  const ordenados = [...abiertos].sort((a, b) => a.number - b.number)
  const enLaCola = (/** @type {Abierto} */ i) => i.labels.includes('cola')
  if (resultado === 'nada') return []
  if (resultado === 'verde')
    return ordenados
      .filter((i) => !enLaCola(i))
      .flatMap((i) => [
        {
          tipo: 'comentar',
          n: i.number,
          texto: `${PREFIJO} el e2e de la noche salió verde (${enlace}): lo cierro.\n`,
        },
        { tipo: 'cerrar', n: i.number },
      ])
  const linea = `- ${fecha}: ${enlace}`
  const [principal, ...otros] = ordenados
  if (!principal)
    return [
      {
        tipo: 'crear',
        titulo: TITULO,
        cuerpo: cuerpoDeAviso({ noches: 1, caidos, lineas: [linea] }),
        etiquetas: [ETIQUETA],
      },
    ]
  /** @type {Accion[]} */
  const acciones = otros
    .filter((i) => !i.comentarios.some((c) => c.includes(MARCA_DUPLICADO)))
    .map((i) => ({
      tipo: 'comentar',
      n: i.number,
      texto: `${PREFIJO} hay otro issue noche-roja abierto, más viejo (#${principal.number}): las noches se anotan ahí. Cierra éste cuando quieras.\n\n${MARCA_DUPLICADO}\n`,
    }))
  if ([principal.body, ...principal.comentarios].some((t) => menciona(t, enlace))) return acciones
  const n = principal.number
  if (enLaCola(principal))
    return [
      ...acciones,
      {
        tipo: 'comentar',
        n,
        texto: comentarioDeNoche({ noches: 0, enlace, caidos, aCola: false, enCola: true }),
      },
    ]
  const noches = nochesDe(principal.body) + 1
  const lineas = [...lineasDeNoches(principal.body), linea]
  const aCola = noches >= 2
  const cuerpo = aCola
    ? cuerpoDeSpec({ n, noches, caidos, lineas, corrida })
    : cuerpoDeAviso({ noches, caidos, lineas })
  const etiquetas = aCola
    ? [...new Set([...principal.labels, 'cola', 'cola:urgente'])]
    : principal.labels
  return [
    ...acciones,
    { tipo: 'editar', n, cuerpo, etiquetas },
    { tipo: 'comentar', n, texto: comentarioDeNoche({ noches, enlace, caidos, aCola }) },
  ]
}

// ---------- la CLI, para el job aviso-noche ----------

const COLORES = {
  'noche-roja': ['e11d21', 'El e2e de la noche cayó (scripts/flujo/noche.mjs)'],
  cola: ['5319e7', 'Tarea de la cola del orquestador'],
  'cola:urgente': ['d93f0b', 'Va primero al lanzar'],
}

/** @param {string[]} args */
const gh = (args) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
/** @param {string} camino  @param {string[]} [campos]  @param {string} [metodo] */
const api = (camino, campos = [], metodo = 'GET') =>
  JSON.parse(gh(['api', '-X', metodo, camino, ...campos]) || 'null')

/** Los caídos de los artefactos (`caidos.txt` de cada bloque). Sin ellos, los jobs caídos de la corrida; si esa API falla, las
 * claves de `needs` en rojo. @param {string} dir  @param {string} repo  @param {string} corrida  @param {Record<string, Necesidad>} necesidades */
function caidosDe(dir, repo, corrida, necesidades) {
  const archivos =
    dir && existsSync(dir)
      ? readdirSync(dir, { recursive: true })
          .map(String)
          .filter((f) => basename(f) === CAIDOS)
      : []
  const lineas = archivos
    .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n'))
    .filter(Boolean)
  if (lineas.length) return [...new Set(lineas)].sort()
  try {
    const jobs = /** @type {{ jobs: { name: string, conclusion: string | null }[] }} */ (
      api(`repos/${repo}/actions/runs/${corrida}/jobs?per_page=100`)
    ).jobs
    return jobs
      .filter((j) => ['failure', 'cancelled', 'timed_out'].includes(j.conclusion ?? ''))
      .map((j) => `job «${j.name}»`)
  } catch {
    return Object.entries(necesidades)
      .filter(([, v]) => ROJO.includes(v.result ?? ''))
      .map(
        ([k]) => `job ${k} (de needs: la corrida no dejó caidos.txt ni se pudieron leer sus jobs)`,
      )
  }
}

/** @param {string} repo  @returns {Abierto[]} */
function abiertosDe(repo) {
  /** @type {{ number: number, body: string | null, labels: { name: string }[], pull_request?: unknown }[]} */
  const issues = api(`repos/${repo}/issues?labels=${ETIQUETA}&state=open&per_page=100`)
  return issues
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      body: i.body ?? '',
      labels: i.labels.map((l) => (typeof l === 'string' ? l : l.name)),
      comentarios: /** @type {{ body: string | null }[]} */ (
        api(`repos/${repo}/issues/${i.number}/comments?per_page=100`)
      ).map((c) => c.body ?? ''),
    }))
}

/** @param {string} repo  @param {Accion[]} acciones */
function asegurarEtiquetas(repo, acciones) {
  const quiere = new Set(acciones.flatMap((a) => ('etiquetas' in a ? a.etiquetas : [])))
  const hay = new Set(
    /** @type {{ name: string }[]} */ (api(`repos/${repo}/labels?per_page=100`)).map((l) => l.name),
  )
  for (const [nombre, [color, desc]] of Object.entries(COLORES))
    if (quiere.has(nombre) && !hay.has(nombre))
      api(
        `repos/${repo}/labels`,
        ['-f', `name=${nombre}`, '-f', `color=${color}`, '-f', `description=${desc}`],
        'POST',
      )
}

/** @param {string} repo  @param {Accion} a */
function aplicar(repo, a) {
  const etiquetas = (/** @type {string[]} */ e) => e.flatMap((l) => ['-f', `labels[]=${l}`])
  if (a.tipo === 'crear')
    api(
      `repos/${repo}/issues`,
      ['-f', `title=${a.titulo}`, '-f', `body=${a.cuerpo}`, ...etiquetas(a.etiquetas)],
      'POST',
    )
  else if (a.tipo === 'comentar')
    api(`repos/${repo}/issues/${a.n}/comments`, ['-f', `body=${a.texto}`], 'POST')
  else if (a.tipo === 'editar')
    api(
      `repos/${repo}/issues/${a.n}`,
      ['-f', `body=${a.cuerpo}`, ...etiquetas(a.etiquetas)],
      'PATCH',
    )
  else
    api(
      `repos/${repo}/issues/${a.n}`,
      ['-f', 'state=closed', '-f', 'state_reason=completed'],
      'PATCH',
    )
  console.log(`${PREFIJO} ${a.tipo}${'n' in a ? ` #${a.n}` : ''}`)
}

/** @param {NodeJS.ProcessEnv} env */
function principal(env) {
  /** @type {Record<string, Necesidad>} */
  const necesidades = JSON.parse(env['NECESIDADES'] || '{}')
  const resultado = resultadoDeLaNoche(necesidades)
  if (resultado === 'nada')
    return void console.log(`${PREFIJO} la noche no corrió el e2e: nada que avisar`)
  const repo = env['GITHUB_REPOSITORY'] ?? ''
  const corrida = env['GITHUB_RUN_ID'] ?? ''
  const enlace = `${env['GITHUB_SERVER_URL'] || 'https://github.com'}/${repo}/actions/runs/${corrida}`
  const fecha = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/La_Paz' })
  const caidos =
    resultado === 'rojo' ? caidosDe(env['FALLOS'] ?? '', repo, corrida, necesidades) : []
  const acciones = decidir({
    resultado,
    abiertos: abiertosDe(repo),
    caidos,
    enlace,
    fecha,
    corrida,
  })
  asegurarEtiquetas(repo, acciones)
  for (const a of acciones) aplicar(repo, a)
  if (acciones.length === 0) console.log(`${PREFIJO} ${resultado}: nada que cambiar en los issues`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  principal(process.env)
