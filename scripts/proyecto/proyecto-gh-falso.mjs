#!/usr/bin/env node
// Un `gh` falso de varios repos de cuentas distintas para `proyecto.test.mjs`. Se instala como `gh` en el PATH (`instalarGh`); su estado
// vive en `$GH_FALSO/estado.json` y cada llamada, en `$GH_FALSO/llamadas.log` (una línea JSON: args, token, entrada).
//
//   gh auth token --user <cuenta>     imprime `token-<cuenta>` si la cuenta está en `cuentas`; si no, falla
//   gh api [-X M] [-H h] [-f k=v] [--input -] <ruta>   (la ruta puede traer `?query`)
//     repos/<c>/<r>/pulls · …/commits/<sha>/check-runs · …/actions/workflows/ci.yml/runs · …/issues (GET y POST) · …/contents/<ruta>
//     search/issues
// El token de la llamada tiene que ser el de la cuenta dueña del repo: con otro, 404 (como GitHub con un repo privado ajeno).
// Por repo en `repos["c/r"]`: pulls, checks {sha: conclusión}, runs {push, schedule}, issues [{number,title,labels,pull_request?}],
// contents (texto de la copia), retro [{number,title,body,closed_at}], sinRed, sinWorkflow. Lo creado va a `creados`.
import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Deja el `gh` en `<dir>/bin` y el estado; devuelve el PATH que lo trae. */
export function instalarGh(dir, estado) {
  mkdirSync(join(dir, 'bin'), { recursive: true })
  const gh = join(dir, 'bin', 'gh')
  writeFileSync(gh, `#!/bin/sh\nexec node ${JSON.stringify(fileURLToPath(import.meta.url))} "$@"\n`)
  chmodSync(gh, 0o755)
  writeFileSync(
    join(dir, 'estado.json'),
    JSON.stringify({ cuentas: [], repos: {}, ...estado }, null, 2),
  )
  return { GH_FALSO: dir, PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}` }
}
export const leerEstado = (dir) => JSON.parse(readFileSync(join(dir, 'estado.json'), 'utf8'))

const falla = (texto) => {
  process.stderr.write(`${texto}\n`)
  process.exit(1)
}

function principal(args) {
  const dir = process.env.GH_FALSO ?? falla('falta GH_FALSO')
  const estado = leerEstado(dir)
  if (args[0] === 'auth') {
    const cuenta = args[args.indexOf('--user') + 1]
    if (!estado.cuentas.includes(cuenta)) falla('no oauth token found')
    return console.log(`token-${cuenta}`)
  }
  let entrada = ''
  let ruta = ''
  let metodo = 'GET'
  const campos = {}
  for (let i = 1; i < args.length; i++) {
    const a = args[i]
    if (a === '-X') metodo = args[++i]
    else if (a === '-H') i++
    else if (a === '-f') {
      const [k, ...v] = args[++i].split('=')
      campos[k] = v.join('=')
    } else if (a === '--input') {
      i++
      entrada = readFileSync(0, 'utf8')
    } else ruta = a
  }
  appendFileSync(
    join(dir, 'llamadas.log'),
    `${JSON.stringify({ args: args.slice(1), token: process.env.GH_TOKEN, entrada })}\n`,
  )
  const [camino, consulta = ''] = ruta.split('?')
  const q = new URLSearchParams(consulta)
  if (camino === 'search/issues') {
    const repo = /repo:(\S+)/.exec(campos.q ?? '')?.[1] ?? ''
    const r = estado.repos[repo] ?? falla('gh: Not Found (HTTP 404)')
    return console.log(JSON.stringify({ items: r.retro ?? [] }))
  }
  const m = /^repos\/([^/]+\/[^/]+)\/(.*)$/.exec(camino) ?? falla(`ruta no soportada: ${camino}`)
  const repo = estado.repos[m[1]]
  if (!repo || process.env.GH_TOKEN !== `token-${m[1].split('/')[0]}`)
    falla('gh: Not Found (HTTP 404)')
  if (repo.sinRed) falla('error connecting to api.github.com')
  const resto = m[2]
  if (resto === 'pulls') return console.log(JSON.stringify(repo.pulls ?? []))
  let x
  if ((x = /^commits\/([^/]+)\/check-runs$/.exec(resto)))
    return console.log(
      JSON.stringify({
        check_runs: [
          { name: 'otro', conclusion: 'success' },
          { name: 'Listo · todo en verde', conclusion: repo.checks?.[x[1]] ?? null },
        ],
      }),
    )
  if ((x = /^actions\/workflows\/ci\.yml\/runs$/.exec(resto))) {
    if (repo.sinWorkflow) falla('gh: Not Found (HTTP 404)')
    const run = repo.runs?.[q.get('event')]
    return console.log(JSON.stringify({ workflow_runs: run ? [run] : [] }))
  }
  if (resto === 'issues' && metodo === 'POST') {
    const c = JSON.parse(entrada)
    const issue = {
      number: 100 + (repo.creados?.length ?? 0),
      title: c.title,
      body: c.body,
      labels: (c.labels ?? []).map((name) => ({ name })),
    }
    repo.creados = [...(repo.creados ?? []), issue]
    repo.issues = [...(repo.issues ?? []), issue]
    writeFileSync(join(dir, 'estado.json'), JSON.stringify(estado, null, 2))
    return console.log(JSON.stringify(issue))
  }
  if (resto === 'issues') {
    const etiqueta = q.get('labels')
    return console.log(
      JSON.stringify(
        (repo.issues ?? []).filter(
          (i) => !etiqueta || i.labels.some((l) => (l.name ?? l) === etiqueta),
        ),
      ),
    )
  }
  if (resto.startsWith('contents/')) {
    if (repo.contents === undefined) falla('gh: Not Found (HTTP 404)')
    return process.stdout.write(repo.contents)
  }
  falla(`ruta no soportada: ${resto}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  principal(process.argv.slice(2))
