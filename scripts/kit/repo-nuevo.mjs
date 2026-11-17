// Un repo nuevo del proyecto: los archivos del kit que viajan, el repo entero en memoria (lo que se reemplaza y lo que nace de la
// semilla), su resumen de seis líneas y la escritura con el primer commit. Lo usa nuevo-proyecto.mjs. Se prueba en
// `nuevo-proyecto.test.mjs`.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { baseDelBloque } from '../lib/stack-local.mjs'
import { esFlujo, patronesDelKit } from './flujo.mjs'
import { textoDeLaCopia } from './manifiesto-nuevo.mjs'
import { exigir } from './problema.mjs'
import {
  docsDerivados,
  marcadoresSueltos,
  reemplazos,
  scopesDelPlan,
  seRevisa,
} from './reemplazos.mjs'
import { secretosEn } from './secretos.mjs'
import * as S from './semilla.mjs'

// Lo que es del kit y no viaja a un proyecto: lo de scripts/kit/ que no es flujo (el generador, la publicación y traer al kit lo de
// un proyecto), sus skills, el validador y la semilla de ejemplo, las lecciones de las semillas (nombran el flujo viejo), el estado de
// todo el proyecto (`proyecto.sh`: mira `proyectos/`, no un repo) y lo generado. Lo de scripts/kit/ que es flujo (actualizar.mjs y lo
// que usa) sí viaja.
const FLUJO = patronesDelKit()
const NO_VIAJA = [
  { test: (/** @type {string} */ f) => f.startsWith('scripts/kit/') && !esFlujo(f, FLUJO) },
  /^scripts\/proyecto\/proyecto[.-]/,
  /^scripts\/semilla\//,
  /^docs\/semillas\//,
  /^\.claude\/skills\/semilla-a-repo\//,
  /^\.claude\/skills\/traer-de-proyecto\//,
  /^docs\/MAPA\.md$/,
  /^\.kit\/plantilla$/,
  /^kit-protegidos\.tgz$/,
]
// Lo ignorado por git que tampoco viaja cuando el kit no es un repo.
const IGNORADO =
  /^(node_modules|\.next|\.next-e2e|\.git|\.orquestador|test-results|e2e-fallos|test-salidas)(\/|$)|\.tsbuildinfo$/

