// La retro del cierre de la construcción (scripts/flujo/cierre.mjs retro) y lo que `comprobar` exige antes del PR. La retro junta, de
// los issues de la cola y los PR integrados, las tareas trabadas, las decisiones tomadas sin preguntar y los pasos partidos o rehechos;
// la sesión clasifica cada línea («→ hueco de la semilla», «→ defecto del kit» o «→ otro»). Todo puro. Se prueba en cierre.test.ts.
import { parse } from 'yaml'
import { COMPLETAR } from './cierre-docs.mjs'

export const CLASES = ['hueco de la semilla', 'defecto del kit', 'otro']
export const CLASIFICAR = '«clasificar: hueco de la semilla / defecto del kit / otro»'
export const DOCS = [
  'docs/ESTADO.md',
  'docs/PENDIENTES.md',
  'docs/DECISIONES.md',
  'docs/LECCIONES.md',
  'docs/FLUJO.md',
]
const MAX_ESTADO = 60
const BOT = '🤖 orquestador: '

/** @param {string} cuerpo */
function yamlDe(cuerpo) {
  const m = /^\s*```ya?ml[ \t]*\n([\s\S]*?)\n?```/.exec(cuerpo)
  try {
    const d = m ? parse(m[1] ?? '') : null
    return d && typeof d === 'object' && !Array.isArray(d)
      ? /** @type {Record<string, unknown>} */ (d)
      : {}
  } catch {
    return {}
  }
}

/**
 * Lo que la retro lee de un issue de la cola y sus comentarios. Puro.
 * @param {{ number: number, title?: string, body?: string | null, labels?: (string | { name: string })[] }} issue
 * @param {{ body?: string | null }[]} comentarios
 */
export function datosDeIssue(issue, comentarios) {
  const cuerpo = (issue.body ?? '').replace(/\r\n/g, '\n')
  const y = yamlDe(cuerpo)
  const textos = comentarios.map((c) => (c.body ?? '').replace(/\r\n/g, '\n'))
  const cuenta = (/** @type {string} */ inicio) =>
    textos.filter((t) => t.startsWith(BOT + inicio)).length
  return {
    numero: issue.number,
    titulo: String(y['titulo'] ?? issue.title ?? ''),
    paso: String(y['paso'] ?? ''),
    etiquetas: (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)),
    trabas: textos
      .filter((t) => t.startsWith(`${BOT}me trabé: `))
      .map((t) =>
        (t.slice(`${BOT}me trabé: `.length).split('\n\n')[0] ?? '').replace(/\s*\n\s*/g, ' '),
      ),
    respuestas: [...cuerpo.matchAll(/^- Respuesta de la persona \([^)]*\): (.*)$/gm)].map(
      (m) => m[1] ?? '',
    ),
    arreglos: cuenta('arreglo el PR'),
    retomas: cuenta('retomo la tarea'),
  }
}

/** @typedef {ReturnType<typeof datosDeIssue>} Tarea */

const terminada = (/** @type {Tarea} */ t) =>
  t.etiquetas.includes('cola:integrada') || t.etiquetas.includes('cola:omitida')

/**
 * Los pasos del plan (`paso:` en su yaml, salvo el cierre) que no están integrados ni omitidos. Puro.
 * @param {Tarea[]} tareas
 */
export const pasosSinTerminar = (tareas) =>
  tareas.filter((t) => t.paso && t.paso !== 'cierre' && !terminada(t))

/** @param {Tarea} t */
const nombre = (t) => `T${t.numero}${t.paso ? ` (${t.paso})` : ''} «${t.titulo}»`

/** @param {Tarea[]} tareas */
function partidos(tareas) {
  /** @type {string[]} */
  const l = []
  for (const t of tareas) {
    if (t.paso === 'cierre') continue
    if (t.paso && t.etiquetas.includes('cola:omitida')) l.push(`${nombre(t)}: se omitió`)
    if (t.arreglos >= 2) l.push(`${nombre(t)}: ${t.arreglos} arreglos del PR`)
    if (t.retomas >= 2) l.push(`${nombre(t)}: ${t.retomas} retomas`)
    if (!t.paso && !t.etiquetas.includes('deps')) l.push(`${nombre(t)}: no estaba en el plan`)
  }
  return l
}

