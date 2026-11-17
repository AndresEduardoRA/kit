// Lo que el generador cambia en la copia del kit para un repo del proyecto (docs/KIT.md › «Lo que el generador reemplaza»): los
// marcadores, los puertos del bloque, los tokens de la semilla y los docs que nacen de ella. Todo puro: texto adentro, texto afuera.
// Se prueba en `nuevo-proyecto.test.mjs`.
import { baseDelBloque } from '../lib/stack-local.mjs'
import { exigir } from './problema.mjs'
import { bloqueDe, seccion, valorDe } from './semilla.mjs'

// Los archivos donde están los números del bloque 5 (el del kit) que pasan al bloque del repo.
export const CON_PUERTOS = [
  'supabase/config.toml',
  'playwright.config.ts',
  '.env.example',
  'README.md',
]
export const MARCADORES = [
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
// Los archivos del flujo (vienen de calesa-app) que nombran al repo: `{{NOMBRE}}` en la prosa y `cambiar-slug-app` en lo que es un
// identificador (el servicio del orquestador, su tema de ntfy; PROYECTO de config.env va vacío: sale del manifiesto). Sólo esos: los
// `{{ID}}`, `{{RAMA}}`… de los prompts los reemplaza el orquestador.
export const CON_NOMBRE = [
  '.claude/agents/revisor.md',
  '.claude/skills/entregar/SKILL.md',
  '.claude/skills/feature/SKILL.md',
  '.claude/skills/revisar/SKILL.md',
  'scripts/orquestador/README.md',
  'scripts/orquestador/prompts/tarea.md',
  'scripts/orquestador/prompts/arreglar.md',
  'scripts/orquestador/prompts/planificar.md',
  'scripts/orquestador/prompts/redactar.md',
]
// El ancho de prettier del kit (.prettierrc): DESCRIPCION_APP queda como la dejaría prettier.
const ANCHO = 100

/** Los scopes de commit: los módulos (`src/modules/<x>/`) que nombra el plan del repo (carriles y pasos). Puro. */
export function scopesDelPlan(plan) {
  const modulos = new Set()
  for (const ruta of [
    ...(plan?.carriles ?? []).flatMap((c) => c.dueno_de ?? []),
    ...(plan?.pasos ?? []).flatMap((p) => p.modulos ?? []),
  ]) {
    const m = /^src\/modules\/([a-z0-9-]+)\//.exec(ruta)
    if (m) modulos.add(m[1])
  }
  return [...modulos].sort()
}

/** Del bloque 5 (el del kit) al del repo, número por número. Puro. */
export function moverPuertos(texto, bloque) {
  const de = baseDelBloque(5)
  const a = baseDelBloque(bloque)
  const mapa = new Map(Object.keys(de).map((k) => [String(de[k]), String(a[k])]))
  mapa.set('8000', String(a.PUERTO_APP))
  mapa.set('8210', String(a.E2E_PORT))
  return texto.replace(/\b(5532\d|8000|8210)\b/g, (n) => mapa.get(n) ?? n)
}

const comillas = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/**
 * Todas las sustituciones de un repo, como funciones por archivo. Puro.
 * @param {{ slug: string, rol: string, nombreProyecto: string, descripcion: string, bloque: number, scopes: string[],
 *   funciones: string, cssSemilla: string }} r
 */
export function reemplazos({
  slug,
  rol,
  nombreProyecto,
  descripcion,
  bloque,
  scopes,
  funciones,
  cssSemilla,
}) {
  const nombre = `${slug}-${rol}`
  const p = baseDelBloque(bloque)
  const conNombre = (t) =>
    t
      .replaceAll('{{NOMBRE}}', nombre)
      .replaceAll('cambiar-slug-app', nombre)
      .replaceAll('cambiar-slug', slug)
  const r = {
    // Las funciones edge que los e2e exigen servidas: una por línea, tras los comentarios del archivo.
    'e2e/funciones.txt': (t) =>
      funciones ? `${t.trimEnd()}\n${funciones.split(/\s+/).join('\n')}\n` : t,
    // project_id = el nombre del repo: los contenedores se llaman supabase_*_<project_id> y con el slug solo app y web chocan.
    'supabase/config.toml': (t) =>
      moverPuertos(t, bloque).replace(/^project_id = ".*"$/m, `project_id = "${nombre}"`),
    '.github/workflows/ci.yml': (t) =>
      t
        .replace(
          / semilla-a-repo reemplaza \{\{API_PORT\}\}[\s\S]*?con e2e\/funciones\.txt\./,
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
      conNombre(t)
        .replaceAll('{{DESCRIPCION}}', descripcion)
        .replaceAll('{{SCOPES}}', scopes.join(', ') || 'ninguno todavía'),
    'commitlint.config.mjs': (t) =>
      t.replace(/^(\s*)\/\/ \{\{SCOPES_MODULOS\}\}$/m, (_, sangria) =>
        scopes.map((s) => `${sangria}'${s}',`).join('\n'),
      ),
    // NOMBRE_APP es el nombre del proyecto («Turnero»), el que ve quien usa la PWA o la web; el del repo es para GitHub y servicios.
    'src/shared/config/app.ts': (t) => {
      const raiz = bloqueDe(cssSemilla, ':root')
      const oscuro = bloqueDe(cssSemilla, '.dark')
      return t
        .replace(
          /^\/\/ La identidad de la app\..*$/m,
          '// La identidad de la app: el nombre del proyecto (docs/semilla/comun.md) y la descripción de este repo (semilla.md).',
        )
        .replace("'{{NOMBRE}}'", `'${comillas(nombreProyecto)}'`)
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
        ' * semilla:inicio — el sistema de diseño del proyecto (docs/semilla/comun.md › Marca y sistema de diseño).',
        ...lineas.slice(i + 1, fin + 1).filter((l) => /^\s*\*\s*=+|\*\//.test(l)),
        '',
        cssSemilla,
        '',
        ...lineas.slice(ini),
      ].join('\n')
    },
    'package.json': (t) => {
      const j = JSON.parse(t)
      j.name = nombre
      // Los scripts del generador y de la publicación no viajan (scripts/kit/ tampoco).
      for (const s of Object.keys(j.scripts ?? {}))
        if (s.startsWith('kit:') || s === 'test:generador') delete j.scripts[s]
      return JSON.stringify(j, null, 2) + '\n'
    },
  }
  for (const f of CON_NOMBRE) r[f] = conNombre
  for (const f of CON_PUERTOS) if (!r[f]) r[f] = (t) => moverPuertos(t, bloque)
  const readme = r['README.md']
  r['README.md'] = (t) => conNombre(readme(t)).replaceAll('{{DESCRIPCION}}', descripcion)
  return r
}

/** Lo que se revisa por marcadores sueltos: lo que viaja menos la semilla, docs/KIT.md (que los documenta) y lo binario. */
export const seRevisa = (f) =>
  f !== 'docs/KIT.md' && !f.startsWith('docs/semilla/') && !/\.(png|jpg|ico|woff2?|tgz)$/.test(f)

/** Los marcadores que quedarían sin reemplazar, `archivo: marcador`, de un mapa archivo → texto. Puro. */
export function marcadoresSueltos(textos) {
  const quedan = []
  for (const [f, t] of Object.entries(textos))
    for (const m of MARCADORES) if (t.includes(m)) quedan.push(`${f}: ${m}`)
  return quedan
}

/**
 * Los docs que nacen de la semilla: UX y RENDIMIENTO de la del repo, GLOSARIO de lo común. Se editan con cada cambio, como los de
 * cualquier repo (docs/FLUJO.md › «Docs: qué se toca»): la cabecera dice de dónde nacieron, nunca «no se edita a mano». Puro.
 * @param {{ repo: string, comun: string, versionRepo: number, versionComun: number }} entrada  los textos de la semilla
 */
export function docsDerivados({ repo, comun, versionRepo, versionComun }) {
  const out = {}
  for (const [archivo, titulo, texto, origen, version, cuando] of [
    [
      'docs/UX.md',
      'Experiencia',
      repo,
      'docs/semilla/semilla.md',
      versionRepo,
      'cada cambio de una pantalla, su recorrido o sus estados',
    ],
    [
      'docs/RENDIMIENTO.md',
      'Escala y rendimiento',
      repo,
      'docs/semilla/semilla.md',
      versionRepo,
      'cada tope, índice o presupuesto que cambia',
    ],
    [
      'docs/GLOSARIO.md',
      'Glosario',
      comun,
      'docs/semilla/comun.md',
      versionComun,
      'cada término nuevo, con ese nombre en tipos, tablas y UI',
    ],
  ]) {
    const cuerpo = seccion(texto, titulo)
    exigir(cuerpo, `la semilla no tiene la sección «${titulo}» (de ahí sale ${archivo})`)
    out[archivo] =
      `# ${titulo}\n\n> Nació de la semilla v${version} (\`${origen}\` › ${titulo}). Se edita con ${cuando} ` +
      `(\`docs/FLUJO.md\` › «Docs: qué se toca»).\n\n${cuerpo}\n`
  }
  return out
}
