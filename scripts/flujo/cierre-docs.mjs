// Los docs de mantenimiento que escribe el cierre de la construcción (scripts/flujo/cierre.mjs aplicar): DECISIONES desde el registro
// de la semilla, PENDIENTES desde sus «Riesgos y supuestos» y las «Decisiones tomadas sin preguntar» de los PR integrados, y el borrador
// de ESTADO con el molde de calesa-app. Lo que pide criterio queda marcado «completar…» para la sesión del cierre, y `comprobar`
// exige que no quede ninguno. Todo puro (texto adentro, texto afuera) y estable para Prettier. Se prueba en cierre.test.ts.

/** El marcador de lo que completa la sesión del cierre (`comprobar` falla si queda alguno). */
export const COMPLETAR = '«completar'

/** @param {string} s */
const normal = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * El cuerpo bajo un encabezado de nivel 2 a 4 (con un número opcional, `## 12. Riesgos y supuestos`), hasta el siguiente de nivel
 * igual o mayor; '' si no está. Sin distinguir acentos ni mayúsculas. Puro.
 * @param {string} texto  @param {string} titulo
 */
export function seccion(texto, titulo) {
  const lineas = texto.replace(/\r\n/g, '\n').split('\n')
  const quiere = normal(titulo)
  let nivel = 0
  let ini = -1
  for (const [i, l] of lineas.entries()) {
    const h = /^(#{1,6})\s+(.*?)\s*$/.exec(l)
    if (!h) continue
    const n = (h[1] ?? '').length
    if (ini >= 0 && n <= nivel) return lineas.slice(ini, i).join('\n').trim()
    const sinNumero = (h[2] ?? '').replace(/^\d+(\.\d+)*\.?\s+/, '')
    if (ini < 0 && n >= 2 && n <= 4 && normal(sinNumero) === quiere) {
      nivel = n
      ini = i + 1
    }
  }
  return ini < 0 ? '' : lineas.slice(ini).join('\n').trim()
}

const VINETA = /^\s{0,3}(?:[-*]|\d+[.)])\s+(.*)$/
const NINGUNA = /^ningun[oa]?\b/i

/**
 * Las líneas de una sección: cada viñeta (con sus renglones de continuación) o, si no hay viñetas, cada párrafo en una línea. Sin
 * las que dicen «Ninguna…». Puro.
 * @param {string} texto
 */
export function lineasDe(texto) {
  const lineas = texto.replace(/\r\n/g, '\n').split('\n')
  /** @type {string[]} */
  const salida = []
  const conVinetas = lineas.some((l) => VINETA.test(l))
  let actual = ''
  const cerrar = () => {
    if (actual.trim()) salida.push(actual.trim())
    actual = ''
  }
  for (const l of lineas) {
    const v = conVinetas ? VINETA.exec(l) : null
    if (v) {
      cerrar()
      actual = v[1] ?? ''
    } else if (!l.trim()) {
      if (!conVinetas) cerrar()
    } else if (!/^#/.test(l)) actual += `${actual ? ' ' : ''}${l.trim()}`
  }
  cerrar()
  return salida.filter((l) => !NINGUNA.test(l))
}

/**
 * Los IDs del registro que cita una línea entre paréntesis (`(F1)`, `(C2, C3)`, `(C2.1)`), sin repetir. Puro.
 * @param {string} linea
 */
export function idsDe(linea) {
  const ids = new Set()
  for (const m of linea.matchAll(/\(([^)]*)\)/g))
    for (const id of (m[1] ?? '').matchAll(/\b[A-Z]\d+(?:\.\d+)?\b/g)) ids.add(id[0])
  return [...ids]
}

/**
 * Los «Riesgos y supuestos» de lo común y de la semilla del repo, una entrada por viñeta o párrafo, con los IDs que cita. Puro.
 * @param {string} comun  @param {string} semilla
 */
export function riesgosDeLaSemilla(comun, semilla) {
  const vistas = new Set()
  return [comun, semilla]
    .flatMap((t) => lineasDe(seccion(t, 'Riesgos y supuestos')))
    .filter((texto) => !vistas.has(texto) && vistas.add(texto))
    .map((texto) => ({ ids: idsDe(texto), texto }))
}

/**
 * Las «Decisiones tomadas sin preguntar» de los PR integrados, una por línea, con su PR. Puro.
 * @param {{ number: number, title?: string, body?: string | null }[]} prs
 */
