// El cierre de la construcción de un repo (la última tarea de su cola: scripts/orquestador/plantillas/cerrar-construccion.md): lo
// determinista, para que la sesión sólo complete lo que pide criterio. Corre en la raíz del repo, con `gh` de la cuenta dueña.
//
//   node scripts/flujo/cierre.mjs pasos     --etiqueta semilla-vN   los pasos del plan que no están integrados ni omitidos
//   node scripts/flujo/cierre.mjs aplicar   --etiqueta semilla-vN   escribe los docs de mantenimiento, pasa el repo a mantenimiento
//                                                                    en .proyecto/proyecto.yaml y saca docs/semilla/ (se repite sin riesgo)
//   node scripts/flujo/cierre.mjs retro                             el borrador de «## Retro» para el cuerpo del PR, por stdout
//   node scripts/flujo/cierre.mjs comprobar --etiqueta semilla-vN --cuerpo <archivo>   lo que falta antes de publicar
//
// Sale con 0 bien · 1 lo que falta (en stdout) · 2 GitHub no respondió (en stderr) · 64 el uso mal escrito. La etiqueta no la crea
// esto ni la sesión: la crea el orquestador al integrar el PR (`al_integrar`, scripts/orquestador/al-integrar.sh). Lo puro está en
// cierre-docs.mjs y cierre-retro.mjs; se prueba en cierre.test.ts y, de punta a punta, en scripts/kit/cierre-ensayo.test.mjs.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseDocument } from 'yaml'
import {
  leerManifiesto,
  ManifiestoInvalido,
  repoDeEsteWorktree,
  RUTA_MANIFIESTO,
} from '../proyecto/manifiesto.mjs'
import {
  decisionesDePrs,
  leccionesConSemillas,
  riesgosDeLaSemilla,
  textoDecisiones,
  textoEstado,
  textoPendientes,
} from './cierre-docs.mjs'
import {
  borradorRetro,
  datosDeIssue,
  DOCS,
  pasosSinTerminar,
  problemasDelCierre,
} from './cierre-retro.mjs'

class Uso extends Error {}
class SinGitHub extends Error {}
const ETIQUETA = /^semilla-v\d+$/

/** @param {string[]} args */
function gh(args) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024,
    })
  } catch (e) {
    const err = /** @type {{ stderr?: string, message?: string }} */ (e)
    throw new SinGitHub(
      `GitHub no respondió: ${(err.stderr || err.message || '').trim().slice(0, 300)}`,
    )
  }
}
/** Una lista paginada de la API, un objeto por línea (`tojson`: lo mismo con el gh de verdad que con el falso). @param {string} camino  @param {string} [filtro] */
const lista = (camino, filtro = '.[]') =>
  gh(['api', '--paginate', camino, '--jq', `${filtro} | tojson`])
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))

const issuesDeLaCola = () =>
  lista(
    'repos/{owner}/{repo}/issues?labels=cola&state=all&per_page=100',
    '.[] | select(has("pull_request") | not)',
  )
/** @param {number} n */
const comentariosDe = (n) => lista(`repos/{owner}/{repo}/issues/${n}/comments?per_page=100`)
/** @returns {{ number: number, title: string, body: string }[]} */
const prsIntegrados = () =>
  JSON.parse(
    gh(['pr', 'list', '--state', 'merged', '--limit', '1000', '--json', 'number,title,body']) ||
      '[]',
  )
/** @param {string} e */
const etiquetaExiste = (e) =>
  gh([
    'api',
    `repos/{owner}/{repo}/git/matching-refs/tags/${e}`,
    '--jq',
    `[.[] | select(.ref == "refs/tags/${e}")] | length`,
  ]).trim() !== '0'

/**
 * El manifiesto con el repo `rol` en mantenimiento y su `semilla` en la etiqueta: sólo esos dos valores, por sus rangos (el resto del
 * texto y sus comentarios quedan byte a byte), y revisado antes de devolverlo. Puro.
 * @param {string} texto  @param {string} rol  @param {string} etiqueta
 */
