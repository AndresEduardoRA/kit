// Una tarea de la cola en sus dos formas (scripts/orquestador/README.md › «La cola en los issues»):
//   - el archivo local `.orquestador/cola/T<n>-<tema>.md`: frontmatter `---` de `clave: valor` (lo que lee `campo` en orquestador.sh)
//     y las secciones de la spec;
//   - el issue <n> de GitHub con la etiqueta `cola`: un bloque ```yaml con los mismos campos (sin `id`) y después las secciones.
// `borrador` y `urgente` no van en el yaml: son las etiquetas `cola:borrador` y `cola:urgente`; en el archivo, `borrador: si` y
// `urgente: si`. Un `id` que no es T<n> (las specs de ../tareas traen `id: K06`) no es un id: queda como `origen: K06`.
//
// Todo lo de aquí es puro (texto adentro, texto afuera), salvo la CLI de abajo, que lee archivos y stdin para orquestador.sh.
// La forma canónica (`canonico`) es la que se compara y se guarda: dos formas que dicen lo mismo dan el mismo texto.
// Se prueba en `spec-issue.test.mjs`.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parse, stringify } from 'yaml'

export class SpecRota extends Error {}

const BANDERAS = ['borrador', 'urgente']
const CLAVE = /^[a-z][a-z0-9_]*$/
const RAMA = /^[a-z]+\/[a-z0-9][a-z0-9._/-]*$/
const ID = /^T[0-9]+$/

/**
 * El tema de una rama: sin el tipo, en kebab (`feat/cola-en-issues` → `cola-en-issues`). Va en el nombre del archivo. Puro.
 * @param {string} rama
 */
export function temaDeRama(rama) {
  const sinTipo = rama.includes('/') ? rama.slice(rama.indexOf('/') + 1) : rama
  return (
    sinTipo
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tarea'
  )
}

/**
 * Los campos y las banderas, ordenados como quedan: los campos en su orden, sin vacíos; `origen` si el id no era T<n>. Puro.
 * @param {[string, string][]} pares
 */
function normalizar(pares) {
  /** @type {[string, string][]} */
  const campos = []
  const banderas = { borrador: false, urgente: false }
  let id = ''
  let origen = ''
  for (const [k, v] of pares) {
    if (k === 'id') id = v
    else if (k === 'origen') origen = v
    else if (k === 'borrador' || k === 'urgente') banderas[k] = v === 'si'
    else if (v !== '' && !campos.some(([c]) => c === k)) campos.push([k, v])
  }
  if (!origen && id && !ID.test(id)) origen = id
  if (origen) campos.push(['origen', origen])
  return { id: ID.test(id) ? id : '', campos, ...banderas }
}

/**
 * Lee un archivo de la cola o de la entrada: el frontmatter como lo lee `campo` (la clave hasta el primer «:», el valor recortado;
 * las líneas `#` son comentarios) y el cuerpo. Puro.
 * @param {string} texto
 */
export function leerArchivo(texto) {
  const lineas = texto.replace(/\r\n/g, '\n').split('\n')
  if (lineas[0] !== '---') throw new SpecRota('no empieza con el frontmatter «---»')
  const fin = lineas.indexOf('---', 1)
  if (fin < 0) throw new SpecRota('el frontmatter no se cierra con «---»')
  /** @type {[string, string][]} */
  const pares = []
  for (const l of lineas.slice(1, fin)) {
    if (l.trimStart().startsWith('#')) continue
    const i = l.indexOf(':')
    if (i > 0) pares.push([l.slice(0, i).trim(), l.slice(i + 1).trim()])
  }
  return { ...normalizar(pares), cuerpo: limpiarCuerpo(lineas.slice(fin + 1).join('\n')) }
}

/** @param {string} c */
const limpiarCuerpo = (c) => c.replace(/^\s*\n/, '').replace(/\s+$/, '')

/**
 * La forma canónica de una tarea: el texto del archivo local. Puro.
 * @param {{ id: string, campos: [string, string][], cuerpo: string, borrador?: boolean, urgente?: boolean }} t
 */
export function canonico(t) {
  const fm = [`id: ${t.id}`, ...t.campos.map(([k, v]) => `${k}: ${v}`)]
  for (const b of BANDERAS) if (t[/** @type {'borrador' | 'urgente'} */ (b)]) fm.push(`${b}: si`)
  return `---\n${fm.join('\n')}\n---\n${t.cuerpo ? `\n${t.cuerpo}\n` : ''}`
}

