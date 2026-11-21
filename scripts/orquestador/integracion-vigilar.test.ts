import { expect, it } from 'vitest'
import { cuerpo, escenario, TIEMPO } from './prueba/escenario'

// La vigilancia de los PR (`vigilar_prs`) y la cola de integración (integracion.sh, README.md › «Vigila»), con el gh falso
// (prueba/escenario.ts): sin la cola, la rama atrasada se pone al día por la API, como siempre; si main exige la cola, nadie trae main
// a la rama (el grupo la prueba combinada).

/** T7 esperando al CI con su PR #70 atrasado respecto de main, el CI todavía corriendo. */
function conUnoAtrasado(colaActiva: boolean) {
  const t = escenario()
  t.issue(7, cuerpo('feat/siete'))
  t.orq('espejo')
  t.cambiarGh((g) => {
    g.colaActiva = colaActiva
    g.prs['Cuenta/tienda-app'] = [
      { number: 70, rama: 'feat/siete', estado: 'OPEN', sha: 'aaa', mergeState: 'BEHIND' },
    ]
  })
  t.ponerEst('T7', 'estado', 'esperando_ci')
  t.ponerEst('T7', 'pr', '70')
  return t
}
const puestasAlDia = (t: ReturnType<typeof escenario>) =>
  t.llamadas().filter((l) => l.args.some((a) => a.includes('update-branch')))

it(
  'vigilar › sin la cola de integración, la rama atrasada se pone al día por la API',
  () => {
    const t = conUnoAtrasado(false)
    t.orq('vigilar')
    expect(puestasAlDia(t)).toHaveLength(1)
    expect(t.gh().prs['Cuenta/tienda-app']?.[0]?.sha).toBe('al-dia-1')
    expect(t.log()).toContain('T7: PR #70 puesto al día con main')
  },
  TIEMPO,
)

it(
  'vigilar › con la cola de integración, nadie trae main a la rama atrasada',
  () => {
    const t = conUnoAtrasado(true)
    t.orq('vigilar')
    expect(puestasAlDia(t)).toEqual([])
    expect(t.gh().prs['Cuenta/tienda-app']?.[0]?.sha).toBe('aaa')
    expect(t.est('T7', 'estado')).toBe('esperando_ci')
  },
  TIEMPO,
)
