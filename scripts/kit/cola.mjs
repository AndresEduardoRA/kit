// La cola de cada repo nuevo en sus issues: un issue `cola` por paso del plan, en el orden de todo el proyecto, y el cierre al final.
// Idempotente: un paso que ya tiene issue (por el `paso:` de su yaml) no se crea y su número se usa, así que volver a correr después de
// un corte o del límite de la API no duplica. Los números los da GitHub: nunca se adivinan (issues y PR comparten numeración); para
// otro repo, la dependencia va por su rama (`<repo>:<rama>`). Se prueba con un gh falso en `publicar-proyecto.test.mjs`.
import {
  archivoDeIssue,
  canonico,
  issueDeArchivo,
  leerArchivo,
} from '../orquestador/spec-issue.mjs'
import { fallo } from './github.mjs'
import {
  nodoDe,
  ordenDelProyecto,
  ramaDelPaso,
  specDelCierre,
  specDelPaso,
} from './plan-a-cola.mjs'
import { exigir, Problema } from './problema.mjs'

// Quien puede escribir en el repo (lección K05): en un repo público, un issue ajeno con `paso: P03` no puede hacer saltar el real.
export const CON_PERMISO = ['OWNER', 'MEMBER', 'COLLABORATOR']
// Las etiquetas de una tarea que ya arrancó: su spec no se toca.
const ARRANCADA = [
  'corriendo',
  'esperando-ci',
  'por-arreglar',
  'trabada',
  'integrada',
  'omitida',
].map((e) => `cola:${e}`)
// GitHub corta el cuerpo de un issue en 65.536 caracteres.
const TOPE_DEL_CUERPO = 60_000

const dormir = (ms) => {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
const valor = (t, k) => t.campos.find(([c]) => c === k)?.[1] ?? ''

/**
 * Los issues `cola` del repo que salieron de un paso, por su `paso:`: { numero, rama, abierto, etiquetas, tarea }. Sin el repo en
 * GitHub, ninguno. Un yaml roto o un autor sin permiso no cuentan.
 */
export function issuesPorPaso(gh, github) {
  const r = gh([
    'api',
    '--paginate',
    `repos/${github}/issues?state=all&labels=cola&per_page=100`,
    '--jq',
    '.[]',
  ])
  if (!r.ok && r.tipo === '404') return new Map()
  if (!r.ok) fallo(r, `no pude leer los issues de ${github}`)
  const porPaso = new Map()
  // De la más vieja a la más nueva: ante dos issues con el mismo `paso:` vale el original.
  const lista = r.salida
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .sort((a, b) => a.number - b.number)
  for (const issue of lista) {
    if (issue.pull_request || !CON_PERMISO.includes(issue.author_association)) continue
    let tarea
    try {
      tarea = leerArchivo(archivoDeIssue(issue))
    } catch {
      continue
    }
    const paso = valor(tarea, 'paso')
    if (!paso || porPaso.has(paso)) continue
    const etiquetas = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name))
    porPaso.set(paso, {
      numero: issue.number,
      rama: valor(tarea, 'rama'),
      abierto: issue.state === 'open',
      etiquetas,
      tarea,
    })
  }
  return porPaso
}

/** Crea un issue `cola` con la spec y devuelve su número. */
function crearIssue(gh, github, texto, que) {
  const issue = issueDeArchivo(texto)
  exigir(
    issue.cuerpo.length < TOPE_DEL_CUERPO,
    `${que}: el cuerpo del issue tiene ${issue.cuerpo.length} caracteres (el tope es ${TOPE_DEL_CUERPO})`,
  )
  const r = gh(['api', '-X', 'POST', `repos/${github}/issues`, '--input', '-'], {
    input: JSON.stringify({ title: issue.titulo, body: issue.cuerpo, labels: ['cola'] }),
  })
  if (!r.ok) {
    try {
      fallo(r, `${que}: no pude crear el issue`)
    } catch (e) {
      throw new Problema(
        `${e instanceof Error ? e.message : String(e)}. Vuelve a correr: no duplica (busca por \`paso:\`)`,
      )
    }
  }
  return JSON.parse(r.salida).number
}