export function manifiestoEnMantenimiento(texto, rol, etiqueta) {
  const doc = parseDocument(texto)
  const repos = /** @type {any} */ (doc.get('repos'))
  const i = (repos?.items ?? []).findIndex((/** @type {any} */ r) => r.get?.('rol') === rol)
  if (i < 0) throw new ManifiestoInvalido(`${RUTA_MANIFIESTO}: el repo «${rol}» no está`)
  const repo = repos.items[i]
  const nodos = [
    [repo.get('etapa', true), 'mantenimiento'],
    [repo.get('semilla', true), etiqueta],
  ]
  let nuevo
  if (nodos.every(([n]) => n?.range)) {
    nuevo = texto
    for (const [n, v] of nodos.sort((a, b) => b[0].range[0] - a[0].range[0]))
      nuevo = nuevo.slice(0, n.range[0]) + v + nuevo.slice(n.range[1])
  } else {
    doc.setIn(['repos', i, 'etapa'], 'mantenimiento')
    doc.setIn(['repos', i, 'semilla'], etiqueta)
    nuevo = doc.toString({ lineWidth: 0 })
  }
  leerManifiesto(nuevo)
  return nuevo
}

/**
 * Un doc como está en HEAD: lo que había antes del cierre aunque una pasada cortada ya lo haya reescrito (así repetir `aplicar` no
 * duplica secciones). Sin git o sin el archivo, null.
 * @param {string} raiz  @param {string} f
 */
