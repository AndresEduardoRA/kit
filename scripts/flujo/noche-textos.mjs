// Los textos del issue `noche-roja` (scripts/flujo/noche.mjs): el aviso de una noche en rojo, la spec en que se vuelve a la segunda
// noche seguida y los comentarios de cada noche. Todo puro. Se prueba en noche.test.ts.

export const PREFIJO = '🌙 noche:'
export const TOPE_CAIDOS = 20

/**
 * La lista de caídos con tope: lo que pasa del tope queda en una línea. Puro.
 * @param {string[]} lista  @param {number} [tope]
 */
export function resumirCaidos(lista, tope = TOPE_CAIDOS) {
  if (lista.length <= tope) return lista
  return [
    ...lista.slice(0, tope),
    `… y ${lista.length - tope} más (en los artefactos de la corrida)`,
  ]
}

/** @param {string[]} caidos */
const listaDeCaidos = (caidos) =>
  caidos.length === 0
    ? '- (la corrida no dejó nombres: mira sus artefactos)'
    : resumirCaidos(caidos)
        .map((c) => `- ${c}`)
        .join('\n')

/** @param {string[]} lineas  @param {number} noches */
const cola = (lineas, noches) =>
  `## Noches en rojo\n\n${lineas.join('\n')}\n\n<!-- noches: ${noches} -->\n`

/**
 * El cuerpo del issue mientras es un aviso (una noche en rojo). Puro.
 * @param {{ noches: number, caidos: string[], lineas: string[] }} a
 */
export function cuerpoDeAviso({ noches, caidos, lineas }) {
  return [
    'El e2e completo de la noche cayó en `main`. Si cae otra noche seguida, este issue se vuelve una tarea urgente de la cola (se',
    'arregla si cae dos noches seguidas: `.claude/rules/e2e.md`). Si la próxima noche sale verde, se cierra solo.',
    '',
    '## Caídos',
    '',
    listaDeCaidos(caidos),
    '',
    cola(lineas, noches),
  ].join('\n')
}

/** Los specs de una lista de caídos (`e2e/x.spec.ts:12 › …` → `e2e/x.spec.ts`), sin repetir. Puro. @param {string[]} caidos */
export const specsDe = (caidos) => [
  ...new Set(caidos.flatMap((c) => /^(\S+\.spec\.ts):\d+ › /.exec(c)?.[1] ?? [])),
]

/**
 * El cuerpo del issue cuando pasa a la cola: la spec (el bloque yaml primero: `archivoDeIssue` lo exige) con las noches al final.
 * Puro.
 * @param {{ n: number, noches: number, caidos: string[], lineas: string[], corrida: string }} a
 */
export function cuerpoDeSpec({ n, noches, caidos, lineas, corrida }) {
  const specs = specsDe(caidos)
  const correr = specs.length
    ? `\`pnpm test:e2e ${specs.join(' ')} --project=escritorio\``
    : '`pnpm test:e2e <specs> --project=escritorio` con los specs de `caidos.txt` (en los artefactos de la corrida)'
  return [
    '```yaml',
    'titulo: dejar verdes los e2e que cayeron dos noches seguidas',
    `rama: fix/e2e-noche-${n}`,
    'nivel: normal',
    'effort: high',
    '```',
    '',
    '## Pedido de la persona',
    '',
    '«Un e2e que cae dos noches seguidas se arregla» (`.claude/rules/e2e.md`). Este issue lo abrió el aviso de la noche',
    '(`scripts/flujo/noche.mjs`) y pasó a la cola a la segunda noche seguida en rojo.',
    '',
    '## Objetivo',
    '',
    'Dejar verdes estos specs del e2e completo de la noche:',
    '',
    listaDeCaidos(caidos),
    '',
    '## Decisiones ya tomadas',
    '',
    `- La causa, con evidencia: los artefactos de la corrida (\`gh run download ${corrida}\`; en \`e2e-fallos/<fecha>/\`, la traza, el`,
    '  video y `caidos.txt`). Ni reintentar hasta que pase, ni `.skip` ni `.fixme`.',
    '- Si la causa es ajena al repo (el runner, un servicio de afuera), `RESULTADO: TRABADA —` con la evidencia.',
    '',
    '## Anclajes',
    '',
    'Los specs de arriba y `e2e/soporte/`.',
    '',
    '## Estados no felices',
    '',
    'Una prueba que cae sólo en CI se reproduce con el build de producción (`pnpm test:e2e`, como en la noche) antes de tocarla.',
    '',
    '## Verificación',
    '',
    `${correr} en verde.`,
    '',
    cola(lineas, noches),
  ].join('\n')
}

/**
 * El comentario de una noche en rojo sobre un issue que ya existía. Puro.
 * @param {{ noches: number, enlace: string, caidos: string[], aCola: boolean, enCola?: boolean }} a
 */
export function comentarioDeNoche({ noches, enlace, caidos, aCola, enCola = false }) {
  const cabeza = enCola
    ? `${PREFIJO} el e2e de la noche volvió a caer: ${enlace}`
    : `${PREFIJO} otra noche en rojo (${noches} seguida${noches === 1 ? '' : 's'}): ${enlace}`
  const cierre = enCola
    ? 'La tarea ya está en la cola: su sesión puede leer estos caídos aquí.'
    : aCola
      ? 'Pasa a la cola como tarea urgente: el cuerpo ya es su spec.'
      : 'Si cae otra noche seguida, pasa a la cola como tarea urgente.'
  return `${cabeza}\n\nCaídos:\n\n${listaDeCaidos(caidos)}\n\n${cierre}\n`
}