/** @param {{ campos: [string, string][] }} t  @param {string} k */
const valor = (t, k) => t.campos.find(([c]) => c === k)?.[1] ?? ''

const NIVELES = ['rapido', 'normal', 'capaz']
const ALIAS_DE_MODELO = /^[a-z]+(\[1m\])?$/

/**
 * Lo que está mal en un campo de modelo de la spec, o '' (README.md › «Una tarea»): `nivel` y `nivel_plan` son rapido, normal o
 * capaz; `modelo` y `modelo_plan`, un alias (`sonnet`, `opus[1m]`), nunca una versión fija. Los textos son los de
 * `problema_de_modelo` en niveles.sh (niveles.test.ts los compara). Puro.
 * @param {string} clave  @param {string} v
 */
export function problemaDeModelo(clave, v) {
  if (!v) return ''
  if (clave === 'nivel' || clave === 'nivel_plan')
    return NIVELES.includes(v) ? '' : `«${clave}: ${v}» no es rapido, normal ni capaz`
  if (clave !== 'modelo' && clave !== 'modelo_plan') return ''
  if (ALIAS_DE_MODELO.test(v)) return ''
  const nivel = clave.replace('modelo', 'nivel')
  return /[0-9]/.test(v)
    ? `«${clave}: ${v}» es una versión fija de modelo: va «${nivel}: rapido|normal|capaz» (o un alias, como sonnet)`
    : `«${clave}: ${v}» no es un alias de modelo (minúsculas, como sonnet): va «${nivel}: rapido|normal|capaz»`
}

/** Lo que una spec puede pedir con `permite:` (README.md › «La tarea mensual de dependencias»): el orquestador corre sus sesiones con
 * `ORQ_PERMITE=<permite>` y el hook de Bash lo lee. Otra palabra deja la spec rota. */
export const PERMISOS = ['dependencias']

/** @param {{ campos: [string, string][] }} t */
function exigir(t) {
  if (!valor(t, 'titulo')) throw new SpecRota('falta «titulo»')
  const rama = valor(t, 'rama')
  if (!rama) throw new SpecRota('falta «rama»')
  if (!RAMA.test(rama))
    throw new SpecRota(`«rama: ${rama}» no es <tipo>/<tema> (minúsculas, números y guiones)`)
  for (const k of ['modelo', 'nivel', 'modelo_plan', 'nivel_plan']) {
    const problema = problemaDeModelo(k, valor(t, k))
    if (problema) throw new SpecRota(problema)
  }
  for (const p of valor(t, 'permite')
    .split(/[\s,]+/)
    .filter(Boolean))
    if (!PERMISOS.includes(p))
      throw new SpecRota(`«permite: ${p}» no es un permiso conocido (${PERMISOS.join(', ')})`)
}

/**
 * Un archivo, en canónico. Con `id`, ése (al darle número a uno de la entrada); sin él, el que traiga si es T<n>. Puro.
 * @param {string} texto  @param {string} [id]
 */
export function canonDeArchivo(texto, id) {
  const t = leerArchivo(texto)
  exigir(t)
  return canonico({ ...t, id: id ?? t.id })
}

/**
 * Lo que va al issue desde un archivo: título, cuerpo (el bloque yaml y las secciones) y las banderas que son etiquetas. Puro.
 * @param {string} texto
 */
export function issueDeArchivo(texto) {
  const t = leerArchivo(texto)
  exigir(t)
  const yaml = stringify(Object.fromEntries(t.campos), { lineWidth: 0 })
  return {
    titulo: valor(t, 'titulo'),
    rama: valor(t, 'rama'),
    cuerpo: `\`\`\`yaml\n${yaml}\`\`\`\n${t.cuerpo ? `\n${t.cuerpo}\n` : ''}`,
    borrador: t.borrador,
    urgente: t.urgente,
  }
}

/**
 * Un valor del yaml del issue como texto de una línea, o el error. Puro.
 * @param {string} k  @param {unknown} v
 */
function aTexto(k, v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'si' : 'no'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') {
    if (v.includes('\n')) throw new SpecRota(`«${k}» tiene más de una línea`)
    return v.trim()
  }
  if (Array.isArray(v) && v.every((x) => ['string', 'number'].includes(typeof x)))
    return v.map(String).join(' ')
  throw new SpecRota(`«${k}» no es un texto (ni una lista de textos)`)
}

/**
 * Un issue (como lo da la API) en canónico, o `SpecRota` con lo que está mal del bloque yaml. Puro.
 * @param {{ number: number, title?: string, body?: string | null, labels?: (string | { name: string })[] }} issue
 */