/** @param {string} titulo  @param {string[]} lineas  @param {string} vacio */
const bloque = (titulo, lineas, vacio) =>
  `### ${titulo}\n\n${(lineas.length ? lineas.map((x) => `- ${x} → ${CLASIFICAR}`) : [`- ${vacio}`]).join('\n')}`

/**
 * El borrador de la sección `## Retro` del PR del cierre: tres secciones con una línea por hallazgo, cada una por clasificar. Puro.
 * @param {{ tareas: Tarea[], decisiones: { pr: number, texto: string }[] }} p
 */
export function borradorRetro({ tareas, decisiones }) {
  const trabadas = tareas.flatMap((t) =>
    t.trabas.map((motivo, i) => {
      const r = t.respuestas[i]
      return `${nombre(t)}: ${motivo}${r ? ` · respuesta: ${r}` : ''}`
    }),
  )
  return `${[
    '## Retro',
    'Cada línea lleva su clase al final, después de «→»: `hueco de la semilla`, `defecto del kit` u `otro`. Cada «hueco de la ' +
      'semilla» va además a `docs/LECCIONES.md` › «Para las semillas» como una línea terminada en `(semilla)`, y cada «defecto del ' +
      'kit», a su sección terminada en `(kit)`.',
    bloque('Tareas trabadas', trabadas, 'Ninguna tarea se trabó.'),
    bloque(
      'Decisiones tomadas sin preguntar',
      decisiones.map((d) => `#${d.pr} ${d.texto}`),
      'Ningún PR integrado trae «Decisiones tomadas sin preguntar».',
    ),
    bloque(
      'Pasos partidos o rehechos',
      partidos(tareas),
      'Ninguno: cada paso se hizo una vez, como estaba en el plan.',
    ),
  ].join('\n\n')}\n`
}

/** @param {string} cuerpo */
function problemasDeLaRetro(cuerpo) {
  const retro = /^## Retro\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(cuerpo)
  if (!retro) return ['el cuerpo del PR no trae la sección «## Retro»']
  const p = []
  if (retro[1]?.includes('«clasificar')) p.push('queda «clasificar» en la retro')
  const clase = new RegExp(`→\\s*(${CLASES.join('|')})\\s*\\.?\\s*$`, 'i')
  const sinClase = (retro[1] ?? '')
    .split('\n')
    .filter((l) => /^\s*[-*]\s+/.test(l) && !/^\s*[-*]\s+ning[uú]n/i.test(l) && !clase.test(l))
  if (sinClase.length)
    p.push(
      `la retro tiene ${sinClase.length === 1 ? 'una línea' : `${sinClase.length} líneas`} sin clase (${CLASES.join(' / ')})`,
    )
  return p
}

/**
 * Lo que falta para dar el cierre por listo, un texto por problema ([] si está todo). Puro.
 * @param {{ archivos: Record<string, string | null>, semillaPresente: boolean,
 *   repo: { etapa?: string, semilla?: string | null } | null, etiqueta: string, cuerpo: string }} p
 */
export function problemasDelCierre({ archivos, semillaPresente, repo, etiqueta, cuerpo }) {
  /** @type {string[]} */
  const p = []
  for (const doc of DOCS) {
    const texto = archivos[doc]
    if (texto == null) {
      p.push(`falta ${doc}`)
      continue
    }
    if (texto.includes(COMPLETAR)) p.push(`queda «completar» en ${doc}`)
  }
  const lineas = (archivos['docs/ESTADO.md'] ?? '').replace(/\n$/, '').split('\n').length
  if (archivos['docs/ESTADO.md'] != null && lineas > MAX_ESTADO)
    p.push(`docs/ESTADO.md tiene ${lineas} líneas (máximo ${MAX_ESTADO})`)
  if (semillaPresente) p.push('docs/semilla/ sigue en el repo (cierre.mjs aplicar la saca)')
  if (repo?.etapa !== 'mantenimiento' || repo.semilla !== etiqueta)
    p.push(
      `el repo no está en «etapa: mantenimiento» con «semilla: ${etiqueta}» en .proyecto/proyecto.yaml`,
    )
  return [...p, ...problemasDeLaRetro(cuerpo)]
}
