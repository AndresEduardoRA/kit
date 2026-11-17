// GitHub para semilla-a-repo: crear el repo, ajustarlo como calesa-app, su remoto, las etiquetas de la cola, los secretos antes de
// publicar y la protección de main. Cada llamada va con `GH_TOKEN` de la cuenta dueña (`gh auth token --user <cuenta>`): nunca se
// cambia la cuenta activa de gh (lección de dos cuentas). Lo usa publicar-proyecto.mjs; se prueba con un gh falso en
// `publicar-proyecto.test.mjs`.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exigir, Problema } from './problema.mjs'
import { secretosEn } from './secretos.mjs'

export const CHECK = 'Listo · todo en verde'
// Los de calesa-app (`gh api repos/AndresEduardoRA/calesa-app`, leídos el 2026-11-17): sólo squash, con el título y el cuerpo del
// PR, auto-merge y borrar la rama al integrar.
export const AJUSTES = {
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  allow_auto_merge: true,
  delete_branch_on_merge: true,
  squash_merge_commit_title: 'PR_TITLE',
  squash_merge_commit_message: 'PR_BODY',
}
// La protección de main de calesa-app (leída el mismo día): el check que resume el CI, sobre la rama al día con main (strict); un PR
// para entrar, sin aprobaciones (las da el CI); historia lineal; ni forzar ni borrar; la persona, como administradora, puede saltarla.
export const PROTECCION = {
  required_status_checks: { strict: true, checks: [{ context: CHECK }] },
  enforce_admins: false,
  required_pull_request_reviews: {
    dismiss_stale_reviews: false,
    require_code_owner_reviews: false,
    require_last_push_approval: false,
    required_approving_review_count: 0,
  },
  restrictions: null,
  required_linear_history: true,
  allow_force_pushes: false,
  allow_deletions: false,
}

/** Qué fue mal en una llamada a gh, por su stderr: el límite de la API, la red, un 404 u otra cosa. Puro. */
export function errorDeGh(stderr) {
  if (/rate limit|secondary rate|abuse detection/i.test(stderr)) return 'limite'
  if (/error connecting|could not resolve host|network is unreachable|timeout/i.test(stderr))
    return 'sin red'
  if (/HTTP 404|Not Found/.test(stderr)) return '404'
  return 'otro'
}

/**
 * Un cliente de gh con el token de `cuenta`: `gh(args, { input, cwd })` → `{ ok, salida, error, tipo }`. Sin sesión de esa cuenta
 * se niega diciendo cómo entrar.
 */
export function clienteGh(cuenta) {
  const t = spawnSync('gh', ['auth', 'token', '--user', cuenta], { encoding: 'utf8' })
  exigir(t.status === 0 && t.stdout.trim(), `gh no tiene sesión de ${cuenta}: \`gh auth login\``)
  const token = t.stdout.trim()
  const gh = (args, { input, cwd } = {}) => {
    const r = spawnSync('gh', args, {
      encoding: 'utf8',
      input,
      cwd,
      env: { ...process.env, GH_TOKEN: token },
    })
    const error = (r.stderr ?? '').trim()
    return {
      ok: r.status === 0,
      salida: r.stdout ?? '',
      error,
      tipo: r.status === 0 ? '' : errorDeGh(error),
    }
  }
  gh.token = token
  return gh
}

/** Lanza el error de una llamada que falló, con lo que hay que hacer si es el límite o la red. */
export function fallo(r, que) {
  if (r.tipo === 'limite')
    throw new Problema(
      `${que}: límite de la API de GitHub. Vuelve a correr más tarde: lo hecho no se repite`,
    )
  if (r.tipo === 'sin red') throw new Problema(`${que}: sin red (${r.error.split('\n')[0]})`)
  throw new Problema(`${que}: ${r.error.split('\n')[0] || 'gh falló'}`)
}

/** Si el repo existe en GitHub. */
export function existeRepo(gh, github) {
  const r = gh(['api', `repos/${github}`])
  if (r.ok) return true
  if (r.tipo === '404') return false
  return fallo(r, `no pude leer ${github}`)
}

/** El plan de GitHub de la cuenta (free, pro, team…): el del usuario si es la cuenta del token; si no, el de la organización. */
export function planDeLaCuenta(gh, cuenta) {
  const yo = gh(['api', 'user'])
  if (!yo.ok) fallo(yo, 'no pude leer la cuenta')
  const u = JSON.parse(yo.salida)
  if (u.login === cuenta) return String(u.plan?.name ?? 'free')
  const org = gh(['api', `orgs/${cuenta}`])
  if (!org.ok) fallo(org, `no pude leer el plan de ${cuenta}`)
  return String(JSON.parse(org.salida).plan?.name ?? 'free')
}

