// Lo que el generador cambia en la copia del kit para un repo del proyecto (docs/KIT.md › «Lo que el generador reemplaza»): los
// marcadores, los puertos del bloque, los tokens de la semilla y los docs que nacen de ella. Todo puro: texto adentro, texto afuera.
// Se prueba en `nuevo-proyecto.test.mjs`.
import { baseDelBloque } from '../lib/stack-local.mjs'
import { conNombre, personalizacionesDelFlujo } from './personalizar.mjs'
import { exigir } from './problema.mjs'
import { bloqueDe, seccion, valorDe } from './semilla.mjs'

// Lo del flujo vive en personalizar.mjs (viaja a cada proyecto: actualizar.mjs personaliza igual que el generador).
export { CON_NOMBRE, MARCADORES, marcadoresSueltos, seRevisa } from './personalizar.mjs'

// Los archivos donde están los números del bloque 5 (el del kit) que pasan al bloque del repo.
export const CON_PUERTOS = [
  'supabase/config.toml',
  'playwright.config.ts',
  '.env.example',
  'README.md',
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
  const nombrar = (t) => conNombre(t, { nombre, slug })
  const r = {
    // Los archivos del flujo: el nombre del repo y los puertos del bloque en el CI.
    ...personalizacionesDelFlujo({ nombre, slug, bloque, funciones }),
    // Las funciones edge que los e2e exigen servidas: una por línea, tras los comentarios del archivo.
    'e2e/funciones.txt': (t) =>
      funciones ? `${t.trimEnd()}\n${funciones.split(/\s+/).join('\n')}\n` : t,
    // project_id = el nombre del repo: los contenedores se llaman supabase_*_<project_id> y con el slug solo app y web chocan.
    'supabase/config.toml': (t) =>
      moverPuertos(t, bloque).replace(/^project_id = ".*"$/m, `project_id = "${nombre}"`),
    'AGENTS.md': (t) =>
      nombrar(t)
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
      // Los scripts del generador y de la publicación no viajan (lo de scripts/kit/ que no es flujo, tampoco).
      for (const s of Object.keys(j.scripts ?? {}))
        if (s.startsWith('kit:') || s === 'test:generador') delete j.scripts[s]
      return JSON.stringify(j, null, 2) + '\n'
    },
  }
  for (const f of CON_PUERTOS) if (!r[f]) r[f] = (t) => moverPuertos(t, bloque)
  const readme = r['README.md']
  r['README.md'] = (t) => nombrar(readme(t)).replaceAll('{{DESCRIPCION}}', descripcion)
  return r
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
