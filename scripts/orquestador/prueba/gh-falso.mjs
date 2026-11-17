// Un `gh` falso para las pruebas del orquestador (cola-github.test.ts) y del aviso de la noche (scripts/flujo/noche-gh.test.ts): lo que
// le piden a GitHub, contra un «GitHub»
// que vive en `$GH_FALSO/estado.json`. Cada llamada queda en `$GH_FALSO/llamadas.log` (una línea JSON con sus argumentos y el
// GH_TOKEN con que se hizo). Con `sinRed` falla como sin red; con `limite`, como el límite de la API; con `issueEditFalla`,
// `gh issue edit` falla como en los repos donde GraphQL choca con los proyectos clásicos (y el orquestador cae a la API REST).
// Lo de una tarea con `al_integrar` (al-integrar.test.ts) y del guion del cierre (scripts/flujo/cierre.mjs): un PR de `prs` puede
// traer `sha` (su squash), `padre`, `titulo` y `cuerpo`; las etiquetas viven en `refs` (`{ ref, sha }`), y con `refsFalla` crearlas
// falla con ese texto.
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
  user: { login: i.login ?? 'persona', type: i.tipo ?? 'User' },
  created_at: i.created_at ?? ahora(),
  labels: i.labels.map((/** @type {string} */ name) => ({ name })),
})
/** @param {string} repo  @param {(p: any) => boolean} f */
const prDe = (repo, f) => (e.prs[repo] ?? []).find(f)
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
      created_at: ahora(),
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
      // Lo comenta la cuenta dueña (el token del orquestador o la persona).
      const c = {
        id: e.siguienteComentario++,
        body: campos['body'],
        created_at: ahora(),
        author_association: 'OWNER',
        user: { login: 'persona', type: 'User' },
      }
      i.comentarios.push(c)
      guardar()
      imprimir(c)
    } else imprimir(i.comentarios)
  } else if ((m = /^pulls\/(\d+)$/.exec(resto)) && metodo === 'GET') {
    const p =
      prDe(e.repo, (x) => String(x.number) === m?.[1]) ??
      salir(1, `HTTP 404: Not Found (pulls/${m[1]})`)
    imprimir({
      number: p.number,
      merged: p.estado === 'MERGED',
      merge_commit_sha: p.sha ?? null,
      state: p.estado === 'OPEN' ? 'open' : 'closed',
    })
  } else if ((m = /^commits\/([0-9a-f]+)$/.exec(resto)) && metodo === 'GET') {
    const p =
      prDe(e.repo, (x) => x.sha === m?.[1]) ?? salir(1, `HTTP 404: Not Found (commits/${m[1]})`)
    imprimir({ sha: p.sha, parents: p.padre ? [{ sha: p.padre }] : [] })
  } else if ((m = /^git\/matching-refs\/(tags\/.*)$/.exec(resto)) && metodo === 'GET') {
    const prefijo = `refs/${m[1]}`
    imprimir(
      (e.refs ?? [])
        .filter((/** @type {any} */ r) => r.ref.startsWith(prefijo))
        .map((/** @type {any} */ r) => ({ ref: r.ref, object: { sha: r.sha, type: 'commit' } })),
    )
  } else if (resto === 'git/refs' && metodo === 'POST') {
    if (e.refsFalla) salir(1, e.refsFalla)
    if ((e.refs ?? []).some((/** @type {any} */ r) => r.ref === campos['ref']))
      salir(1, 'HTTP 422: Reference already exists')
    ;(e.refs ??= []).push({ ref: campos['ref'], sha: campos['sha'] })
    guardar()
    imprimir({ ref: campos['ref'], object: { sha: campos['sha'], type: 'commit' } })
  } else if ((m = /^actions\/runs\/(\d+)\/jobs$/.exec(resto))) {
    // Los jobs de una corrida (el aviso de la noche, sin artefactos): `corridas` en el estado; sin ella, como una API que falla.
    const jobs = e.corridas?.[m[1] ?? '']
    if (!jobs) salir(1, `HTTP 404: Not Found (actions/runs/${m[1]}/jobs)`)
    imprimir({ total_count: jobs.length, jobs })
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
} else if (args[0] === 'pr' && args[1] === 'list' && !args.includes('--head')) {
  // Sin rama: los PR del repo por estado (el guion del cierre lee los integrados con su título y su cuerpo).
  const estado = (valor('--state') ?? 'open').toUpperCase()
  imprimir(
    (e.prs[valor('-R') ?? e.repo] ?? [])
      .filter((/** @type {any} */ p) => estado === 'ALL' || p.estado === estado)
      .map((/** @type {any} */ p) => ({
        number: p.number,
        title: p.titulo ?? '',
        body: p.cuerpo ?? '',
        headRefName: p.rama,
      })),
  )
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
