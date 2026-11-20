import { expect, it } from 'vitest'
import { cuerpo, escenario, TIEMPO } from './prueba/escenario'

// Un e2e que cae también en main (ajeno-de-main.sh, README.md › «Un e2e roto en main»), con el gh falso (prueba/escenario.ts): una
// sesión de arreglo que termina en AJENO crea una sola tarea urgente, la tarea queda esperando y, al integrarse la urgente, se pone al
// día con main sin abrir otra sesión.
const SPEC = 'e2e/menu-de-la-fila.spec.ts'
const AJENO = `RESULTADO: AJENO — ${SPEC}:281 [movil] — cae igual sobre origin/main; la rama no lo toca`
const LISTO_ROJO = {
  __typename: 'CheckRun',
  name: 'Listo · todo en verde',
  conclusion: 'FAILURE',
  detailsUrl: '',
}

type T = ReturnType<typeof escenario>

/** Dos tareas con su PR en rojo: T7 y T8 (el espejo las trae de sus issues). */
function conDosEnRojo(): T {
  const t = escenario()
  t.issue(7, cuerpo('feat/siete'))
  t.issue(8, cuerpo('feat/ocho'))
  t.orq('espejo')
  t.cambiarGh((g) => {
    g.prs['Cuenta/tienda-app'] = [
      { number: 70, rama: 'feat/siete', estado: 'OPEN', sha: 'aaa', checks: [LISTO_ROJO] },
      { number: 80, rama: 'feat/ocho', estado: 'OPEN', sha: 'bbb', checks: [LISTO_ROJO] },
    ]
  })
  for (const [id, pr] of [
    ['T7', '70'],
    ['T8', '80'],
  ] as const) {
    t.ponerEst(id, 'estado', 'corriendo')
    t.ponerEst(id, 'previo', 'por_arreglar')
    t.ponerEst(id, 'pr', pr)
    t.ponerEst(id, 'arreglos', '1')
  }
  return t
}

/** Lo que pasa al terminar una sesión de arreglo de `id` con esa última línea. */
const terminar = (t: T, id: string, linea: string) =>
  t.funciones(
    `ID=${id}; PREVIO=por_arreglar; RAMA=x; WT=/no-existe; RESULTADO_TEXTO=$(printf 'listo\\n%s\\n' "$LINEA"); token_gh; despues_de_la_sesion`.replace(
      '"$LINEA"',
      JSON.stringify(linea),
    ),
  )

const urgentes = (t: T) =>
  Object.values(t.gh().issues).filter((i) => i.labels.includes('cola:urgente'))

it(
  'ajeno › una sesión que termina en AJENO crea una sola urgente para dos tareas con el mismo spec, y ellas esperan',
  () => {
    const t = conDosEnRojo()
    expect(terminar(t, 'T7', AJENO).estado).toBe(0)
    const [u] = urgentes(t)
    expect(urgentes(t)).toHaveLength(1)
    expect(u?.title).toBe(`dejar verde ${SPEC}:281 en main`)
    expect(u?.labels).toEqual(expect.arrayContaining(['cola', 'cola:urgente']))
    expect(u?.body).toContain('rama: fix/e2e-main-menu-de-la-fila-281')
    expect(u?.body).toContain('conflicto: e2e')
    expect(u?.body).toContain('cae igual sobre origin/main; la rama no lo toca')
    const m = `T${String(u?.number)}`
    // La que lo encontró queda esperando al CI con su espera anotada, sin gastar el intento de arreglo.
    expect(t.est('T7', 'estado')).toBe('esperando_ci')
    expect(t.est('T7', 'espera_a')).toBe(m)
    expect(t.est('T7', 'arreglos')).toBe('0')
    expect(t.log()).toContain(`T7 espera a ${m} (e2e roto en main: ${SPEC})`)

    // La segunda tarea con el mismo spec espera a la misma urgente: no hay otro issue.
    expect(terminar(t, 'T8', AJENO.replace('[movil]', '[escritorio]')).estado).toBe(0)
    expect(urgentes(t)).toHaveLength(1)
    expect(t.est('T8', 'espera_a')).toBe(m)

    // El espejo sube el `depende` al issue de cada una y `plan` dice a quién esperan.
    t.orq('espejo')
    expect(t.spec(t.cola().find((f) => f.startsWith('T7-'))!)).toContain(`depende: ${m}`)
    expect(t.gh().issues[7]?.body).toContain(`depende: ${m}`)
    expect(t.orq('plan').salida).toContain(
      `T7  esperando_ci · espera a ${m} (e2e roto en main: ${SPEC}:281; ${m} está pendiente)`,
    )
  },
  TIEMPO,
)

