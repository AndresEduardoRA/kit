#!/usr/bin/env node
// Crea un proyecto nuevo desde el kit y una semilla validada (la parte determinista de la skill semilla-a-repo). No llama a ningún
// modelo ni a la red: copia, reemplaza, genera los docs derivados, hace el primer commit y verifica que no quedó un marcador.
//
//   node scripts/kit/nuevo-proyecto.mjs <carpeta de la semilla> <carpeta destino> [--bloque N] [--validador <validar_semilla.py>]
//                                       [--en-seco]
//
// - <carpeta de la semilla>: la de idea-a-semilla (<semillas>/<slug>/: semilla.md o semilla/, plan.yaml, registro.md, CHANGELOG.md).
// - <carpeta destino>: no debe existir (o estar vacía). Por convención, <proyectos>/<slug>.
// - --bloque: el bloque de puertos (1 a 9, nunca 4). Sin él, el primero libre entre los proyectos de ~/.config/kit/proyectos.txt.
// - --validador: validar_semilla.py (por defecto <carpeta de la semilla>/../_herramientas/validar_semilla.py). Si falta, se niega.
// - --en-seco: valida, aplica los reemplazos en memoria (falla si quedaría un marcador) y dice qué haría, sin escribir nada.
//
// Lo que reemplaza está en docs/KIT.md › «Lo que semilla-a-repo tiene que reemplazar». Sale con 1 y el motivo si algo no cuadra.
// Se prueba en `nuevo-proyecto.test.mjs`.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { leerPlan, problemasDelPlan } from '../coordinador/plan.mjs'
import { baseDelBloque } from '../lib/stack-local.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
// Lo que es del kit y no viaja a un proyecto: el generador, su skill, la semilla de ejemplo y lo generado.
const NO_VIAJA = [
  /^scripts\/kit\//,
  /^scripts\/semilla\//,
  /^\.claude\/skills\/semilla-a-repo\//,
  /^docs\/MAPA\.md$/,
  /^\.kit\/plantilla$/,
  /^kit-protegidos\.tgz$/,
]
// Lo ignorado por git que tampoco viaja cuando el kit no es un repo.
const IGNORADO =
  /^(node_modules|\.next|\.next-e2e|\.git|\.piloto|\.orquestador|test-results|e2e-fallos|test-salidas)(\/|$)|\.tsbuildinfo$/
// Los archivos donde están los números del bloque 5 (el del kit) que pasan al bloque del proyecto.
const CON_PUERTOS = ['supabase/config.toml', 'playwright.config.ts', '.env.example', 'README.md']
const MARCADORES = [
  '{{NOMBRE}}',
  '{{DESCRIPCION}}',
  '{{SCOPES}}',
  '{{SCOPES_MODULOS}}',
  '{{API_PORT}}',
  '{{DB_PORT}}',
  '{{FUNCIONES}}',
  '{{PUERTOS_PILA}}',
  'cambiar-slug',
]
// Los archivos del flujo (vienen de calesa-app) que nombran al proyecto: `{{NOMBRE}}` en la prosa y `cambiar-slug` en lo que es un
// identificador (PROYECTO del orquestador, su servicio, su tema de ntfy). Sólo esos dos: los `{{ID}}`, `{{RAMA}}`… de los prompts
// los reemplaza el orquestador.
const CON_NOMBRE = [
  '.claude/agents/revisor.md',
  '.claude/skills/entregar/SKILL.md',
  '.claude/skills/feature/SKILL.md',
  '.claude/skills/revisar/SKILL.md',
  'scripts/orquestador/config.env',
  'scripts/orquestador/README.md',
  'scripts/orquestador/prompts/tarea.md',
  'scripts/orquestador/prompts/arreglar.md',
  'scripts/orquestador/prompts/planificar.md',
]
const BLOQUES = [5, 6, 7, 8, 9, 1, 2, 3]
const ANCHO = (() => {
  try {
    return JSON.parse(readFileSync(join(KIT, '.prettierrc'), 'utf8')).printWidth ?? 80
  } catch {
    return 80
  }
})()

export class Problema extends Error {}
const exigir = (cond, msg) => {
  if (!cond) throw new Problema(msg)
}

// ---------- la semilla ----------