function enHead(raiz, f) {
  try {
    return execFileSync('git', ['-C', raiz, 'show', `HEAD:${f}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}
/** @param {string} raiz  @param {string} f */
const leer = (raiz, f) => (existsSync(join(raiz, f)) ? readFileSync(join(raiz, f), 'utf8') : null)
/** @param {string} raiz */
const modulosDe = (raiz) =>
  existsSync(join(raiz, 'src/modules'))
    ? readdirSync(join(raiz, 'src/modules'), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    : []
/** @param {{ etiquetas: string[] }} t */
const estadoDe = (t) => t.etiquetas.find((e) => e.startsWith('cola:')) ?? 'abierto'

/** @param {string} etiqueta */
function pasos(etiqueta) {
  const faltan = pasosSinTerminar(issuesDeLaCola().map((i) => datosDeIssue(i, [])))
  for (const t of faltan) console.log(`✗ ${t.paso} (#${t.numero}): sin integrar (${estadoDe(t)})`)
  if (faltan.length) return 1
  console.log('✓ todos los pasos del plan están integrados u omitidos')
  if (etiquetaExiste(etiqueta))
    console.log(
      `· la etiqueta ${etiqueta} ya existe: el orquestador no la va a pisar (dilo en el PR)`,
    )
  return 0
}

/** @param {string} raiz  @param {string} etiqueta */
function aplicar(raiz, etiqueta) {
  if (!existsSync(join(raiz, 'docs/semilla'))) {
    console.log('docs/semilla/ ya no está: el cierre ya se aplicó')
    return 0
  }
  const propio = repoDeEsteWorktree(raiz)
  if (!propio) throw new ManifiestoInvalido(`sin ${RUTA_MANIFIESTO}: no sé qué repo cerrar`)
  // Una retoma tras un corte entre el manifiesto y el borrado de docs/semilla/ sigue; otra etiqueta ya puesta, no.
  if (propio.repo.etapa === 'mantenimiento' && propio.repo.semilla !== etiqueta) {
    console.log(
      `✗ ${propio.repo.nombre} ya está en mantenimiento con «semilla: ${String(propio.repo.semilla)}» en ${RUTA_MANIFIESTO}: no toco nada`,
    )
    return 1
  }
  const faltan = ['docs/LECCIONES.md', 'docs/FLUJO.md'].filter((f) => !existsSync(join(raiz, f)))
  if (faltan.length) {
    console.log(`✗ faltan ${faltan.join(' y ')}: vienen del kit; tráelos antes de cerrar`)
    return 1
  }
  const manifiesto = manifiestoEnMantenimiento(
    leer(raiz, RUTA_MANIFIESTO) ?? '',
    propio.repo.rol,
    etiqueta,
  )
  const semilla = (/** @type {string} */ f) => leer(raiz, `docs/semilla/${f}`) ?? ''
  const escribir = (/** @type {string} */ f, /** @type {string} */ t) =>
    writeFileSync(join(raiz, f), t)
  escribir(
    'docs/DECISIONES.md',
    textoDecisiones({
      registro: semilla('registro.md'),
      etiqueta,
      existente: enHead(raiz, 'docs/DECISIONES.md'),
    }),
  )
  escribir(
    'docs/PENDIENTES.md',
    textoPendientes({
      riesgos: riesgosDeLaSemilla(semilla('comun.md'), semilla('semilla.md')),
      decisiones: decisionesDePrs(prsIntegrados()),
      existente: enHead(raiz, 'docs/PENDIENTES.md'),
    }),
  )
  const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date())
  escribir('docs/ESTADO.md', textoEstado({ fecha, etiqueta, modulos: modulosDe(raiz) }))
  escribir('docs/LECCIONES.md', leccionesConSemillas(leer(raiz, 'docs/LECCIONES.md') ?? ''))
  escribir(RUTA_MANIFIESTO, manifiesto)
  rmSync(join(raiz, 'docs/semilla'), { recursive: true })
  console.log(
    [
      '✓ escribí docs/ESTADO.md, docs/PENDIENTES.md y docs/DECISIONES.md, y sumé «Para las semillas» a docs/LECCIONES.md si faltaba',
      `✓ ${propio.repo.nombre} queda en etapa: mantenimiento, semilla: ${etiqueta} (${RUTA_MANIFIESTO})`,
      '✓ saqué docs/semilla/ (queda en la etiqueta)',
      '· falta: completar cada «completar» de docs/ESTADO.md y revisar PENDIENTES y DECISIONES',
    ].join('\n'),
  )
  return 0
}

function retro() {
  const tareas = issuesDeLaCola()
    .filter((i) => !(i.labels ?? []).some((/** @type {any} */ l) => (l.name ?? l) === 'deps'))
    .map((i) => datosDeIssue(i, comentariosDe(i.number)))
  process.stdout.write(borradorRetro({ tareas, decisiones: decisionesDePrs(prsIntegrados()) }))
  return 0
}

/** @param {string} raiz  @param {string} etiqueta  @param {string} cuerpo */
function comprobar(raiz, etiqueta, cuerpo) {
  if (!existsSync(cuerpo)) throw new Uso(`no encuentro el cuerpo del PR: ${cuerpo}`)
  const problemas = problemasDelCierre({
    archivos: Object.fromEntries(DOCS.map((f) => [f, leer(raiz, f)])),
    semillaPresente: existsSync(join(raiz, 'docs/semilla')),
    repo: repoDeEsteWorktree(raiz)?.repo ?? null,
    etiqueta,
    cuerpo: readFileSync(cuerpo, 'utf8'),
  })
  for (const p of problemas) console.log(`✗ ${p}`)
  if (!problemas.length) console.log('✓ cierre listo')
  return problemas.length ? 1 : 0
}

/** @param {string[]} argv */
function opciones(argv) {
  const [orden = '', ...resto] = argv
  /** @type {Record<string, string>} */
  const o = {}
  for (let i = 0; i < resto.length; i += 2) {
    const k = resto[i] ?? ''
    if (!['--etiqueta', '--cuerpo'].includes(k) || resto[i + 1] === undefined)
      throw new Uso(`no entiendo «${k}»`)
    o[k.slice(2)] = resto[i + 1] ?? ''
  }
  const etiqueta = o['etiqueta'] ?? ''
  if (orden !== 'retro' && !ETIQUETA.test(etiqueta)) throw new Uso('falta --etiqueta semilla-v<N>')
  if (orden === 'comprobar' && !o['cuerpo']) throw new Uso('falta --cuerpo <archivo>')
  return { orden, etiqueta, cuerpo: o['cuerpo'] ?? '' }
}

/** @param {string[]} argv  @param {string} raiz */
export function principal(argv, raiz) {
  try {
    const { orden, etiqueta, cuerpo } = opciones(argv)
    if (orden === 'pasos') return pasos(etiqueta)
    if (orden === 'aplicar') return aplicar(raiz, etiqueta)
    if (orden === 'retro') return retro()
    if (orden === 'comprobar') return comprobar(raiz, etiqueta, cuerpo)
    throw new Uso(`no conozco «${orden}»`)
  } catch (e) {
    if (e instanceof Uso) {
      console.error(
        `${e.message}\nuso: node scripts/flujo/cierre.mjs pasos|aplicar|comprobar --etiqueta semilla-vN [--cuerpo <archivo>] | retro`,
      )
      return 64
    }
    if (e instanceof SinGitHub) {
      console.error(e.message)
      return 2
    }
    if (e instanceof ManifiestoInvalido) {
      console.log(`✗ ${e.message}`)
      return 1
    }
    throw e
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = principal(process.argv.slice(2), process.cwd())
