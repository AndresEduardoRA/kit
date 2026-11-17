// El estado de un proyecto entero (varios repos, quizá de cuentas distintas) y su resumen diario al celular. Se corre con
// `bash _herramientas/kit/scripts/proyecto/proyecto.sh <orden> …` desde `proyectos/` (proyecto.sh sólo prepara node); docs/KIT.md ›
// «El estado de un proyecto».
//
//   estado <z_carpeta>|--todos       por repo, por GitHub y con el token de su cuenta: PR abiertos con su «Listo», CI de main, última noche,
//                                    trabadas, con pregunta, urgentes y cuántas hay en la cola. Lo único local es z_*/proyecto.yaml
//   sincronizar <z_carpeta>|--todos  trae de cada repo lo que manda el repo (etapa, semilla, provee, vigentes) al manifiesto suelto;
//                                    si en un repo difiere lo que manda el proyecto, abre ahí un issue `cola`; copia la `## Retro` del PR de cierre
//   reconstruir <z_carpeta> [--forzar]  rehace el manifiesto suelto desde las copias de los repos (z_<proyecto>/<rol>/.proyecto/proyecto.yaml)
//   resumen --todos                  un aviso de ntfy por proyecto con lo que está en rojo (o «todo en verde»): NTFY_TEMA de ~/.config/orquestador/maquina.env
//   instalar-resumen                 el timer de systemd de usuario: cada día a las 08:00 de La Paz corre sincronizar y resumen de todos
//
// Sale con 0 (estado y resumen nunca frenan: sin red o sin token lo dicen y siguen), 1 si algo falló de verdad y 64 si el uso está mal.
// Lo puro está en proyecto-texto.mjs; se prueba en proyecto.test.mjs con un `gh` falso.
import { execFile, execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { PLANTILLA } from '../kit/manifiesto-texto.mjs'
import { textoDeLaCopia } from '../kit/manifiesto-texto.mjs'
import {
  leerManifiesto,
  ManifiestoInvalido,
  raizDeProyectos,
  RUTA_MANIFIESTO,
} from './manifiesto.mjs'
import {
  cabecera,
  conLoDeLosRepos,
  copiaBase,
  difierenLosCamposDelProyecto,
  issueDeSincronizar,
  lineaSinGithub,
  lineasDelRepo,
  resumenDelProyecto,
  retroConBloque,
  retroDeCuerpo,
  textoDeEstado,
  textoSuelto,
  TITULO_SINCRONIZAR,
  TOPE_DE_COLA,
  unidadesDelResumen,
  UNIDAD,
} from './proyecto-texto.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const GUION = 'bash _herramientas/kit/scripts/proyecto/proyecto.sh'
const ejecutar = promisify(execFile)
const TIEMPO_MAX = 20_000

class Uso extends Error {}
class SinGitHub extends Error {
  /** @param {string} mensaje  @param {number} [http] */
  constructor(mensaje, http = 0) {
    super(mensaje)
    this.http = http
  }
}
class SinAcceso extends Error {}

// ---------- GitHub: `gh api` con el token de la cuenta dueña de cada repo ----------

/** El kit principal (no el worktree desde el que se corra): el padre del directorio común de git. */
function kitPrincipal() {
  try {
    const comun = execFileSync(
      'git',
      ['-C', AQUI, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    return dirname(comun)
  } catch {
    return resolve(AQUI, '../..')
  }
}

/** @type {Map<string, Promise<string>>} */
const tokens = new Map()
/** El token de `gh` de una cuenta (nunca el `GH_TOKEN` suelto: sería de una sola cuenta). @param {string} cuenta */
function tokenDe(cuenta) {
  let p = tokens.get(cuenta)
  if (!p) {
    p = ejecutar('gh', ['auth', 'token', '--user', cuenta], { timeout: TIEMPO_MAX })
      .then((r) => {
        const t = r.stdout.trim()
        if (!t) throw new SinAcceso(cuenta)
        return t
      })
      .catch((e) => {
        if (e instanceof SinAcceso) throw e
        throw new SinAcceso(e?.code === 'ENOENT' ? `${cuenta}: gh no está instalado` : cuenta)
      })
    tokens.set(cuenta, p)
  }
  return p
}

/**
 * Una llamada a `gh api` con el token de la cuenta; el JSON, o el texto si `crudo`. Falla con SinGitHub (con el código HTTP, si lo hubo).
 * @param {string} cuenta  @param {string[]} args  @param {{ entrada?: string, crudo?: boolean }} [o]
 */
async function api(cuenta, args, o = {}) {
  const token = await tokenDe(cuenta)
  try {
    const p = ejecutar('gh', ['api', ...args], {
      timeout: TIEMPO_MAX,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GH_TOKEN: token },
    })
    if (o.entrada !== undefined) p.child.stdin?.end(o.entrada)
    const r = await p
    return o.crudo ? r.stdout : JSON.parse(r.stdout || 'null')
  } catch (e) {
    const texto = String(e?.stderr || e?.message || '').trim()
    throw new SinGitHub(texto.split('\n')[0] ?? '', Number(/HTTP (\d{3})/.exec(texto)?.[1] ?? 0))
  }
}

/** Como `api`, pero un 404 es «no hay» (un repo sin workflow `ci` no es un fallo). */
const opcional = (cuenta, args) =>
  api(cuenta, args).catch((e) => {
    if (e instanceof SinGitHub && e.http === 404) return null
    throw e
  })

const cuentaDe = (repo) => repo.github.split('/')[0] ?? ''

// ---------- los manifiestos de la raíz ----------

/** @param {string} raiz */
const carpetasZ = (raiz) =>
  existsSync(raiz)
    ? readdirSync(raiz, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith('z_'))
        .map((d) => d.name)
        .sort()
    : []

/** `z_calesa`, `calesa` o una ruta que termine en `z_calesa`: el nombre de la carpeta. @param {string} arg */
const carpetaDe = (arg) => {
  const nombre = resolve(arg).split('/').pop() ?? arg
  return nombre.startsWith('z_') ? nombre : `z_${nombre}`
}

/**
 * Los proyectos que pide la orden: uno por carpeta, con su manifiesto leído o el motivo por el que no se pudo (sin archivo: sugiere
 * `reconstruir`; inválido: el primer error).
 * @param {string} raiz  @param {string | undefined} objetivo  `--todos` o la carpeta
 * @returns {{ carpeta: string, manifiesto?: import('./manifiesto.mjs').Manifiesto, archivo: string, problema?: string }[]}
 */
function proyectosDe(raiz, objetivo) {
  if (!objetivo) throw new Uso('falta la carpeta del proyecto (z_<proyecto>) o --todos')
  const carpetas = objetivo === '--todos' ? carpetasZ(raiz) : [carpetaDe(objetivo)]
  return carpetas.map((carpeta) => {
    const archivo = join(raiz, carpeta, 'proyecto.yaml')
    if (!existsSync(join(raiz, carpeta)))
      return { carpeta, archivo, problema: `no existe ${carpeta} en ${raiz}` }
    if (!existsSync(archivo))
      return {
        carpeta,
        archivo,
        problema: `no hay ${carpeta}/proyecto.yaml: rehazlo con \`${GUION} reconstruir ${carpeta}\``,
      }
    try {
      return {
        carpeta,
        archivo,
        manifiesto: leerManifiesto(readFileSync(archivo, 'utf8'), archivo),
      }
    } catch (e) {
      const primero = (e instanceof Error ? e.message : String(e)).split('\n').slice(0, 2).join(' ')
      return { carpeta, archivo, problema: `${carpeta}/proyecto.yaml no sirve: ${primero}` }
    }
  })
}

// ---------- estado y resumen ----------

/** Todo lo de un repo, por GitHub. Falla con SinAcceso o SinGitHub. @param {import('./manifiesto.mjs').Repo} repo */
async function consultarRepo(repo) {
  const c = cuentaDe(repo)
  const r = `repos/${repo.github}`
  const issues = async (etiqueta) => {
    const lista = await api(c, [
      `${r}/issues?state=open&labels=${encodeURIComponent(etiqueta)}&per_page=${etiqueta === 'cola' ? TOPE_DE_COLA : 30}`,
    ])
    // La API de issues devuelve también los PR.
    return lista.filter((i) => !i.pull_request).map((i) => ({ numero: i.number, titulo: i.title }))
  }
  const corrida = async (evento) => {
    const x = await opcional(c, [
      `${r}/actions/workflows/ci.yml/runs?branch=main&event=${evento}&status=completed&per_page=1`,
    ])
    const w = x?.workflow_runs?.[0]
    return w
      ? {
          conclusion: w.conclusion ?? '',
          cuando: w.created_at,
          id: w.id,
          sha: String(w.head_sha ?? ''),
        }
      : null
  }
  const [prsCrudos, ci, noche, trabadas, preguntas, urgentes, cola] = await Promise.all([
    api(c, [`${r}/pulls?state=open&per_page=30`]),
    corrida('push'),
    corrida('schedule'),
    issues('cola:trabada'),
    issues('cola:pregunta'),
    issues('cola:urgente'),
    issues('cola'),
  ])
  const prs = await Promise.all(
    prsCrudos.slice(0, 10).map(async (p) => {
      const x = await api(c, [`${r}/commits/${p.head.sha}/check-runs?per_page=100`])
      const listo = (x?.check_runs ?? []).filter((k) => String(k.name).startsWith('Listo')).at(-1)
      return {
        numero: p.number,
        titulo: p.title,
        rama: p.head.ref,
        creado: String(p.created_at ?? ''),
        listo: listo?.conclusion ?? '',
      }
    }),
  )
  return {
    github: repo.github,
    prs,
    masPrs: prsCrudos.length > 10,
    ci,
    noche,
    trabadas,
    preguntas,
    urgentes,
    enCola: cola.length,
  }
}

/** Las líneas de un repo: lo consultado, o por qué no se pudo. */
async function lineasDeUnRepo(repo, ahora) {
  try {
    return lineasDelRepo(await consultarRepo(repo), ahora)
  } catch (e) {
    if (e instanceof SinAcceso) return [lineaSinGithub('acceso', cuentaDe(repo), 'gh auth login')]
    return [
      lineaSinGithub('red', repo.github, e instanceof SinGitHub ? e.message.slice(0, 80) : ''),
    ]
  }
}

const ahoraDe = () => new Date(process.env['PROYECTO_AHORA'] ?? Date.now())

/** @param {ReturnType<typeof proyectosDe>} proyectos */
async function mirar(proyectos) {
  const ahora = ahoraDe()
  return Promise.all(
    proyectos.map(async (p) => ({
      ...p,
      repos: p.manifiesto
        ? await Promise.all(
            p.manifiesto.repos.map(async (r) => ({
              nombre: r.nombre,
              etapa: r.etapa,
              lineas: await lineasDeUnRepo(r, ahora),
            })),
          )
        : [],
    })),
  )
}

async function estado(raiz, objetivo) {
  const proyectos = proyectosDe(raiz, objetivo)
  if (proyectos.length === 0) console.log(`· no hay ningún z_*/proyecto.yaml en ${raiz}`)
  for (const p of await mirar(proyectos)) {
    if (!p.manifiesto) console.log(`· ${p.problema}`)
    else process.stdout.write(textoDeEstado(p.manifiesto, p.repos))
  }
  // Un destino que se nombró y no existe es un error; `--todos` nunca frena.
  return objetivo !== '--todos' && proyectos.some((p) => !p.manifiesto) ? 1 : 0
}

/** `NTFY_TEMA` y `NTFY_SERVIDOR` de maquina.env, leídos sin `source` (un valor roto no rompe nada). */
function ntfyDeLaMaquina() {
  const archivo = join(process.env['HOME'] ?? homedir(), '.config/orquestador/maquina.env')
  const texto = existsSync(archivo) ? readFileSync(archivo, 'utf8') : ''
  const valor = (k) => {
    const l = texto
      .split('\n')
      .filter((x) => new RegExp(`^\\s*${k}=`).test(x))
      .at(-1)
    return (l?.split('=').slice(1).join('=') ?? '').replace(/#.*/, '').replace(/["'\s]/g, '')
  }
  return { tema: valor('NTFY_TEMA'), servidor: valor('NTFY_SERVIDOR') || 'https://ntfy.sh' }
}

async function resumen(raiz, objetivo) {
  if (objetivo !== '--todos') throw new Uso('resumen va con --todos')
  const { tema, servidor } = ntfyDeLaMaquina()
  const proyectos = await mirar(proyectosDe(raiz, '--todos'))
  let fallo = false
  for (const p of proyectos) {
    const aviso = p.manifiesto
      ? resumenDelProyecto(p.manifiesto, p.repos)
      : {
          titulo: `[${p.carpeta.slice(2)}] Resumen diario`,
          mensaje: p.problema ?? '',
          rojo: true,
        }
    console.log(`${aviso.titulo}\n${aviso.mensaje}\n`)
    if (!tema) continue
    try {
      const r = await fetch(`${servidor}/${tema}`, {
        method: 'POST',
        headers: {
          Title: cabecera(aviso.titulo),
          Priority: aviso.rojo ? 'high' : 'low',
          Tags: aviso.rojo ? 'warning' : 'white_check_mark',
        },
        body: aviso.mensaje,
        signal: AbortSignal.timeout(15_000),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
    } catch (e) {
      fallo = true
      console.error(
        `no se pudo mandar el aviso de ${p.carpeta} a ntfy: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
  if (!tema) {
    console.error(
      'falta NTFY_TEMA en ~/.config/orquestador/maquina.env: el resumen no se mandó al celular',
    )
    return 1
  }
  return fallo ? 1 : 0
}

// ---------- sincronizar ----------

/** La copia de un repo en main, leída y revisada. @param {import('./manifiesto.mjs').Repo} repo */
async function copiaDelRepo(repo) {
  const texto = await api(
    cuentaDe(repo),
    [
      `repos/${repo.github}/contents/${RUTA_MANIFIESTO}?ref=main`,
      '-H',
      'Accept: application/vnd.github.raw',
    ],
    { crudo: true },
  )
  return leerManifiesto(texto, `${repo.github}:${RUTA_MANIFIESTO}`)
}

/** El issue abierto «sincronizar el manifiesto» de un repo, si hay. */
async function issueAbierto(repo) {
  const c = cuentaDe(repo)
  const lista = await api(c, [`repos/${repo.github}/issues?state=open&labels=cola&per_page=100`])
  return lista.find((i) => !i.pull_request && i.title === TITULO_SINCRONIZAR) ?? null
}

/** El PR de cierre integrado de un repo y su `## Retro`, o `null`. */
async function retroDelRepo(repo) {
  const q = `repo:${repo.github} is:pr is:merged "cerrar la construcción" in:title`
  const r = await api(cuentaDe(repo), [
    '-X',
    'GET',
    'search/issues',
    '-f',
    `q=${q}`,
    '-f',
    'per_page=5',
  ])
  const pr = (r?.items ?? []).find((i) => /cerrar la construcci[oó]n/i.test(String(i.title)))
  const retro = retroDeCuerpo(pr?.body)
  return pr && retro
    ? { pr: pr.number, fecha: String(pr.closed_at ?? '').slice(0, 10), retro }
    : null
}

/** @param {NonNullable<ReturnType<typeof proyectosDe>[number]['manifiesto']>} m  @param {string} archivo @param {string} carpeta @param {string} raiz */
async function sincronizarUno(m, archivo, carpeta, raiz) {
  let fallo = false
  const dice = (marca, texto) => console.log(`${marca} ${texto}`)
  const copias = []
  for (const repo of m.repos) {
    try {
      copias.push({ repo, rol: repo.rol, copia: await copiaDelRepo(repo) })
    } catch (e) {
      if (e instanceof SinAcceso)
        dice('✗', `${repo.nombre}: sin acceso a ${cuentaDe(repo)} (gh auth login)`)
      else if (e instanceof ManifiestoInvalido) {
        fallo = true
        dice(
          '✗',
          `${repo.nombre}: su copia no sirve — ${e.message.split('\n').slice(0, 2).join(' ')}`,
        )
      } else if (e instanceof SinGitHub && e.http === 404)
        dice(
          '·',
          `${repo.nombre}: todavía no tiene ${RUTA_MANIFIESTO} en main (o el repo no existe): no se sincroniza`,
        )
      else
        dice(
          '·',
          `${repo.nombre}: GitHub no respondió${e instanceof SinGitHub && e.message ? ` (${e.message.slice(0, 80)})` : ''}: no se sincroniza`,
        )
    }
  }
  // 1. Lo que manda el repo, al suelto.
  const previo = readFileSync(archivo, 'utf8')
  const { texto, cambios } = conLoDeLosRepos(previo, copias)
  if (cambios.length) {
    leerManifiesto(texto, archivo) // un resultado inválido no se escribe
    writeFileSync(archivo, texto)
    for (const c of cambios) dice('✓', `${carpeta}: ${c}`)
  } else if (copias.length) dice('✓', `${carpeta}: el manifiesto ya tiene lo que mandan los repos`)
  const actual = cambios.length ? leerManifiesto(texto, archivo) : m
  // 2. Lo que manda el proyecto: si una copia difiere, un issue en ese repo.
  for (const { repo, copia } of copias) {
    const diferencias = difierenLosCamposDelProyecto(actual, copia)
    if (diferencias.length === 0) {
      dice('✓', `${repo.nombre}: su copia coincide con el proyecto`)
      continue
    }
    try {
      const ya = await issueAbierto(repo)
      if (ya) {
        dice('·', `${repo.nombre}: su copia difiere y ya está pedido en #${ya.number}`)
        continue
      }
      const creado = await api(
        cuentaDe(repo),
        ['-X', 'POST', `repos/${repo.github}/issues`, '--input', '-'],
        {
          entrada: JSON.stringify({
            title: TITULO_SINCRONIZAR,
            body: issueDeSincronizar({
              repo: repo.nombre,
              diferencias,
              esperado: textoDeLaCopia(cambios.length ? texto : previo, m.proyecto),
            }),
            labels: ['cola'],
          }),
        },
      )
      dice(
        '✗',
        `${repo.nombre}: su copia difiere (${diferencias.length}); abrí el issue #${creado?.number ?? '?'} «${TITULO_SINCRONIZAR}» en su cola`,
      )
    } catch (e) {
      fallo = true
      dice(
        '✗',
        `${repo.nombre}: su copia difiere y no pude abrir el issue: ${e instanceof Error ? e.message.slice(0, 100) : ''}`,
      )
    }
  }
  // 3. La retro del PR de cierre, a la semilla.
  if (actual.semilla)
    await retros(
      actual,
      copias.map((c) => c.repo),
      join(raiz, carpeta),
      dice,
    )
  return fallo
}

async function retros(m, repos, carpetaZ, dice) {
  const archivo = join(carpetaZ, 'semilla', 'retro.md')
  let texto = existsSync(archivo) ? readFileSync(archivo, 'utf8') : ''
  let cambio = false
  for (const repo of repos) {
    try {
      const r = await retroDelRepo(repo)
      if (!r) continue
      const nuevo = retroConBloque(texto, m.nombre, { repo: repo.nombre, ...r })
      if (nuevo !== texto) {
        texto = nuevo
        cambio = true
        dice('✓', `${repo.nombre}: la retro del PR #${r.pr} está en semilla/retro.md`)
      }
    } catch (e) {
      dice(
        '·',
        `${repo.nombre}: no pude leer su retro (${e instanceof Error ? e.message.slice(0, 80) : ''})`,
      )
    }
  }
  if (cambio) {
    mkdirSync(dirname(archivo), { recursive: true })
    writeFileSync(archivo, texto)
  }
}

async function sincronizar(raiz, objetivo) {
  let fallo = false
  for (const p of proyectosDe(raiz, objetivo)) {
    if (!p.manifiesto) {
      console.log(`· ${p.problema}`)
      fallo ||= objetivo !== '--todos'
      continue
    }
    fallo = (await sincronizarUno(p.manifiesto, p.archivo, p.carpeta, raiz)) || fallo
  }
  return fallo ? 1 : 0
}

// ---------- reconstruir ----------

function reconstruir(raiz, objetivo, forzar) {
  if (!objetivo || objetivo === '--todos')
    throw new Uso('reconstruir va con una carpeta: z_<proyecto>')
  const carpeta = carpetaDe(objetivo)
  const dir = join(raiz, carpeta)
  if (!existsSync(dir)) throw new Uso(`no existe ${dir}`)
  const archivo = join(dir, 'proyecto.yaml')
  if (existsSync(archivo) && !forzar) {
    console.error(
      `✗ ${carpeta}/proyecto.yaml ya existe: para rehacerlo, \`${GUION} reconstruir ${carpeta} --forzar\` (la versión actual queda en proyecto.yaml.anterior)`,
    )
    return 1
  }
  const copias = []
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, d.name, RUTA_MANIFIESTO)
    if (!d.isDirectory() || d.name.startsWith('.') || !existsSync(f)) continue
    try {
      copias.push({
        rol: d.name,
        texto: readFileSync(f, 'utf8'),
        copia: leerManifiesto(readFileSync(f, 'utf8'), f),
      })
    } catch (e) {
      console.error(
        `· ${d.name}: su copia no sirve, no cuenta (${(e instanceof Error ? e.message : '').split('\n')[0]})`,
      )
    }
  }
  const base = copias.length ? copiaBase(copias) : undefined
  if (!base) {
    console.error(
      `✗ no hay ninguna copia en ${carpeta}/<rol>/${RUTA_MANIFIESTO}: clona un repo del proyecto ahí (o copia a mano una desde GitHub)`,
    )
    return 1
  }
  const m = base.copia
  const { texto, cambios } = conLoDeLosRepos(textoSuelto(base.texto, m, PLANTILLA), copias)
  leerManifiesto(texto, archivo)
  if (existsSync(archivo)) renameSync(archivo, `${archivo}.anterior`)
  writeFileSync(archivo, texto)
  console.log(
    `✓ ${carpeta}/proyecto.yaml rehecho con la copia de ${m.repos.length === 1 ? m.repos[0]?.nombre : base.rol}${copias.length > 1 ? ` y lo de ${copias.length} copias` : ''}`,
  )
  for (const c of cambios) console.log(`  · ${c}`)
  const sinCopia = m.repos.filter((r) => !copias.some((c) => c.rol === r.rol)).map((r) => r.nombre)
  if (sinCopia.length)
    console.log(
      `· sin copia local de ${sinCopia.join(', ')}: su etapa y lo que provee son los de la copia base; \`${GUION} sincronizar ${carpeta}\` los trae de GitHub`,
    )
  return 0
}

// ---------- instalar-resumen ----------

function instalarResumen(raiz) {
  const home = process.env['HOME'] ?? homedir()
  const kit = kitPrincipal()
  const dir = join(home, '.config/systemd/user')
  mkdirSync(dir, { recursive: true })
  const { servicio, timer } = unidadesDelResumen({
    kit,
    raiz,
    home,
    path: `/usr/local/bin:/usr/bin:/bin`,
  })
  writeFileSync(join(dir, `${UNIDAD}.service`), servicio)
  writeFileSync(join(dir, `${UNIDAD}.timer`), timer)
  execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' })
  execFileSync('systemctl', ['--user', 'enable', '--now', `${UNIDAD}.timer`], { stdio: 'inherit' })
  console.log(
    `✓ ${UNIDAD}.timer instalado: cada día a las 08:00 de La Paz corre sincronizar y resumen de todos los proyectos.`,
  )
  console.log(
    `  Próxima corrida: systemctl --user list-timers ${UNIDAD}.timer · su log: journalctl --user -u ${UNIDAD}.service`,
  )
  console.log(
    '  Para que corra sin sesión abierta (una vez por máquina): loginctl enable-linger "$USER"',
  )
  console.log('  El tema de ntfy sale de NTFY_TEMA en ~/.config/orquestador/maquina.env.')
  return 0
}

// ---------- la CLI ----------

async function principal(argv) {
  const args = [...argv]
  const o = { raiz: process.env['PROYECTOS_RAIZ'] ?? '', forzar: false }
  for (let i = 0; i < args.length;) {
    if (args[i] === '--raiz') {
      o.raiz = args[i + 1] ?? ''
      args.splice(i, 2)
    } else if (args[i] === '--forzar') {
      o.forzar = true
      args.splice(i, 1)
    } else i++
  }
  const [orden, objetivo, ...resto] = args
  try {
    if (resto.length || (o.raiz === '' && argv.includes('--raiz')))
      throw new Uso('sobran argumentos')
    const raiz = resolve(o.raiz || raizDeProyectos(kitPrincipal()))
    if (orden === 'estado') return await estado(raiz, objetivo)
    if (orden === 'sincronizar') return await sincronizar(raiz, objetivo)
    if (orden === 'reconstruir') return reconstruir(raiz, objetivo, o.forzar)
    if (orden === 'resumen') return await resumen(raiz, objetivo)
    if (orden === 'instalar-resumen') return instalarResumen(raiz)
    throw new Uso('orden desconocida')
  } catch (e) {
    if (e instanceof Uso) {
      console.error(
        `${e.message}\nuso: ${GUION} estado|sincronizar <z_carpeta>|--todos · reconstruir <z_carpeta> [--forzar] · resumen --todos · instalar-resumen`,
      )
      return 64
    }
    console.error(e instanceof Error ? e.message : String(e))
    return 1
  }
}

process.exitCode = await principal(process.argv.slice(2))
