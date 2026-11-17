import { expect, it } from 'vitest'
import { cuerpo, escenario, TIEMPO } from './prueba/escenario'

// `al_integrar: etiquetar <nombre>` (al-integrar.sh): al integrarse la tarea, el orquestador crea la etiqueta sobre el padre del
// commit integrado (main justo antes del PR), sin pisar una que ya exista, y reintenta en el espejo si GitHub falla. Con el gh falso
// (prueba/escenario.ts).

const A = 'a'.repeat(40) // el último commit de main antes del PR
const B = 'b'.repeat(40) // el squash del PR
const C = 'c'.repeat(40) // otro commit

/** T12 pide la etiqueta y T11 no; las dos con su PR integrado y su issue cerrado, listas para que el espejo las integre. */
function conDosIntegradas(
  gh: (g: ReturnType<ReturnType<typeof escenario>['gh']>) => void = () => {},
) {
  const t = escenario()
  t.issue(11, cuerpo('feat/once'))
  t.issue(12, cuerpo('feat/doce', 'al_integrar: etiquetar semilla-v1\n'))
  t.orq('espejo')
  for (const [id, pr] of [
    ['T11', '39'],
    ['T12', '40'],
  ] as const) {
    t.ponerEst(id, 'estado', 'esperando_ci')
    t.ponerEst(id, 'pr', pr)
  }
  t.cambiarGh((g) => {
    g.issues[11]!.state = 'closed'
    g.issues[12]!.state = 'closed'
    g.prs['Cuenta/tienda-app'] = [
      { number: 39, rama: 'feat/once', estado: 'MERGED', sha: C, padre: A },
      { number: 40, rama: 'feat/doce', estado: 'MERGED', sha: B, padre: A },
    ]
    gh(g)
  })
  return t
}

const posts = (t: ReturnType<typeof escenario>) =>
  t.llamadas().filter((l) => l.args.includes('repos/{owner}/{repo}/git/refs'))

it(
  'al integrar › crea la etiqueta sobre el último commit de main antes del PR, una sola vez; sin al_integrar no llama',
  () => {
    const t = conDosIntegradas()
    t.orq('espejo')
    expect(t.est('T12', 'estado')).toBe('integrado')
    expect(t.gh().refs).toEqual([{ ref: 'refs/tags/semilla-v1', sha: A }])
    expect(t.est('T12', 'al_integrar')).toBe('hecha')
    expect(t.gh().issues[12]!.comentarios.at(-1)!.body).toContain(
      'etiqueté `semilla-v1` sobre aaaaaaa, el último commit de main antes del PR #40 ✓',
    )
    t.ponerEst('T12', 'al_integrar_intento', '0')
    t.orq('espejo')
    expect(posts(t)).toHaveLength(1)
    expect(t.est('T11', 'estado')).toBe('integrado')
    expect(t.est('T11', 'al_integrar')).toBe('')
    expect(t.llamadas().some((l) => l.args.some((a) => a.endsWith('/pulls/39')))).toBe(false)
  },
  TIEMPO,
)

it(
  'al integrar › una etiqueta que ya existe en otro commit no se pisa y se avisa; en el mismo, queda hecha sin aviso',
  () => {
    const t = conDosIntegradas((g) => {
      g.refs = [
        { ref: 'refs/tags/semilla-v10', sha: A },
        { ref: 'refs/tags/semilla-v1', sha: C },
      ]
    })
    t.orq('espejo')
    expect(posts(t)).toHaveLength(0)
    expect(t.gh().refs).toHaveLength(2)
    expect(t.est('T12', 'al_integrar')).toBe('ya-existia')
    expect(t.log()).toContain('AVISO · T12: la etiqueta semilla-v1 ya existe')
    expect(t.gh().issues[12]!.comentarios.at(-1)!.body).toContain(
      'la etiqueta `semilla-v1` ya existe sobre ccccccc: no la piso. La que tocaba: aaaaaaa',
    )
    expect(t.orq('plan').salida).toContain('T12  integrado · la etiqueta ya existía: no se pisó')

    const u = conDosIntegradas((g) => {
      g.refs = [{ ref: 'refs/tags/semilla-v1', sha: A }]
    })
    u.orq('espejo')
    expect(u.est('T12', 'al_integrar')).toBe('hecha')
    expect(posts(u)).toHaveLength(0)
    expect(u.log()).not.toContain('AVISO · T12: la etiqueta')
  },
  TIEMPO,
)

it(
  'al integrar › si GitHub falla queda pendiente y el espejo la reintenta; a los 5 fallos, fallida con el comando a mano',
  () => {
    const t = conDosIntegradas((g) => {
      g.refsFalla = 'HTTP 500: Internal Server Error'
    })
    t.orq('espejo')
    expect(t.est('T12', 'al_integrar')).toBe('pendiente')
    expect(t.est('T12', 'al_integrar_fallos')).toBe('1')
    expect(t.log()).toContain('T12: no pude etiquetar semilla-v1 (intento 1 de 5)')
    expect(t.orq('plan').salida).toContain(
      'T12  integrado · falta al integrar: etiquetar semilla-v1',
    )
    // Antes de la espera no se reintenta.
    t.orq('espejo')
    expect(t.est('T12', 'al_integrar_fallos')).toBe('1')
    t.cambiarGh((g) => {
      delete g.refsFalla
    })
    t.ponerEst('T12', 'al_integrar_intento', '0')
    t.orq('espejo')
    expect(t.est('T12', 'al_integrar')).toBe('hecha')
    expect(t.gh().refs).toEqual([{ ref: 'refs/tags/semilla-v1', sha: A }])

    const u = conDosIntegradas((g) => {
      g.refsFalla = 'HTTP 500: Internal Server Error'
    })
    u.orq('espejo')
    for (let i = 0; i < 4; i++) {
      u.ponerEst('T12', 'al_integrar_intento', '0')
      u.orq('espejo')
    }
    expect(u.est('T12', 'al_integrar')).toBe('fallida')
    expect(u.log()).toContain(
      `gh api -X POST repos/Cuenta/tienda-app/git/refs -f ref=refs/tags/semilla-v1 -f sha=${A}`,
    )
    expect(u.orq('plan').salida).toContain('· no se pudo al integrar: etiquetar semilla-v1')
    u.ponerEst('T12', 'al_integrar_intento', '0')
    u.orq('espejo')
    expect(u.est('T12', 'al_integrar_fallos')).toBe('5')
  },
  TIEMPO * 2,
)