export function decisionesDePrs(prs) {
  return [...prs]
    .sort((a, b) => a.number - b.number)
    .flatMap((p) =>
      lineasDe(seccion(p.body ?? '', 'Decisiones tomadas sin preguntar')).map((texto) => ({
        pr: p.number,
        titulo: p.title ?? '',
        texto,
      })),
    )
}

/** Las áreas del registro, por la letra del ID (la plantilla del registro de idea-a-semilla). Una letra desconocida va a «Otras». */
export const AREAS = /** @type {const} */ ([
  ['A', 'Producto'],
  ['R', 'Repos y fronteras'],
  ['K', 'Contratos'],
  ['E', 'Marca y diseño'],
  ['B', 'Funcionalidades'],
  ['C', 'Datos sensibles'],
  ['D', 'Experiencia'],
  ['F', 'Técnico'],
  ['G', 'Operación'],
  ['H', 'Ejecución'],
])

/**
 * Las filas `| ID | Tema | Decisión | Estado | Fuente |` del registro, agrupadas por área en el orden de AREAS (y «Otras» al final);
 * sólo las áreas con alguna fila. Puro.
 * @param {string} registro
 */
export function registroPorArea(registro) {
  /** @type {Map<string, { id: string, tema: string, decision: string }[]>} */
  const por = new Map()
  for (const l of registro.replace(/\r\n/g, '\n').split('\n')) {
    const celdas = l
      .trim()
      .replace(/^\||\|$/g, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, '|'))
    const [id = '', tema = '', decision = ''] = celdas
    if (!/^[A-Z]\d+(\.\d+)?$/.test(id)) continue
    const letra = AREAS.some(([a]) => a === id[0]) ? (id[0] ?? '') : '?'
    por.set(letra, [...(por.get(letra) ?? []), { id, tema, decision }])
  }
  return [...AREAS, /** @type {const} */ (['?', 'Otras'])]
    .filter(([letra]) => por.has(letra))
    .map(([letra, area]) => ({ letra, area, filas: por.get(letra) ?? [] }))
}

/** @param {string} s */
const conPunto = (s) => (/[.!?…»)]$/.test(s) ? s : `${s}.`)

/**
 * Lo que tenía un doc sin su título ni su introducción: desde el primer `## `; '' si no tiene secciones. Puro.
 * @param {string | null | undefined} md
 */