/** El cierre ya creado: si no arrancó, se le suman a su `depende` los pasos que falten (PATCH del cuerpo). */
function ponerAlDiaElCierre(gh, github, cierre, depende, avisos, nombre) {
  const actual = valor(cierre.tarea, 'depende').split(/\s+/).filter(Boolean)
  const faltan = depende.filter((d) => !actual.includes(d))
  if (!faltan.length) return
  if (!cierre.abierto || cierre.etiquetas.some((e) => ARRANCADA.includes(e))) {
    avisos.push(
      `${nombre} #${cierre.numero} (cierre) ya arrancó: su depende no se tocó (faltan ${faltan.join(' ')})`,
    )
    return
  }
  const campos = cierre.tarea.campos.map(([k, v]) =>
    k === 'depende' ? [k, [...actual, ...faltan].join(' ')] : [k, v],
  )
  if (!campos.some(([k]) => k === 'depende')) campos.push(['depende', faltan.join(' ')])
  const { cuerpo } = issueDeArchivo(canonico({ ...cierre.tarea, campos }))
  const r = gh(['api', '-X', 'PATCH', `repos/${github}/issues/${cierre.numero}`, '--input', '-'], {
    input: JSON.stringify({ body: cuerpo }),
  })
  if (!r.ok) fallo(r, `${nombre}: no pude poner al día el cierre #${cierre.numero}`)
  avisos.push(`${nombre} #${cierre.numero} (cierre): depende suma ${faltan.join(' ')}`)
}

/**
 * Carga la cola de los repos de `procesar`. `repos[rol]`: { github, version, pantallas, gh } de cada repo en construcción (los otros
 * se leen para la rama de una dependencia cruzada). Devuelve lo creado, lo que ya estaba, los avisos y, en seco, las specs.
 * @param {{ slug: string, roles: string[], planes: Record<string, any>, repos: Record<string, any>, registro: Map<string, any>,
 *   proveedorDe: (id: string) => string, procesar: string[], plantillaCierre: string, enSeco?: boolean, pausaMs?: number }} c
 */
export function cargarCola(c) {
  const { slug, roles, planes, repos, procesar } = c
  const existentes = Object.fromEntries(
    roles.map((rol) => [rol, issuesPorPaso(repos[rol].gh, repos[rol].github)]),
  )
  const numeros = new Map()
  const ramas = new Map()
  for (const rol of roles)
    for (const p of planes[rol]?.pasos ?? []) {
      const ya = existentes[rol].get(p.id)
      ramas.set(`${rol}:${p.id}`, ya?.rama || ramaDelPaso(p))
      if (ya) numeros.set(`${rol}:${p.id}`, ya.numero)
    }
  const out = { creados: [], yaEstaban: 0, avisos: [], specs: [] }
  let posts = 0
  const crear = (rol, texto, que) => {
    if (c.enSeco) {
      out.specs.push({ rol, que, issue: issueDeArchivo(texto) })
      return `(${que})`
    }
    if (posts++ > 0) dormir(c.pausaMs ?? 1000)
    return crearIssue(repos[rol].gh, repos[rol].github, texto, `${slug}-${rol} ${que}`)
  }
  for (const nodo of ordenDelProyecto(planes, roles)) {
    const [rol, pid] = nodo.split(':')
    if (!procesar.includes(rol)) continue
    if (numeros.has(nodo)) {
      out.yaEstaban++
      continue
    }
    const paso = planes[rol].pasos.find((p) => p.id === pid)
    const depende = (paso.depende_de ?? []).map((d) => {
      const n = nodoDe(rol, d)
      const [otro] = n.split(':')
      if (otro !== rol) return `${slug}-${otro}:${ramas.get(n)}`
      exigir(numeros.has(n), `${slug}-${rol} ${pid}: ${n} no tiene issue todavía`)
      return `T${numeros.get(n)}`
    })
    const texto = specDelPaso({
      slug,
      rol,
      paso,
      carril: planes[rol].carriles?.find((k) => k.id === paso.carril),
      registro: c.registro,
      pantallas: repos[rol].pantallas,
      versionSemilla: repos[rol].version,
      depende: depende.join(' '),
      proveedorDe: c.proveedorDe,
    })
    const numero = crear(rol, texto, pid)
    numeros.set(nodo, numero)
    out.creados.push({ rol, paso: pid, numero })
  }
  for (const rol of procesar) {
    const nombre = `${slug}-${rol}`
    const pasos = (planes[rol]?.pasos ?? []).map((p) => `T${numeros.get(`${rol}:${p.id}`)}`)
    const enElPlan = new Set((planes[rol]?.pasos ?? []).map((p) => p.id))
    for (const [paso, i] of existentes[rol])
      if (paso !== 'cierre' && !enElPlan.has(paso))
        out.avisos.push(`${nombre} #${i.numero} (paso ${paso}) ya no está en el plan: no se toca`)
    const cierre = existentes[rol].get('cierre')
    if (cierre) {
      if (!c.enSeco)
        ponerAlDiaElCierre(repos[rol].gh, repos[rol].github, cierre, pasos, out.avisos, nombre)
      out.yaEstaban++
      continue
    }
    const texto = specDelCierre(c.plantillaCierre, {
      repo: nombre,
      version: repos[rol].version,
      depende: pasos.join(' '),
    })
    out.creados.push({ rol, paso: 'cierre', numero: crear(rol, texto, 'cierre') })
  }
  return out
}
