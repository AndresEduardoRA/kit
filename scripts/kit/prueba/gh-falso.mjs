#!/usr/bin/env node
// Un GitHub falso de varios repos para las pruebas de publicar-proyecto.mjs. Se instala como `gh` en el PATH (`instalarGhFalso`) y
// guarda su estado en `$GH_FALSO/estado.json` y cada llamada en `$GH_FALSO/llamadas.log` (una línea JSON: args, cwd, token, input).
//
// Entiende lo que usan github.mjs, cola.mjs y `asegurar_etiquetas` (scripts/orquestador/github.sh):
//   gh auth token --user <cuenta>        gh repo create <c>/<r> --public|--private --description <d>
//   gh api [-X M] [--paginate] [--jq '.[]' | '.[].name'] <ruta> [-f k=v]… [--input -]
//     repos/<c>/<r> (GET, PATCH) · …/labels (GET, POST) · …/issues (GET con state y labels, POST) · …/issues/<n> (PATCH)
//     user · orgs/<c> · …/commits/main/check-runs · …/branches/main/protection (PUT)
//   `{owner}/{repo}` sale de `git remote get-url origin` de la carpeta.
// Fallas a pedido en el estado: `fallaEnPost: n` (el POST de issue número n falla), `limite: true`, `sinRed: true`, `sinSesion: [c]`.
import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Deja un `gh` que corre este archivo en `<dir>/bin` y el estado inicial; devuelve el entorno para correr con él. */
export function instalarGhFalso(dir, estado = {}) {
  mkdirSync(join(dir, 'bin'), { recursive: true })
  const gh = join(dir, 'bin', 'gh')
  writeFileSync(gh, `#!/bin/sh\nexec node ${JSON.stringify(fileURLToPath(import.meta.url))} "$@"\n`)
  chmodSync(gh, 0o755)
  writeFileSync(
    join(dir, 'estado.json'),
    JSON.stringify({ repos: {}, posts: 0, ...estado }, null, 2),
  )
  return { ...process.env, GH_FALSO: dir, PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}` }
}

/** El estado y las llamadas, para que la prueba mire. */
export const leerEstado = (dir) => JSON.parse(readFileSync(join(dir, 'estado.json'), 'utf8'))
export const llamadas = (dir) => {
  try {
    return readFileSync(join(dir, 'llamadas.log'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

class Salida extends Error {
  constructor(codigo, texto) {
    super(texto)
    this.codigo = codigo
  }
}
const no = (texto, codigo = 1) => {
  throw new Salida(codigo, texto)
}
const nuevoRepo = (extra = {}) => ({
  private: false,
  description: '',
  ajustes: {},
  labels: [],
  issues: [],
  siguiente: 1,
  checks: [],
  proteccion: null,
  ...extra,
})

function opciones(args) {
  const o = { metodo: 'GET', campos: {}, paginar: false, jq: null, input: false, ruta: '' }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-X' || a === '--method') o.metodo = args[++i]
    else if (a === '--paginate') o.paginar = true
    else if (a === '--jq' || a === '-q') o.jq = args[++i]
    else if (a === '--input') o.input = args[++i] === '-'
    else if (a === '-f' || a === '-F' || a === '--raw-field' || a === '--field') {
      const [k, ...v] = String(args[++i]).split('=')
      o.campos[k] = v.join('=')
    } else if (a === '-H') i++
    else if (!o.ruta) o.ruta = a
  }
  if (o.metodo === 'GET' && Object.keys(o.campos).length) o.metodo = 'POST'
  return o
}

function conJq(datos, jq) {
  if (!jq) return `${JSON.stringify(datos)}\n`
  if (jq === '.[]') return datos.map((x) => `${JSON.stringify(x)}\n`).join('')
  if (jq === '.[].name') return datos.map((x) => `${x.name}\n`).join('')
  return no(`jq no soportado en el gh falso: ${jq}`)
}

function api(estado, args, entrada) {
  const o = opciones(args)
  if (estado.sinRed) no('error connecting to api.github.com')
  if (estado.limite) no('gh: API rate limit exceeded for user (HTTP 403)')
  let ruta = o.ruta.replace(/^\//, '')
  if (ruta.includes('{owner}/{repo}')) {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
    ruta = ruta.replace(
      '{owner}/{repo}',
      url.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, ''),
    )
  }
  const [camino, consulta = ''] = ruta.split('?')
  const q = new URLSearchParams(consulta)
  const cuerpo = o.input ? JSON.parse(entrada || '{}') : o.campos
  if (camino === 'user') {
    const cuenta = String(process.env.GH_TOKEN ?? '').replace(/^token-falso-/, '')
    return { login: cuenta, plan: { name: estado.cuentas?.[cuenta]?.plan ?? 'free' } }
  }
  const org = /^orgs\/([^/]+)$/.exec(camino)
  if (org)
    return estado.cuentas?.[org[1]]?.org
      ? { plan: { name: estado.cuentas[org[1]].plan } }
      : no('gh: Not Found (HTTP 404)')
  const m = /^repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(camino)
  if (!m) return no(`ruta no soportada en el gh falso: ${camino}`)
  const repo = estado.repos[m[1]] ?? no('gh: Not Found (HTTP 404)')
  const resto = m[2] ?? ''
  const k = `${o.metodo} ${resto.replace(/\/\d+$/, '/<n>')}`
  if (k === 'GET ') return { full_name: m[1], private: repo.private, ...repo.ajustes }
  if (k === 'PATCH ') return Object.assign(repo.ajustes, cuerpo)
  if (k === 'GET /labels') return repo.labels
  if (k === 'POST /labels') return repo.labels.push(cuerpo) && cuerpo
  if (k === 'GET /issues')
    return repo.issues.filter(
      (i) =>
        (q.get('state') === 'all' || i.state === (q.get('state') ?? 'open')) &&
        (!q.get('labels') || i.labels.some((l) => l.name === q.get('labels'))),
    )
  if (k === 'POST /issues') {
    estado.posts = (estado.posts ?? 0) + 1
    if (estado.fallaEnPost && estado.posts === estado.fallaEnPost) no('gh: Server Error (HTTP 502)')
    const issue = {
      number: repo.siguiente++,
      title: cuerpo.title,
      body: cuerpo.body,
      labels: (cuerpo.labels ?? []).map((name) => ({ name })),
      state: 'open',
      author_association: 'OWNER',
    }
    repo.issues.push(issue)
    return issue
  }
  if (k === 'PATCH /issues/<n>') {
    const issue = repo.issues.find((i) => i.number === Number(resto.split('/').pop()))
    return issue ? Object.assign(issue, cuerpo) : no('gh: Not Found (HTTP 404)')
  }
  if (k === 'GET /commits/main/check-runs')
    return {
      check_runs: repo.checks.filter((c) => !q.get('check_name') || c.name === q.get('check_name')),
    }
  if (k === 'PUT /branches/main/protection') return (repo.proteccion = cuerpo)
  return no(`ruta no soportada en el gh falso: ${k}`)
}

function correr(estado, args, entrada) {
  const [a, b] = args
  if (a === 'auth' && b === 'token') {
    const cuenta = args[args.indexOf('--user') + 1] ?? ''
    if ((estado.sinSesion ?? []).includes(cuenta))
      no(`no oauth token found for github.com account ${cuenta}`)
    return `token-falso-${cuenta}\n`
  }
  if (a === 'repo' && b === 'create') {
    const nombre = args[2] ?? ''
    if (estado.repos[nombre]) no('GraphQL: Name already exists on this account (createRepository)')
    const d = args.indexOf('--description')
    estado.repos[nombre] = nuevoRepo({
      private: args.includes('--private'),
      description: d >= 0 ? args[d + 1] : '',
    })
    return `https://github.com/${nombre}\n`
  }
  if (a === 'api') return conJq(api(estado, args.slice(1), entrada), opciones(args.slice(1)).jq)
  return no(`orden no soportada en el gh falso: ${args.join(' ')}`)
}

function principal(args) {
  const dir = process.env.GH_FALSO ?? no('falta GH_FALSO')
  const estado = JSON.parse(readFileSync(join(dir, 'estado.json'), 'utf8'))
  const entrada = args.includes('--input') ? readFileSync(0, 'utf8') : ''
  appendFileSync(
    join(dir, 'llamadas.log'),
    `${JSON.stringify({ args, cwd: process.cwd(), token: process.env.GH_TOKEN ?? '', input: entrada })}\n`,
  )
  try {
    process.stdout.write(correr(estado, args, entrada))
    writeFileSync(join(dir, 'estado.json'), JSON.stringify(estado, null, 2))
  } catch (e) {
    if (!(e instanceof Salida)) throw e
    writeFileSync(join(dir, 'estado.json'), JSON.stringify(estado, null, 2))
    process.stderr.write(`${e.message}\n`)
    process.exit(e.codigo)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  principal(process.argv.slice(2))
export { nuevoRepo }