it(
  'ajeno › mientras la urgente no se integra el rojo no abre sesión; al integrarse, la tarea se pone al día sin sesión',
  () => {
    const t = conDosEnRojo()
    terminar(t, 'T7', AJENO)
    const m = t.est('T7', 'espera_a')

    // Rojo de «Listo» con la urgente sin integrar: sigue esperando (nada de por_arreglar ni de un arreglo gastado).
    t.orq('vigilar')
    expect(t.est('T7', 'estado')).toBe('esperando_ci')
    expect(t.est('T7', 'arreglos')).toBe('0')
    expect(t.est('T8', 'estado')).toBe('corriendo')

    // Una urgente trabada: sigue esperando y `plan` lo dice.
    t.ponerEst(m, 'estado', 'trabada')
    t.orq('vigilar')
    expect(t.est('T7', 'estado')).toBe('esperando_ci')
    expect(t.orq('plan').salida).toContain(`${m} está trabada`)

    // La urgente se integra: la rama se pone al día con main por la API (sin worktree) y el CI vuelve a empezar.
    t.ponerEst(m, 'estado', 'integrado')
    t.orq('vigilar')
    expect(t.gh().prs['Cuenta/tienda-app']?.[0]?.sha).toBe('al-dia-1')
    expect(t.est('T7', 'estado')).toBe('esperando_ci')
    expect(t.est('T7', 'espera_a')).toBe('')
    expect(t.est('T7', 'espera_sha')).toBe('aaa')
    expect(t.est('T7', 'arreglos')).toBe('0')
    expect(t.log()).toContain(
      `T7: ${m} integrada: el PR #70 se puso al día con main sin abrir una sesión`,
    )

    // Recién puesta al día, GitHub todavía puede mostrar el rojo viejo: no abre sesión.
    t.cambiarGh((g) => {
      g.prs['Cuenta/tienda-app']![0]!.sha = 'aaa'
      g.prs['Cuenta/tienda-app']![0]!.checks = [LISTO_ROJO]
    })
    t.orq('vigilar')
    expect(t.est('T7', 'estado')).toBe('esperando_ci')

    // Si después cae otra cosa en la punta nueva, sigue el camino de siempre: una sesión de arreglo.
    t.cambiarGh((g) => {
      g.prs['Cuenta/tienda-app']![0]!.sha = 'al-dia-1'
    })
    t.orq('vigilar')
    expect(t.est('T7', 'estado')).toBe('por_arreglar')
    expect(t.est('T7', 'arreglos')).toBe('1')
  },
  TIEMPO,
)

it(
  'ajeno › un spec que ya arregla otra tarea viva (la de la noche, por ejemplo) se espera sin crear otra',
  () => {
    const t = conDosEnRojo()
    t.issue(
      9,
      `\`\`\`yaml\ntitulo: dejar verde el e2e de la noche\nrama: fix/noche-roja-abc1234\n\`\`\`\n\n## Objetivo\n\n- ${SPEC}:281 [movil]\n`,
      ['cola', 'cola:urgente'],
    )
    t.orq('espejo')
    expect(terminar(t, 'T7', AJENO).estado).toBe(0)
    expect(t.est('T7', 'espera_a')).toBe('T9')
    expect(urgentes(t)).toHaveLength(1)
  },
  TIEMPO,
)

it(
  'ajeno › sin red al crear la urgente la tarea queda esperando y la vuelta siguiente la crea',
  () => {
    const t = conDosEnRojo()
    t.cambiarGh((g) => {
      g.sinRed = true
    })
    expect(terminar(t, 'T7', AJENO).estado).toBe(0)
    expect(t.est('T7', 'estado')).toBe('esperando_ci')
    expect(t.est('T7', 'espera_a')).toBe('')
    expect(t.est('T7', 'ajeno_spec')).toBe(`${SPEC}:281`)
    expect(urgentes(t)).toHaveLength(0)

    t.cambiarGh((g) => {
      g.sinRed = false
    })
    t.orq('vigilar')
    expect(urgentes(t)).toHaveLength(1)
    expect(t.est('T7', 'espera_a')).toBe(`T${String(urgentes(t)[0]?.number)}`)
    expect(t.est('T7', 'estado')).toBe('esperando_ci')
  },
  TIEMPO,
)

it(
  'ajeno › un AJENO sin spec y línea válidos, o fuera de un arreglo, se trata como trabada',
  () => {
    const t = conDosEnRojo()
    terminar(t, 'T7', 'RESULTADO: AJENO — el menú de la fila — cae en main')
    expect(t.est('T7', 'estado')).toBe('trabada')
    expect(t.est('T7', 'trabada.md')).toContain('sin «<spec>:<línea>» válido')
    expect(t.log()).toContain('T7 trabada')
    expect(urgentes(t)).toHaveLength(0)

    const fuera = t.funciones(
      `ID=T8; PREVIO=por_retomar; RAMA=x; WT=/no-existe; RESULTADO_TEXTO='${AJENO}'; token_gh; despues_de_la_sesion`,
    )
    expect(fuera.estado).toBe(0)
    expect(t.est('T8', 'estado')).toBe('trabada')
    expect(urgentes(t)).toHaveLength(0)
  },
  TIEMPO,
)

it(
  'ajeno › una tarea no espera más de MAX_AJENOS veces: a la siguiente, trabada',
  () => {
    const t = conDosEnRojo()
    t.ponerEst('T7', 'ajenos', '3')
    terminar(t, 'T7', AJENO)
    expect(t.est('T7', 'estado')).toBe('trabada')
    expect(urgentes(t)).toHaveLength(0)
  },
  TIEMPO,
)