export function archivoDeIssue(issue) {
  const texto = (issue.body ?? '').replace(/\r\n/g, '\n')
  const m = /^\s*```ya?ml[ \t]*\n([\s\S]*?)\n?```[ \t]*(?:\n|$)/.exec(texto)
  if (!m) throw new SpecRota('el cuerpo no empieza con un bloque ```yaml cerrado con ```')
  let datos
  try {
    datos = parse(m[1] ?? '')
  } catch (e) {
    throw new SpecRota(
      `el yaml no se puede leer: ${e instanceof Error ? (e.message.split('\n')[0] ?? '') : String(e)}`,
    )
  }
  if (datos === null || typeof datos !== 'object' || Array.isArray(datos))
    throw new SpecRota('el bloque yaml no es una lista de «clave: valor»')
  /** @type {[string, string][]} */
  const pares = []
  for (const [k, v] of Object.entries(datos)) {
    if (!CLAVE.test(k))
      throw new SpecRota(`«${k}» no sirve como clave (minúsculas y guiones bajos)`)
    if (!BANDERAS.includes(k)) pares.push([k, aTexto(k, v)])
  }
  const etiquetas = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name))
  const t = normalizar(pares)
  if (!valor(t, 'titulo') && issue.title?.trim()) t.campos.unshift(['titulo', issue.title.trim()])
  exigir(t)
  return canonico({
    ...t,
    id: `T${issue.number}`,
    cuerpo: limpiarCuerpo(texto.slice(m[0].length)),
    borrador: etiquetas.includes('cola:borrador'),
    urgente: etiquetas.includes('cola:urgente'),
  })
}

/**
 * El cuerpo del issue con la respuesta de la persona al final de «Decisiones ya tomadas» (la sección se crea si falta). Puro.
 * @param {string} cuerpo  @param {string} fecha  AAAA-MM-DD  @param {string} respuesta
 */
export function agregarDecision(cuerpo, fecha, respuesta) {
  const linea = `- Respuesta de la persona (${fecha}): ${respuesta.trim().replace(/\s*\n\s*/g, ' ')}`
  const lineas = cuerpo.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n')
  const ini = lineas.findIndex((l) => /^##\s+Decisiones ya tomadas\s*$/.test(l))
  if (ini < 0) return `${lineas.join('\n')}\n\n## Decisiones ya tomadas\n\n${linea}\n`
  let fin = lineas.findIndex((l, i) => i > ini && /^#{1,2}\s/.test(l))
  if (fin < 0) fin = lineas.length
  let ultima = fin - 1
  while (ultima > ini && !lineas[ultima]?.trim()) ultima--
  lineas.splice(ultima + 1, 0, ...(ultima === ini ? ['', linea] : [linea]))
  return `${lineas.join('\n')}\n`
}

// ---------- la CLI, para orquestador.sh ----------
//
//   node spec-issue.mjs canon <archivo> [T<n>]     el archivo en canónico (con ese id, si se da)
//   node spec-issue.mjs a-issue <archivo>          JSON {titulo, rama, cuerpo, borrador, urgente} para crear o editar el issue
//   node spec-issue.mjs de-issue < issue.json      el archivo canónico de un issue de la API
//   node spec-issue.mjs decision <fecha> <respuesta.md> < cuerpo   el cuerpo con la respuesta en «Decisiones ya tomadas»
//   node spec-issue.mjs tema <rama>
// Una spec rota sale con 3 y el motivo por stderr; un uso mal escrito, con 64.
function principal([orden, a, b]) {
  const stdin = () => readFileSync(0, 'utf8')
  try {
    if (orden === 'canon' && a) process.stdout.write(canonDeArchivo(readFileSync(a, 'utf8'), b))
    else if (orden === 'a-issue' && a)
      process.stdout.write(JSON.stringify(issueDeArchivo(readFileSync(a, 'utf8'))))
    else if (orden === 'de-issue') process.stdout.write(archivoDeIssue(JSON.parse(stdin())))
    else if (orden === 'decision' && a && b)
      process.stdout.write(agregarDecision(stdin(), a, readFileSync(b, 'utf8')))
    else if (orden === 'tema' && a) console.log(temaDeRama(a))
    else {
      console.error('uso: node spec-issue.mjs canon|a-issue|de-issue|decision|tema …')
      process.exit(64)
    }
  } catch (e) {
    if (!(e instanceof SpecRota)) throw e
    console.error(e.message)
    process.exit(3)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  principal(process.argv.slice(2))