/** Los archivos del kit que viajan, relativos a él. */
export function archivosDelKit(kit) {
  const git = spawnSync(
    'git',
    ['-C', kit, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' },
  )
  const lista =
    git.status === 0
      ? git.stdout.split('\0').filter(Boolean)
      : (function andar(dir, pre = '') {
          return readdirSync(dir).flatMap((n) => {
            const rel = pre + n
            if (IGNORADO.test(rel)) return []
            return statSync(join(dir, n)).isDirectory() ? andar(join(dir, n), rel + '/') : [rel]
          })
        })(kit)
  return lista.filter((f) => !NO_VIAJA.some((re) => re.test(f)) && existsSync(join(kit, f)))
}

/**
 * Un repo, entero, en memoria: cada archivo con su texto (o su Buffer, si es binario) y su modo, y lo que el resumen dice de él.
 * Puro salvo la lectura de los archivos del kit (`delKit`).
 */
export function planDelRepo({ semilla, crear, slug, manifiesto, cssSemilla, delKit, version }) {
  const { rol, bloque, github } = crear
  const repo = semilla.repos[rol]
  exigir(repo, `${slug}-${rol} no tiene semilla en repos/${rol}/`)
  const deComun = semilla.comun.fm.repos.find((r) => r.rol === rol) ?? {}
  const descripcion = String(repo.fm.descripcion ?? deComun.descripcion ?? `${slug}-${rol}`)
  const funciones = (repo.fm.funciones_edge ?? []).join(' ')
  const scopes = scopesDelPlan(repo.plan)
  const r = reemplazos({
    slug,
    rol,
    nombreProyecto: String(semilla.comun.fm.nombre),
    descripcion,
    bloque,
    scopes,
    funciones,
    cssSemilla,
  })
  /** @type {Map<string, { texto: string | Buffer, modo: number }>} */
  const archivos = new Map()
  for (const [f, { contenido, modo }] of delKit)
    archivos.set(f, {
      texto: typeof contenido === 'string' && r[f] ? r[f](contenido) : contenido,
      modo,
    })
  const extra = {
    '.proyecto/proyecto.yaml': textoDeLaCopia(manifiesto, slug),
    '.kit/version': `${version}\n`,
    'docs/semilla/comun.md': semilla.comun.texto,
    'docs/semilla/registro.md': semilla.registroTexto,
    'docs/semilla/semilla.md': repo.texto,
    'docs/semilla/plan.yaml': readFileSync(join(semilla.dir, `repos/${rol}/plan.yaml`), 'utf8'),
    ...docsDerivados({
      repo: repo.texto,
      comun: semilla.comun.texto,
      versionRepo: repo.fm.version ?? 1,
      versionComun: semilla.comun.fm.version ?? 1,
    }),
  }
  for (const [f, texto] of Object.entries(extra)) archivos.set(f, { texto, modo: 0o644 })
  const textos = Object.fromEntries(
    [...archivos].filter(([, a]) => typeof a.texto === 'string').map(([f, a]) => [f, a.texto]),
  )
  const pasos = repo.plan.pasos ?? []
  const contratos = (lado) =>
    pasos.filter((p) => p.contrato?.[lado]).map((p) => `${p.contrato[lado]} en ${p.id}`)
  return {
    rol,
    nombre: `${slug}-${rol}`,
    bloque,
    github,
    version: repo.fm.version ?? 1,
    archivos,
    marcadores: marcadoresSueltos(
      Object.fromEntries(Object.entries(textos).filter(([f]) => seRevisa(f))),
    ),
    secretos: secretosEn(textos),
    pasos: pasos.length,
    rojos: pasos.filter((p) => p.riesgo === 'rojo').map((p) => p.id),
    espera: pasos
      .flatMap((p) => p.depende_de ?? [])
      .filter((d) => String(d).includes(':'))
      .map((d) => `${slug}-${d}`),
    provee: contratos('provee'),
    consume: contratos('consume'),
    pantallas: S.pantallasDe(S.seccion(repo.texto, 'Experiencia')).length,
    terminos: S.terminosDe(S.seccion(semilla.comun.texto, 'Glosario')),
    scopes,
  }
}

/** Las seis líneas de un repo en el resumen (una, si se salta). Puro. */
export function resumenDelRepo(p) {
  const carpeta = `z_${p.nombre.slice(0, p.nombre.lastIndexOf('-'))}/${p.rol}`
  if (p.motivo) return `${p.nombre} · ${carpeta} · se salta: ${p.motivo}`
  const pu = baseDelBloque(p.bloque)
  const o = (lista, nada = 'nada') => (lista.length ? lista.join(', ') : nada)
  return [
    `${p.nombre} · ${carpeta} · nuevo${p.commit ? ` · commit ${p.commit}` : ''}`,
    `  puertos: bloque ${p.bloque} · API ${pu.SUPABASE_API_PORT} · base ${pu.SUPABASE_DB_PORT} · app ${pu.PUERTO_APP}`,
    `  github: ${p.github} (se crea si lo confirmas)`,
    `  cola: ${p.pasos} pasos + cierre · rojos: ${o(p.rojos, 'ninguno')} · espera a: ${o(p.espera)}`,
    `  contratos: consume ${o(p.consume)} · publica: ${o(p.provee)}`,
    `  docs: ${p.pantallas} pantallas · glosario ${p.terminos} términos · scopes ${o(p.scopes, 'ninguno')} · ` +
      `${p.marcadores.length} marcadores · ${p.secretos.length} secretos`,
  ].join('\n')
}

const vivo = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return /** @type {NodeJS.ErrnoException} */ (e).code === 'EPERM'
  }
}

/** Borra los `.<rol>.creando-<pid>` que dejó un corte (de un proceso que ya no vive). */
export function limpiarCreando(carpeta) {
  for (const n of readdirSync(carpeta)) {
    const viejo = /^\.[a-z]+\.creando-(\d+)$/.exec(n)
    if (viejo && !vivo(Number(viejo[1]))) rmSync(join(carpeta, n), { recursive: true, force: true })
  }
}

/** Escribe el repo en `.<rol>.creando-<pid>`, hace el primer commit y lo renombra: un corte no deja una carpeta a medias. */
export function escribirRepo(p, destino, slug) {
  const tmp = join(dirname(destino), `.${p.rol}.creando-${process.pid}`)
  rmSync(tmp, { recursive: true, force: true })
  for (const [f, { texto, modo }] of p.archivos) {
    mkdirSync(dirname(join(tmp, f)), { recursive: true })
    writeFileSync(join(tmp, f), texto)
    // El proyecto es del dueño: todo se puede escribir (lo que llega por tar puede venir de sólo lectura); el bit de ejecución queda.
    chmodSync(join(tmp, f), modo | 0o200)
  }
  const g = (...a) =>
    execFileSync('git', ['-C', tmp, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  g('init', '-q', '-b', 'main')
  g('add', '-A')
  // Sin hooks: todavía no hay node_modules; la skill corre la verificación después.
  g(
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-q',
    '-m',
    `chore(kit): arrancar ${slug}-${p.rol} desde el kit (semilla v${p.version})`,
  )
  const commit = g('rev-parse', '--short', 'HEAD').trim()
  renameSync(tmp, destino) // `destino` no existe o está vacía (carpetaOcupada): rename la reemplaza
  return commit
}
