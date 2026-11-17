// Del plan de cada repo (plan/v2) a las specs de su cola (scripts/orquestador/README.md › «Una tarea»): el orden de todo el proyecto,
// la rama de cada paso, la spec de cada paso y la del cierre. Todo puro: cola.mjs le pone los números que da GitHub y crea los issues.
// Las specs salen como «archivo» (frontmatter + secciones de plantilla-tarea.md) y pasan por `issueDeArchivo` de spec-issue.mjs, que
// las valida y arma el bloque yaml del issue. Se prueba en `plan-a-cola.test.mjs`.
import { exigir } from './problema.mjs'

/** El nodo de una dependencia: `P01` es del mismo repo; `app:P02`, de otro. Puro. */
export const nodoDe = (rol, dep) => (String(dep).includes(':') ? String(dep) : `${rol}:${dep}`)

/**
 * Los pasos de todo el proyecto en orden topológico (Kahn), como `rol:pid`. Entre los que están listos a la vez, primero el orden de
 * `repos` de comun.md y después el del plan: el resultado no depende de nada más. Puro.
 * @param {Record<string, { pasos?: { id: string, depende_de?: string[] }[] }>} planes  @param {string[]} roles
 */
export function ordenDelProyecto(planes, roles) {
  const nodos = []
  const deps = new Map()
  for (const rol of roles)
    for (const p of planes[rol]?.pasos ?? []) {
      const n = `${rol}:${p.id}`
      nodos.push(n)
      deps.set(n, new Set((p.depende_de ?? []).map((d) => nodoDe(rol, d))))
    }
  const prioridad = new Map(nodos.map((n, i) => [n, i]))
  // Una dependencia a un paso que no está en ningún plan saldría en silencio en el `depende` del issue (el validador ya la ataja).
  for (const [n, ds] of deps)
    for (const d of ds)
      exigir(prioridad.has(d), `${n} depende de ${d}, que no es un paso del proyecto`)
  const hechos = new Set()
  const orden = []
  while (orden.length < nodos.length) {
    const listo = nodos.find(
      (n) => !hechos.has(n) && [...(deps.get(n) ?? [])].every((d) => hechos.has(d)),
    )
    exigir(listo, `ciclo de dependencias entre ${nodos.filter((n) => !hechos.has(n)).join(', ')}`)
    hechos.add(listo)
    orden.push(listo)
  }
  return orden
}

// El tipo de la rama por la primera palabra del título; lo demás es feat.
const TIPOS = [
  [/^(arreglar|corregir)\b/, 'fix'],
  [/^documentar\b/, 'docs'],
  [/^(refactorizar|reorganizar)\b/, 'refactor'],
  [/^optimizar\b/, 'perf'],
  [/^probar\b/, 'test'],
]
const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** El tipo de commit de un paso, por la primera palabra de su título. Puro. */
export function tipoDeRama(titulo) {
  const t = sinTildes(String(titulo).trim().toLowerCase())
  return TIPOS.find(([re]) => re.test(t))?.[1] ?? 'feat'
}