/** El texto de la semilla (un archivo o una carpeta con varios .md en orden). */
export function leerSemilla(carpeta) {
  if (existsSync(join(carpeta, 'semilla.md')))
    return readFileSync(join(carpeta, 'semilla.md'), 'utf8')
  const dir = join(carpeta, 'semilla')
  exigir(existsSync(dir), `no hay semilla.md ni semilla/ en ${carpeta}`)
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
}

export function frontmatter(texto) {
  const m = /^---\n([\s\S]*?)\n---/.exec(texto)
  exigir(m, 'la semilla no empieza con frontmatter YAML')
  return parse(m[1]) ?? {}
}

/** El cuerpo de una sección `## [n.] <titulo>` hasta la siguiente `## `, sin el título. */
export function seccion(texto, titulo) {
  const lineas = texto.split('\n')
  const re = new RegExp(`^##\\s+(\\d+\\.\\s*)?${titulo}\\b`, 'i')
  const i = lineas.findIndex((l) => re.test(l))
  if (i < 0) return null
  const j = lineas.findIndex((l, k) => k > i && /^##\s/.test(l))
  return lineas
    .slice(i + 1, j < 0 ? undefined : j)
    .join('\n')
    .trim()
}

/** El primer bloque ```css de la sección «Sistema de diseño» que define `:root`. */
export function cssDeLaSemilla(texto) {
  const sec = seccion(texto, 'Sistema de diseño')
  exigir(sec, 'la semilla no tiene la sección «Sistema de diseño»')
  const bloques = [...sec.matchAll(/```css\n([\s\S]*?)```/g)].map((m) => m[1])
  const css = bloques.find((b) => /:root\s*\{/.test(b))
  exigir(css, 'la sección «Sistema de diseño» no trae un bloque ```css con `:root { … }`')
  return css.trim()
}

const nombresDe = (css) => new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
const bloqueDe = (css, selector) => {
  const i = css.search(new RegExp(`^${selector.replace('.', '\\.')}\\s*\\{`, 'm'))
  if (i < 0) return null
  return css.slice(i, css.indexOf('}', i) + 1)
}
const valorDe = (bloque, nombre) =>
  new RegExp(`${nombre}:\\s*([^;]+);`).exec(bloque ?? '')?.[1]?.trim()

/** Que el CSS de la semilla cumpla el contrato de nombres del kit (los de design/tokens.css) y tenga `.dark`. */
export function problemasDelCss(cssSemilla, cssKit) {
  const p = []
  const faltan = [...nombresDe(cssKit)].filter((n) => !nombresDe(cssSemilla).has(n))
  if (faltan.length)
    p.push(
      `al sistema de diseño de la semilla le faltan tokens del contrato del kit: ${faltan.join(', ')}`,
    )
  if (!bloqueDe(cssSemilla, '.dark'))
    p.push('el sistema de diseño de la semilla no trae el tema oscuro como `.dark { … }`')
  for (const [sel, n] of [
    [':root', '--color-primario'],
    [':root', '--color-paper'],
    ['.dark', '--color-paper'],
  ])
    if (!valorDe(bloqueDe(cssSemilla, sel), n)) p.push(`falta ${n} en \`${sel}\``)
  return p
}

// ---------- el proyecto ----------

/** El bloque de puertos libre entre los proyectos anotados (sus piloto.config). */
export function bloqueLibre(lista = join(homedir(), '.config/kit/proyectos.txt')) {
  const usados = new Set()
  if (existsSync(lista))
    for (const raiz of readFileSync(lista, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))) {
      const conf = join(raiz, 'piloto.config')
      const m = existsSync(conf) && /^PILOTO_BLOQUE=(\d)/m.exec(readFileSync(conf, 'utf8'))
      if (m) usados.add(Number(m[1]))
    }
  const libre = BLOQUES.find((b) => !usados.has(b))
  exigir(
    libre,
    'no queda un bloque de puertos libre: hay 8 proyectos anotados en ~/.config/kit/proyectos.txt',
  )
  return libre
}

/** Los scopes de commit: los ids de los carriles y los módulos (`src/modules/<x>/`) que nombra el plan. */
export function scopesDelPlan(plan) {
  const modulos = new Set()
  for (const ruta of [
    ...plan.carriles.flatMap((c) => c.dueno_de ?? []),
    ...plan.pasos.flatMap((p) => p.modulos ?? []),
  ]) {
    const m = /^src\/modules\/([a-z0-9-]+)\//.exec(ruta)
    if (m) modulos.add(m[1])
  }
  const carriles = plan.carriles.map((c) => c.id)
  return [...new Set([...carriles, ...[...modulos].sort()])]
}

/** Del bloque 5 (el del kit) al del proyecto, número por número. */
export function moverPuertos(texto, bloque) {
  const de = baseDelBloque(5)
  const a = baseDelBloque(bloque)
  const mapa = new Map(Object.keys(de).map((k) => [String(de[k]), String(a[k])]))
  mapa.set('8000', String(a.PUERTO_APP))
  mapa.set('8210', String(a.E2E_PORT))
  return texto.replace(/\b(5532\d|8000|8210)\b/g, (n) => mapa.get(n) ?? n)
}

const comillas = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/** Todas las sustituciones, como funciones por archivo. Puro: recibe y devuelve texto. */
export function reemplazos({
  slug,
  nombre,
  descripcion,
  bloque,
  scopes,
  funciones,
  cssSemilla,
  conf,
}) {
  const p = baseDelBloque(bloque)
  const r = {
    'piloto.config': (t) =>
      Object.entries(conf).reduce(
        (acc, [k, v]) => acc.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`),
        t,
      ),
    'supabase/config.toml': (t) =>
      moverPuertos(t, bloque).replace(/^project_id = ".*"$/m, `project_id = "${slug}"`),
    '.github/workflows/ci.yml': (t) =>
      t
        .replace(
          / semilla-a-repo reemplaza \{\{API_PORT\}\}[\s\S]*?con PILOTO_FUNCIONES\./,
          ` Puertos del bloque ${bloque}.`,
        )
        .replaceAll('{{API_PORT}}', String(p.SUPABASE_API_PORT))
        .replaceAll('{{DB_PORT}}', String(p.SUPABASE_DB_PORT))
        .replaceAll('{{FUNCIONES}}', funciones),
    '.github/acciones/pila/action.yml': (t) =>
      t
        .replace(
          / semilla-a-repo reemplaza \{\{PUERTOS_PILA\}\}[^.]*\./,
          ` Puertos del bloque ${bloque}.`,
        )
        .replaceAll(
          '{{PUERTOS_PILA}}',
          `${p.SUPABASE_DB_SHADOW_PORT}-${p.SUPABASE_EDGE_RUNTIME_INSPECTOR_PORT}`,
        ),
    'AGENTS.md': (t) =>
      t
        .replaceAll('{{NOMBRE}}', nombre)
        .replaceAll('{{DESCRIPCION}}', descripcion)
        .replaceAll('{{SCOPES}}', scopes.join(', ')),
    'commitlint.config.mjs': (t) =>
      t.replace(/^(\s*)\/\/ \{\{SCOPES_MODULOS\}\}$/m, (_, sangria) =>
        scopes.map((s) => `${sangria}'${s}',`).join('\n'),
      ),
    'src/shared/config/app.ts': (t) => {
      const raiz = bloqueDe(cssSemilla, ':root')
      const oscuro = bloqueDe(cssSemilla, '.dark')
      return t
        .replace(
          /^\/\/ La identidad de la app\..*$/m,
          '// La identidad de la app: el nombre y la descripción de la semilla (docs/semilla/semilla.md).',
        )
        .replace("'{{NOMBRE}}'", `'${comillas(nombre)}'`)
        .replace(/^export const DESCRIPCION_APP = '\{\{DESCRIPCION\}\}'$/m, () => {
          // Como lo deja prettier: en una línea si cabe en printWidth, si no, el valor en la siguiente.
          const una = `export const DESCRIPCION_APP = '${comillas(descripcion)}'`
          return una.length <= ANCHO
            ? una
            : `export const DESCRIPCION_APP =\n  '${comillas(descripcion)}'`
        })
        .replace(/COLOR_TEMA = '.*'/, `COLOR_TEMA = '${valorDe(raiz, '--color-primario')}'`)
        .replace(
          /COLOR_FONDO_CLARO = '.*'/,
          `COLOR_FONDO_CLARO = '${valorDe(raiz, '--color-paper')}'`,
        )
        .replace(
          /COLOR_FONDO_OSCURO = '.*'/,
          `COLOR_FONDO_OSCURO = '${valorDe(oscuro, '--color-paper')}'`,
        )
    },
    'design/tokens.css': (t) => {
      const lineas = t.split('\n')
      const i = lineas.findIndex((l) => l.includes('semilla:inicio'))
      const j = lineas.findIndex((l) => l.includes('semilla:fin'))
      exigir(
        i >= 0 && j > i,
        'design/tokens.css del kit no tiene las marcas semilla:inicio y semilla:fin',
      )
      // Del comentario de inicio se conserva hasta su cierre; del de fin, desde su apertura.
      const fin = lineas.findIndex((l, k) => k > i && l.includes('*/'))
      const ini = lineas.findLastIndex((l, k) => k < j && l.startsWith('/*'))
      return [
        ...lineas.slice(0, i),
        ' * semilla:inicio — el sistema de diseño de la semilla (docs/semilla/semilla.md › Sistema de diseño). Se cambia en la semilla.',
        ...lineas.slice(i + 1, fin + 1).filter((l) => /^\s*\*\s*=+|\*\//.test(l)),
        '',
        cssSemilla,
        '',
        ...lineas.slice(ini),
      ].join('\n')
    },
    'package.json': (t) => {
      const j = JSON.parse(t)
      j.name = slug
      // Los scripts del generador no viajan (scripts/kit/ tampoco).
      delete j.scripts?.['kit:nuevo']
      delete j.scripts?.['test:generador']
      return JSON.stringify(j, null, 2) + '\n'
    },
  }
  for (const f of CON_NOMBRE)
    r[f] = (t) => t.replaceAll('{{NOMBRE}}', nombre).replaceAll('cambiar-slug', slug)
  for (const f of CON_PUERTOS) if (!r[f]) r[f] = (t) => moverPuertos(t, bloque)
  const readme = r['README.md']
  r['README.md'] = (t) =>
    readme(t).replaceAll('{{NOMBRE}}', nombre).replaceAll('{{DESCRIPCION}}', descripcion)
  return r
}

/** Lo que se revisa por marcadores sueltos: todo lo que viaja menos la semilla, docs/KIT.md (que los documenta) y lo binario. */
const seRevisa = (f) =>
  f !== 'docs/KIT.md' &&
  f !== 'docs/semilla' &&
  !f.startsWith('docs/semilla/') &&
  !/\.(png|jpg|ico|woff2?|tgz)$/.test(f)

/** Los marcadores que quedarían sin reemplazar, `archivo: marcador`, de un mapa archivo → texto. Puro. */
export function marcadoresSueltos(textos) {
  const quedan = []
  for (const [f, t] of Object.entries(textos))
    for (const m of MARCADORES) if (t.includes(m)) quedan.push(`${f}: ${m}`)
  return quedan
}

/** Los docs que salen de la semilla. */
export function docsDerivados(texto, version) {
  const cabecera = (titulo) =>
    `# ${titulo}\n\n> Generado desde \`docs/semilla/semilla.md\` (versión ${version}). No se edita a mano: el cambio va en la semilla, que sube de versión.\n\n`
  const out = {}
  for (const [archivo, titulo, sec] of [
    ['docs/UX.md', 'Experiencia', 'Experiencia'],
    ['docs/GLOSARIO.md', 'Glosario', 'Glosario'],
    ['docs/RENDIMIENTO.md', 'Escala y rendimiento', 'Escala y rendimiento'],
  ]) {
    const cuerpo = seccion(texto, sec)
    exigir(cuerpo, `la semilla no tiene la sección «${sec}» (sale de ahí ${archivo})`)
    out[archivo] = cabecera(titulo) + cuerpo + '\n'
  }
  return out
}

function archivosDelKit() {
  const git = spawnSync(
    'git',
    ['-C', KIT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
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
        })(KIT)
  return lista.filter((f) => !NO_VIAJA.some((re) => re.test(f)) && existsSync(join(KIT, f)))
}

export function crear(
  carpetaSemilla,
  destino,
  { bloque, validador, enSeco = false, listaProyectos } = {},
) {
  carpetaSemilla = resolve(carpetaSemilla)
  destino = resolve(destino)
  exigir(
    !existsSync(destino) || readdirSync(destino).length === 0,
    `${destino} ya existe y no está vacía`,
  )

  // 1. La semilla, validada: el validador de idea-a-semilla y el del coordinador.
  validador ??= join(dirname(carpetaSemilla), '_herramientas/validar_semilla.py')
  exigir(existsSync(validador), `no está el validador (${validador}): pásalo con --validador`)
  const v = spawnSync('python3', [validador, carpetaSemilla], { encoding: 'utf8' })
  exigir(v.status === 0, `la semilla no pasa el validador:\n${(v.stdout + v.stderr).trim()}`)
  const texto = leerSemilla(carpetaSemilla)
  const fm = frontmatter(texto)
  const plan = leerPlan(readFileSync(join(carpetaSemilla, 'plan.yaml'), 'utf8'))
  const delPlan = problemasDelPlan(plan)
  exigir(
    delPlan.length === 0,
    `el plan no corre en paralelo sin choques:\n- ${delPlan.join('\n- ')}`,
  )

  const slug = String(fm.slug ?? '')
  exigir(
    /^[a-z][a-z0-9-]{1,30}$/.test(slug),
    `el slug «${slug}» no sirve: minúsculas, números y guiones, de 2 a 31`,
  )
  const nombre = String(fm.nombre ?? slug)
  const vision = seccion(texto, 'Visión y alcance') ?? ''
  const descripcion = String(
    fm.descripcion ?? vision.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? nombre,
  )
    .replace(/[*_`]/g, '')
    .replace(/\s*\((?:[A-Z]{1,3}\d+(?:,\s*)?)+\)/g, '') // los IDs del registro no van en la descripción de la app
    .trim()
    .slice(0, 200)
  const cssKit = (() => {
    const t = readFileSync(join(KIT, 'design/tokens.css'), 'utf8')
    return t.slice(t.indexOf('semilla:inicio'), t.indexOf('semilla:fin'))
  })()
  const cssSemilla = cssDeLaSemilla(texto)
  const delCss = problemasDelCss(cssSemilla, cssKit)
  exigir(
    delCss.length === 0,
    `el sistema de diseño no cumple el contrato del kit:\n- ${delCss.join('\n- ')}`,
  )

  bloque = Number(bloque ?? bloqueLibre(listaProyectos))
  baseDelBloque(bloque) // falla si el bloque no vale
  const funciones = Array.isArray(fm.funciones_edge)
    ? fm.funciones_edge.join(' ')
    : String(fm.funciones_edge ?? '')
  const carrilesMax = Math.min(Number(fm.carriles_max ?? 3), plan.carriles.length)
  const conf = {
    PROYECTO: slug,
    PILOTO_BLOQUE: bloque,
    CARRILES_MAX: carrilesMax,
    PILOTO_AUTO_MIN: Number(fm.piloto_auto_min ?? 5),
    PILOTO_FUNCIONES: `"${funciones}"`,
    COORD_TOPE_PCT: Number(fm.tope_cuota?.ventana_5h_pct ?? 100),
  }
  const scopes = scopesDelPlan(plan)
  const derivados = docsDerivados(texto, fm.version ?? 1)
  const r = reemplazos({ slug, nombre, descripcion, bloque, scopes, funciones, cssSemilla, conf })
  const resumen = {
    destino,
    slug,
    nombre,
    bloque,
    puertos: baseDelBloque(bloque),
    carriles: plan.carriles.map((c) => c.id),
    scopes,
    conf,
  }
  if (enSeco) {
    // Los reemplazos en memoria, archivo por archivo: el ensayo dice ya si quedaría un marcador suelto.
    const enMemoria = { ...derivados }
    for (const f of archivosDelKit().filter(seRevisa)) {
      const t = readFileSync(join(KIT, f), 'utf8')
      enMemoria[f] = r[f] ? r[f](t) : t
    }
    const quedan = marcadoresSueltos(enMemoria)
    exigir(quedan.length === 0, `quedarían marcadores sin reemplazar:\n- ${quedan.join('\n- ')}`)
    return { ...resumen, revisados: Object.keys(enMemoria).length, marcadores_sueltos: 0 }
  }

  // 2. La copia del kit.
  mkdirSync(destino, { recursive: true })
  // El proyecto es del dueño: todo se puede escribir, aunque en el kit algo haya quedado de sólo lectura (lo que llega por el
  // puente del escritorio o por `tar` puede venir así). Se conserva el bit de ejecución.
  for (const f of archivosDelKit()) {
    cpSync(join(KIT, f), join(destino, f), { recursive: true })
    chmodSync(join(destino, f), statSync(join(destino, f)).mode | 0o200)
  }

  // 3. Los reemplazos.
  for (const [archivo, fn] of Object.entries(r)) {
    const ruta = join(destino, archivo)
    if (existsSync(ruta)) writeFileSync(ruta, fn(readFileSync(ruta, 'utf8')))
  }

  // 4. La semilla y lo que sale de ella.
  const semillaDst = join(destino, 'docs/semilla')
  mkdirSync(semillaDst, { recursive: true })
  for (const f of ['semilla.md', 'semilla', 'plan.yaml', 'registro.md', 'CHANGELOG.md'])
    if (existsSync(join(carpetaSemilla, f)))
      cpSync(join(carpetaSemilla, f), join(semillaDst, f), { recursive: true })
  for (const [archivo, contenido] of Object.entries(derivados))
    writeFileSync(join(destino, archivo), contenido)
  mkdirSync(join(destino, 'docs/pasos'), { recursive: true })
  writeFileSync(
    join(destino, 'docs/pasos/README.md'),
    '# Notas de los pasos\n\nCada paso del plan escribe aquí, en `docs/pasos/<PASO>/`, su `bitacora.md` y su `decisiones.md`. Nada más edita esta carpeta.\n',
  )

  // 5. Sin marcadores.
  const quedan = marcadoresSueltos(
    Object.fromEntries(
      archivosDelProyecto(destino).map((f) => [f, readFileSync(join(destino, f), 'utf8')]),
    ),
  )
  exigir(quedan.length === 0, `quedaron marcadores sin reemplazar:\n- ${quedan.join('\n- ')}`)

  // 6. El repo y el primer commit (sin hooks: todavía no hay node_modules; la skill corre la verificación después).
  const g = (...a) =>
    execFileSync('git', ['-C', destino, ...a], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  g('init', '-q', '-b', 'main')
  g('add', '-A')
  g(
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-q',
    '-m',
    `chore(kit): arrancar ${slug} desde el kit (semilla v${fm.version ?? 1})`,
  )
  return { ...resumen, commit: g('rev-parse', '--short', 'HEAD').trim() }
}

function archivosDelProyecto(destino) {
  return (function andar(dir, pre = '') {
    return readdirSync(dir).flatMap((n) => {
      const rel = pre + n
      if (
        /^(node_modules|\.git)(\/|$)/.test(rel) ||
        rel === 'docs/semilla' ||
        rel.startsWith('docs/semilla/') ||
        rel === 'docs/KIT.md'
      )
        return []
      return statSync(join(dir, n)).isDirectory() ? andar(join(dir, n), rel + '/') : [rel]
    })
  })(destino).filter((f) => !/\.(png|jpg|ico|woff2?|tgz)$/.test(f))
}

function principal(argv) {
  const pos = argv.filter(
    (a, i) => !a.startsWith('--') && !['--bloque', '--validador'].includes(argv[i - 1]),
  )
  const opcion = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined)
  if (pos.length !== 2) {
    console.error(
      'uso: node scripts/kit/nuevo-proyecto.mjs <carpeta de la semilla> <carpeta destino> [--bloque N] [--validador ruta] [--en-seco]',
    )
    process.exit(64)
  }
  try {
    const r = crear(pos[0], pos[1], {
      bloque: opcion('--bloque'),
      validador: opcion('--validador'),
      enSeco: argv.includes('--en-seco'),
    })
    console.log(JSON.stringify(r, null, 2))
  } catch (e) {
    console.error(`nuevo-proyecto: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  principal(process.argv.slice(2))
export { basename }
