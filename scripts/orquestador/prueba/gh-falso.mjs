// Un `gh` falso para las pruebas del orquestador (cola-github.test.ts): lo que el orquestador le pide a GitHub, contra un «GitHub»
// que vive en `$GH_FALSO/estado.json`. Cada llamada queda en `$GH_FALSO/llamadas.log` (una línea JSON con sus argumentos y el
// GH_TOKEN con que se hizo). Con `sinRed` falla como sin red; con `limite`, como el límite de la API; con `issueEditFalla`,
// `gh issue edit` falla como en los repos donde GraphQL choca con los proyectos clásicos (y el orquestador cae a la API REST).
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.env['GH_FALSO'] ?? ''
const ruta = join(dir, 'estado.json')
const e = JSON.parse(readFileSync(ruta, 'utf8'))
const args = process.argv.slice(2)
appendFileSync(
  join(dir, 'llamadas.log'),
  `${JSON.stringify({ args, token: process.env['GH_TOKEN'] ?? '' })}\n`,
)

const guardar = () => writeFileSync(ruta, JSON.stringify(e, null, 2))
/** @param {number} codigo  @param {string} [error] */
function salir(codigo, error) {
  if (error) process.stderr.write(`${error}\n`)
  process.exit(codigo)
}
/** @param {string} bandera */
const valor = (bandera) => {
  const i = args.indexOf(bandera)
  return i >= 0 ? args[i + 1] : undefined
}
/** @param {unknown} datos */
function imprimir(datos) {
  const jq = valor('--jq')
  const texto = JSON.stringify(datos)
  if (!jq) return void process.stdout.write(`${texto}\n`)
  process.stdout.write(spawnSync('jq', ['-r', jq], { input: texto, encoding: 'utf8' }).stdout)
}
const ahora = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')
/** @param {any} i */
const issueDeApi = (i) => ({
  number: i.number,
  title: i.title,
  body: i.body,
  state: i.state,
  state_reason: i.state_reason ?? null,
  author_association: i.autor ?? 'OWNER',
  labels: i.labels.map((/** @type {string} */ name) => ({ name })),
})
/** @param {string} n */
const issue = (n) => e.issues[n] ?? salir(1, `HTTP 404: Not Found (issue ${n})`)

if (args[0] === 'auth' && args[1] === 'token') {
  const u = valor('--user') ?? ''
  if ((e.cuentas ?? []).includes(u)) salir(0, void process.stdout.write(`tok-${u}\n`))
  salir(1, `no oauth token found for ${u}`)
}
if (e.sinRed) salir(1, 'error connecting to api.github.com')
if (e.limite) salir(1, 'HTTP 403: API rate limit exceeded for user ID 1.')

if (args[0] === 'api') {
  let metodo = 'GET'
  let camino = ''
  /** @type {Record<string, any>} */
  const campos = {}
  for (let i = 1; i < args.length; i++) {
    const a = args[i] ?? ''
    if (a === '-X') metodo = args[++i] ?? 'GET'
    else if (a === '-f' || a === '-F') {
      const par = args[++i] ?? ''
      const k = par.slice(0, par.indexOf('='))
      let v = par.slice(par.indexOf('=') + 1)
      if (a === '-F' && v.startsWith('@')) v = readFileSync(v.slice(1), 'utf8')
      if (k.endsWith('[]')) (campos[k.slice(0, -2)] ??= []).push(v)
      else campos[k] = v
    } else if (a === '--jq' || a === '-H') i++
    else if (!a.startsWith('-')) camino = a
  }
  const [base, consulta = ''] = camino.split('?')
  const q = new URLSearchParams(consulta)
  const resto = (base ?? '').replace(/^repos\/[^/]+\/[^/]+\/?/, '')
  let m
  if (resto === 'labels' && metodo === 'GET') imprimir(e.etiquetas.map((name) => ({ name })))
  else if (resto === 'labels' && metodo === 'POST') {
    e.etiquetas.push(campos['name'])
    guardar()
    imprimir({ name: campos['name'] })
  } else if (resto === 'issues' && metodo === 'GET') {
    const quiere = (q.get('labels') ?? '').split(',').filter(Boolean)
    const estado = q.get('state') ?? 'open'
    imprimir(
      Object.values(e.issues)
        .filter((/** @type {any} */ i) => estado === 'all' || i.state === estado)
        .filter((/** @type {any} */ i) => quiere.every((l) => i.labels.includes(l)))
        .map(issueDeApi),
    )
  } else if (resto === 'issues' && metodo === 'POST') {
    const n = e.siguiente++
    e.issues[n] = {
      number: n,
      title: campos['title'],
      body: campos['body'],
      labels: campos['labels'] ?? [],
      state: 'open',
      comentarios: [],
    }
    guardar()
    imprimir(issueDeApi(e.issues[n]))
  } else if ((m = /^issues\/(\d+)$/.exec(resto))) {
    const i = issue(m[1] ?? '')
    if (metodo === 'PATCH') {
      for (const k of ['title', 'body', 'state', 'state_reason']) if (k in campos) i[k] = campos[k]
      if ('labels' in campos) i.labels = campos['labels']
      guardar()
    }
    imprimir(issueDeApi(i))
  } else if ((m = /^issues\/(\d+)\/comments$/.exec(resto))) {
    const i = issue(m[1] ?? '')
    if (metodo === 'POST') {
      const c = {
        id: e.siguienteComentario++,
        body: campos['body'],
        created_at: ahora(),
        author_association: 'OWNER',
      }
      i.comentarios.push(c)
      guardar()
      imprimir(c)
    } else imprimir(i.comentarios)
  } else salir(2, `gh falso: no conozco la API ${metodo} ${camino}`)
} else if (args[0] === 'issue' && args[1] === 'edit') {
  if (e.issueEditFalla)
    salir(
      1,
      'GraphQL: Projects (classic) is being deprecated in favor of the new Projects experience',
    )
  const i = issue(args[2] ?? '')
  for (let k = 3; k < args.length; k++) {
    const a = args[k]
    const v = args[++k] ?? ''
    if (a === '--title') i.title = v
    else if (a === '--body-file') i.body = readFileSync(v, 'utf8')
    else if (a === '--add-label')
      for (const l of v.split(','))
        if (!i.labels.includes(l)) i.labels.push(l)
        else if (a === '--remove-label')
          i.labels = i.labels.filter((/** @type {string} */ l) => !v.split(',').includes(l))
  }
  guardar()
} else if (args[0] === 'pr' && args[1] === 'list') {
  const repo = valor('-R') ?? e.repo
  const rama = valor('--head')
  imprimir(
    (e.prs[repo] ?? [])
      .filter((/** @type {any} */ p) => p.rama === rama && p.estado === 'MERGED')
      .map((/** @type {any} */ p) => ({ number: p.number })),
  )
} else if (args[0] === 'pr' && args[1] === 'view') {
  const p = (e.prs[e.repo] ?? []).find((/** @type {any} */ x) => String(x.number) === args[2])
  if (!p) salir(1, `no pull requests found (${args[2]})`)
  imprimir({ state: p.estado })
} else salir(2, `gh falso: no conozco «gh ${args.join(' ')}»`)