/** El tema de la rama: el título sin tildes, en kebab, cortado a 40 caracteres en un guion. Puro. */
export function temaDelTitulo(titulo) {
  const kebab = sinTildes(String(titulo).toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (kebab.length <= 40) return kebab || 'paso'
  const corte = kebab.slice(0, 41).lastIndexOf('-')
  return kebab.slice(0, corte > 0 ? corte : 40)
}

/** La rama de un paso: `<tipo>/<pid en minúscula>-<tema>`. Puro. */
export const ramaDelPaso = (paso) =>
  `${tipoDeRama(paso.titulo)}/${String(paso.id).toLowerCase()}-${temaDelTitulo(paso.titulo)}`

/** si/no de un valor del ruteo: YAML 1.1 (PyYAML) lee «no» como falso; la librería de JS, como texto. Puro. */
export const siNo = (v) => (v === true || v === 'si' || v === 'sí' ? 'si' : 'no')

/** La ruta de Next de un módulo `src/app/…` del paso, sin los grupos `(x)`, o null. Puro. */
function rutaDelModulo(modulo) {
  if (!modulo.startsWith('src/app/') && modulo !== 'src/app') return null
  const partes = modulo
    .slice('src/app'.length)
    .split('/')
    .filter((s) => s && !/^\(.*\)$/.test(s))
  return `/${partes.join('/')}`
}

/** Las pantallas de «Experiencia» que caen bajo un módulo `src/app/…` del paso. Puro. */
export function pantallasDelPaso(paso, pantallas) {
  const rutas = (paso.modulos ?? []).map(rutaDelModulo).filter((r) => r !== null)
  return pantallas.filter((p) =>
    rutas.some((r) => r === '/' || p.ruta === r || p.ruta.startsWith(`${r}/`)),
  )
}

/** La línea del contrato de un paso que lo publica o lo adopta (.claude/rules/contratos.md › «El orden de un cambio»). Puro. */
function lineaDelContrato(paso, slug, proveedorDe) {
  const c = paso.contrato ?? {}
  if (c.provee)
    return (
      `- Este paso publica el contrato \`${c.provee}\`: suma \`provee: [${c.provee}]\` a tu repo en \`.proyecto/proyecto.yaml\` ` +
      'y genera y prueba la versión (`.claude/rules/contratos.md` › «El orden de un cambio»).'
    )
  if (c.consume) {
    const [id, version] = String(c.consume).split('@')
    return (
      `- Este paso adopta el contrato \`${c.consume}\`: copia \`contratos/${id}@${version}.json\` de main de ` +
      `\`${slug}-${proveedorDe(id)}\` a \`.proyecto/contratos/\` y suma \`consume: [${c.consume}]\` a tu repo en ` +
      '`.proyecto/proyecto.yaml` (`.claude/rules/contratos.md` › «El orden de un cambio»).'
    )
  }
  return null
}

/**
 * La spec de un paso, como archivo de la cola. Puro.
 * @param {{ slug: string, rol: string, paso: any, carril?: any, registro: Map<string, { tema: string, decision: string }>,
 *   pantallas: { pantalla: string, ruta: string, rol: string, estados: string }[], versionSemilla: number, depende: string,
 *   proveedorDe?: (id: string) => string }} entrada
 */
export function specDelPaso({
  slug,
  rol,
  paso,
  carril,
  registro,
  pantallas,
  versionSemilla,
  depende,
  proveedorDe = () => '?',
}) {
  const r = paso.ruteo ?? {}
  const fm = [
    ['titulo', paso.titulo],
    ['rama', ramaDelPaso(paso)],
    ['depende', depende],
    ['conflicto', paso.carril],
    ['planificar', siNo(r.planificar)],
    ['nivel', r.nivel],
    ['effort', r.effort],
    ['paso', paso.id],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '')
  const decisiones = (paso.decisiones ?? []).map((id) => {
    const d = registro.get(String(id))
    exigir(d, `${rol}:${paso.id} cita ${id}, que no está en el registro`)
    return `- **${id}** · ${d.tema}: ${d.decision}`
  })
  const contrato = lineaDelContrato(paso, slug, proveedorDe)
  const suyas = pantallasDelPaso(paso, pantallas)
  const estados = suyas.length
    ? suyas.map(
        (p) => `- **${p.pantalla}** (\`${p.ruta}\`${p.rol ? `, ${p.rol}` : ''}): ${p.estados}`,
      )
    : [
        'Este paso no dibuja pantallas: los errores vuelven como valores (`{ ok: false, error }`) y un choque como `PT409` con ' +
          'mensaje humano.',
      ]
  const v = paso.verificacion ?? {}
  const carrilDe = carril?.dueno_de?.length
    ? ` (dueño de ${carril.dueno_de.map((d) => `\`${d}\``).join(', ')})`
    : ''
  const secciones = [
    '## Pedido de la persona',
    `«${paso.titulo}»: paso ${paso.id} del plan de ${slug}-${rol} (semilla v${versionSemilla}, riesgo ${paso.riesgo}).`,
    '## Objetivo',
    `Terminado cuando: ${paso.terminado}.`,
    '## Decisiones ya tomadas',
    [
      ...decisiones,
      '- El resto del producto está en `docs/semilla/`; si falta una decisión, la tarea queda trabada.',
      ...(contrato ? [contrato] : []),
    ].join('\n'),
    '## Anclajes',
    `${(paso.modulos ?? []).map((m) => `\`${m}\``).join(', ')} · carril \`${paso.carril}\`${carrilDe}.`,
    '## Estados no felices',
    estados.join('\n'),
    '## Verificación',
    [
      `\`${v.comando}\` — nivel ${v.nivel} (\`.claude/rules/e2e.md\`).`,
      ...(siNo(r.revisor) === 'si'
        ? [
            'Antes de publicar, la segunda lectura del agente `revisor` sobre el diff, y se atiende lo que encuentre.',
          ]
        : []),
    ].join('\n\n'),
  ]
  return `---\n${fm.map(([k, val]) => `${k}: ${val}`).join('\n')}\n---\n\n${secciones.join('\n\n')}\n`
}

/** La spec del cierre de un repo, desde la plantilla `cerrar-construccion.md`. Puro. */
export function specDelCierre(plantilla, { repo, version, depende }) {
  return plantilla
    .replaceAll('{{REPO}}', repo)
    .replaceAll('{{VERSION}}', String(version))
    .replaceAll('{{DEPENDE}}', depende)
}