export function sinCabecera(md) {
  const texto = (md ?? '').replace(/\r\n/g, '\n')
  const i = texto.search(/^## /m)
  return i < 0 ? '' : texto.slice(i).trim()
}

/** @param {string[]} partes */
const unir = (partes) => `${partes.filter(Boolean).join('\n\n')}\n`

/**
 * `docs/DECISIONES.md`: el registro de la semilla por área, una viñeta por decisión con su ID, y debajo lo que ya tenía el doc. Puro.
 * @param {{ registro: string, etiqueta: string, existente?: string | null }} p
 */
export function textoDecisiones({ registro, etiqueta, existente }) {
  const areas = registroPorArea(registro).map(
    ({ letra, area, filas }) =>
      `## ${area}${letra === '?' ? '' : ` (${letra})`}\n\n${filas
        .map((f) => `- **${f.id} · ${conPunto(f.tema)}** ${conPunto(f.decision)}`)
        .join('\n')}`,
  )
  return unir([
    '# Decisiones',
    'Las decisiones de diseño **vigentes**, agrupadas por área: lo que una sesión podría deshacer o volver a discutir si no lo supiera. ' +
      'No es un registro: cuando una decisión cambia, se edita o se quita su viñeta (la historia está en git). Las de la semilla ' +
      `conservan su ID; el registro completo, en \`${etiqueta}\` › \`docs/semilla/registro.md\`. Lo que es regla de construcción está ` +
      'en `.claude/rules/*`; el contrato de cada módulo, en su `CLAUDE.md`; las trampas, en `docs/LECCIONES.md`.',
    '**Una decisión nueva** va en su área, en una viñeta: `- **Título corto.** Qué se eligió y por qué (y qué se descartó, si evita reabrirlo).`',
    ...areas,
    sinCabecera(existente),
  ])
}

/**
 * `docs/PENDIENTES.md`: los riesgos y supuestos de la semilla, las decisiones tomadas sin preguntar de los PR (para que la persona
 * las confirme) y debajo las secciones que ya tenía el doc. Puro.
 * @param {{ riesgos: { ids: string[], texto: string }[], decisiones: { pr: number, titulo: string, texto: string }[],
 *   existente?: string | null }} p
 */
export function textoPendientes({ riesgos, decisiones, existente }) {
  const lineasRiesgos = riesgos.length
    ? riesgos.map((r) => `- **[${r.ids.join(', ') || '—'}]** ${r.texto}`)
    : ['- La semilla no trae riesgos ni supuestos.']
  const lineasDecisiones = decisiones.length
    ? decisiones.map((d) => `- **[#${d.pr}]** ${d.texto}${d.titulo ? ` — ${d.titulo}` : ''}`)
    : ['- Ningún PR integrado trae decisiones tomadas sin preguntar.']
  return unir([
    '# Pendientes',
    'Lo que falta, para elegir la próxima actualización. Cada entrada: `- **[id]** qué falta — contexto mínimo y, si la hay, la salida ' +
      'recomendada.` Al cerrar una, se borra su línea (el PR lo cuenta). Lo nuevo que aparezca al trabajar se anota aquí en una ' +
      'línea, en su sección.',
    `## Riesgos y supuestos de la semilla\n\n${lineasRiesgos.join('\n')}`,
    `## Decisiones tomadas sin preguntar (para que la persona las confirme)\n\n${lineasDecisiones.join('\n')}`,
    sinCabecera(existente),
  ])
}

/**
 * El borrador de `docs/ESTADO.md` con el molde de calesa-app: lo que pide criterio queda «completar…» para la sesión. Puro.
 * @param {{ fecha: string, etiqueta: string, modulos: string[] }} p
 */
export function textoEstado({ fecha, etiqueta, modulos }) {
  const funcionando = modulos.length
    ? modulos.map((m) => `- **${m}:** ${COMPLETAR}: qué hace hoy, en una o dos líneas»`)
    : [`- ${COMPLETAR}: qué funciona hoy, por área»`]
  return unir([
    '# Estado',
    [
      '> Cómo está el producto hoy. **60 líneas como máximo.** No es un registro: se edita sólo cuando cambia el estado (algo nuevo',
      '> funcionando, un verde que dejó de serlo). Qué existe en el código lo dice `docs/MAPA.md`; lo que falta, `docs/PENDIENTES.md`;',
      '> cómo se trabaja, `docs/FLUJO.md`. Las versiones anteriores: `git log -p docs/ESTADO.md`.',
    ].join('\n'),
    [
      `**Última actualización:** ${fecha}`,
      `**Estado:** **construcción cerrada; en mantenimiento.** La semilla quedó congelada en la etiqueta \`${etiqueta}\``,
      `(\`git show ${etiqueta}:docs/semilla/semilla.md\`). Desde aquí el repo recibe actualizaciones sueltas: una rama, un PR que se`,
      'integra solo con el CI en verde.',
    ].join('\n'),
    `## Funcionando\n\n${funcionando.join('\n')}`,
    `## Verdes\n\n- ${COMPLETAR}: lo que corrió el nivel 3 del cierre: commit, fecha y números»`,
    `## Al borde\n\n- ${COMPLETAR}: presupuestos de docs/RENDIMIENTO.md a menos del 5 % de su tope, o «nada al borde»»`,
    [
      '## Siguiente',
      '',
      '- **Para la persona:** desplegar y confirmar las decisiones de `docs/PENDIENTES.md` › «Decisiones tomadas sin preguntar».',
      '- **Para una sesión:** lo que la persona pida, o lo de `docs/PENDIENTES.md`.',
    ].join('\n'),
  ])
}

/** La sección de `docs/LECCIONES.md` donde la sesión del cierre anota los huecos de la semilla. */
export const PARA_LAS_SEMILLAS = '## Para las semillas'

/**
 * `docs/LECCIONES.md` con la sección «Para las semillas» al final, si no la tenía. Puro.
 * @param {string} md
 */
export function leccionesConSemillas(md) {
  if (/^## Para las semillas\s*$/m.test(md)) return md
  return unir([
    md.trimEnd(),
    PARA_LAS_SEMILLAS,
    'Lo que la construcción enseñó sobre cómo escribir la semilla, una línea por hueco: `- Haz/Evita X: porque Y; salió de T<n>. (semilla)`. ' +
      'Las terminadas en `(semilla)` llegan a las lecciones de las semillas del kit (`docs/semillas/LECCIONES.md`); un defecto del kit ' +
      'va en su sección, terminado en `(kit)`.',
  ])
}