/**
 * Crea el repo (público salvo `privado`) o, si ya existe, no lo toca: 'creado' | 'ya existía'. Privado sólo con un plan de pago: con
 * GitHub Free un repo privado no tiene auto-merge ni protección de main, y el flujo depende de los dos.
 */
export function crearRepoEnGithub(gh, { github, privado = false, descripcion }) {
  if (existeRepo(gh, github)) return 'ya existía'
  const cuenta = github.split('/')[0] ?? ''
  if (privado)
    exigir(
      planDeLaCuenta(gh, cuenta) !== 'free',
      `${cuenta} tiene GitHub Free: privado deja sin auto-merge ni protección; crea público o cambia de plan`,
    )
  const r = gh([
    'repo',
    'create',
    github,
    privado ? '--private' : '--public',
    '--description',
    descripcion,
  ])
  if (!r.ok) fallo(r, `no pude crear ${github}`)
  return 'creado'
}

/** Los ajustes de calesa-app. */
export function ajustar(gh, github) {
  const r = gh(['api', '-X', 'PATCH', `repos/${github}`, '--input', '-'], {
    input: JSON.stringify(AJUSTES),
  })
  if (!r.ok) fallo(r, `no pude ajustar ${github}`)
}

/** El remoto `origin` del repo local: lo pone si falta; uno distinto ya puesto es un error con los dos valores. */
export function ponerRemoto(dir, github) {
  const url = `https://github.com/${github}.git`
  const r = spawnSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' })
  if (r.status === 0) {
    const actual = r.stdout.trim()
    exigir(actual === url, `${dir}: origin ya apunta a ${actual}, y el manifiesto dice ${url}`)
    return 'ya estaba'
  }
  const a = spawnSync('git', ['-C', dir, 'remote', 'add', 'origin', url], { encoding: 'utf8' })
  exigir(a.status === 0, `no pude poner origin en ${dir}: ${a.stderr}`)
  return 'puesto'
}

/** Las etiquetas de la cola, con `asegurar_etiquetas` de scripts/orquestador/github.sh del mismo repo (sin copiar la lista). */
export function asegurarEtiquetas(gh, dir) {
  const est = mkdtempSync(join(tmpdir(), 'etiquetas-'))
  const r = spawnSync('bash', ['-c', 'log(){ :; }; source "$ORQ/github.sh"; asegurar_etiquetas'], {
    encoding: 'utf8',
    cwd: dir,
    env: {
      ...process.env,
      GH_TOKEN: gh.token,
      REPO: dir,
      ORQ: join(dir, 'scripts/orquestador'),
      EST: est,
    },
  })
  let error = ''
  try {
    error = readFileSync(join(est, '.gh-ultimo-error'), 'utf8')
  } catch {
    // sin error guardado
  }
  rmSync(est, { recursive: true, force: true })
  exigir(
    r.status === 0,
    `no pude crear las etiquetas de la cola: ${error || r.stderr || 'gh falló'}`,
  )
}

/** Lo versionado del repo con forma de secreto (secretos.mjs), `archivo:línea: tipo`. */
export function secretosVersionados(dir) {
  const r = spawnSync('git', ['-C', dir, 'ls-files', '-z'], { encoding: 'utf8' })
  exigir(r.status === 0, `${dir} no es un repo de git`)
  const textos = {}
  for (const f of r.stdout.split('\0').filter(Boolean)) {
    let buf
    try {
      buf = readFileSync(join(dir, f))
    } catch {
      continue // borrado en el árbol
    }
    textos[f] = buf.includes(0) ? '' : buf.toString('utf8')
  }
  return secretosEn(textos)
}

/**
 * Protege main si el primer CI terminó en verde: 'protegido' | 'corriendo' (el CI no terminó: la CLI sale con 75). Si cayó, se niega
 * salvo `aunqueRojo` (lo decide la persona): sin protección, el auto-merge integra al instante.
 */
export function proteger(gh, github, { aunqueRojo = false } = {}) {
  const r = gh([
    'api',
    `repos/${github}/commits/main/check-runs?check_name=${encodeURIComponent(CHECK)}`,
  ])
  if (!r.ok) fallo(r, `no pude leer el CI de main de ${github}`)
  const corridas = (JSON.parse(r.salida).check_runs ?? []).sort((a, b) => b.id - a.id)
  const ultima = corridas[0]
  if (!ultima || ultima.status !== 'completed') return 'corriendo'
  if (ultima.conclusion !== 'success' && !aunqueRojo)
    throw new Problema(
      `main de ${github} no queda protegido: cayó «${CHECK}» (${ultima.html_url ?? 'sin enlace'}). No enciendas su orquestador`,
    )
  const p = gh(['api', '-X', 'PUT', `repos/${github}/branches/main/protection`, '--input', '-'], {
    input: JSON.stringify(PROTECCION),
  })
  if (!p.ok) fallo(p, `no pude proteger main de ${github}`)
  return 'protegido'
}
