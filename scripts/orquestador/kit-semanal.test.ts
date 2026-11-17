import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { juguete } from '../kit/juguete'
import { cuerpo, escenario, TIEMPO } from './prueba/escenario'

// La tarea semanal del flujo del kit (kit.sh, README.md › «La tarea semanal del flujo del kit»): el espejo mira una vez por semana si
// `.kit/version` quedó atrás del main del kit (un kit de juguete de dos commits, servido por el gh falso) y, si lo está y no hay un
// issue `kit` abierto, crea la tarea con `cola` y `kit`.

// La semana de la tarea: la de `date -u +%G-W%V`.
const SEMANA = execFileSync('date', ['-u', '+%G-W%V'], { encoding: 'utf8' }).trim()

/** Un repo que salió del kit de juguete en `version` (A: atrás; B: al día), con la tarea semanal encendida. */
function conKit(cual: 'A' | 'B', local = '') {
  const k = juguete()
  return {
    k,
    t: escenario(`KIT_SEMANAL="si"\n${local}`, { conKit: { dir: k.kit, version: k[cual] } }),
  }
}
const alKit = (t: ReturnType<typeof escenario>) =>
  t.llamadas().filter((l) => l.args.some((a) => a.startsWith('repos/AndresEduardoRA/kit/')))

it(
  'atrás › crea la tarea con cola y kit una sola vez, aunque se pierda la marca de la semana mientras siga abierta',
  () => {
    const { k, t } = conKit('A')
    expect(t.orq('espejo').estado).toBe(0)
    const g = t.gh()
    expect(Object.keys(g.issues)).toEqual(['5'])
    const i = g.issues[5]!
    expect(i.labels).toEqual(['cola', 'kit'])
    expect(i.title).toBe(`traer el flujo del kit (${SEMANA})`)
    for (const linea of [
      `rama: chore/flujo-del-kit-${SEMANA.toLowerCase()}`,
      'conflicto: flujo',
      'nivel: normal',
      'effort: high',
    ])
      expect(i.body).toContain(`\n${linea}\n`)
    expect(i.body).not.toContain('{{')
    expect(i.body).toContain('Sólo `node scripts/kit/actualizar.mjs`')
    expect(g.etiquetas).toContain('kit')
    expect(t.cola()).toEqual([`T5-flujo-del-kit-${SEMANA.toLowerCase()}.md`])
    expect(t.log()).toContain(
      `T5: la tarea de traer el flujo del kit (${k.B.slice(0, 7)} · 4 archivos de flujo), a la cola`,
    )

    t.orq('espejo')
    expect(Object.keys(t.gh().issues)).toEqual(['5'])
    // Sin la marca de la semana, el issue `kit` abierto alcanza: no se mira el kit ni se crea otra.
    rmSync(join(t.datos, 'estado/.kit-semana'))
    const antes = alKit(t).length
    t.orq('espejo')
    expect(Object.keys(t.gh().issues)).toEqual(['5'])
    expect(alKit(t)).toHaveLength(antes)
  },
  TIEMPO,
)

it(
  'un issue kit abierto por alguien sin permiso de escritura › no frena la tarea',
  () => {
    const { t } = conKit('A')
    t.issue(4, cuerpo('chore/otra'), ['kit'])
    t.cambiarGh((g) => {
      g.issues[4]!.autor = 'NONE'
    })
    t.orq('espejo')
    expect(t.gh().issues[5]?.labels).toEqual(['cola', 'kit'])
  },
  TIEMPO,
)

it(
  'al día › no crea nada y marca la semana; el kit que sólo avanzó fuera del flujo, tampoco',
  () => {
    const { t } = conKit('B')
    t.orq('espejo')
    expect(Object.keys(t.gh().issues)).toEqual([])
    expect(t.est('.', '.kit-semana')).toBe(SEMANA)
    expect(t.log()).toContain('el flujo sigue al día con el kit (al día con el kit')

    const fuera = conKit('B')
    fuera.k.escribir(fuera.k.kit, { 'src/x.ts': 'export const x = 9\n' })
    fuera.k.commitear(fuera.k.kit, 'C')
    fuera.t.orq('espejo')
    expect(Object.keys(fuera.t.gh().issues)).toEqual([])
    expect(fuera.t.log()).toContain('al día: el kit avanzó fuera del flujo')
  },
  TIEMPO,
)

it(
  'sin acceso al kit › no crea nada, lo dice en el log, el espejo sigue y no vuelve a mirar hasta el reintento',
  () => {
    const { t } = conKit('A')
    t.cambiarGh((g) => {
      g.git!['AndresEduardoRA/kit']!.sinAcceso = true
    })
    t.issue(7, cuerpo('feat/otra'))
    expect(t.orq('espejo').estado).toBe(0)
    expect(Object.keys(t.gh().issues)).toEqual(['7'])
    expect(t.cola()).toEqual(['T7-otra.md'])
    expect(t.log()).toMatch(
      /✗ no pude mirar el kit: actualizar: sin acceso al kit por GitHub \(AndresEduardoRA\/kit\): HTTP 404.*\(se vuelve a mirar en 6 h\)/,
    )
    expect(t.log()).not.toContain('GitHub no responde')
    const antes = alKit(t).length
    t.orq('espejo')
    expect(alKit(t)).toHaveLength(antes)
    expect(t.est('.', '.kit-semana')).toBe('')
    expect(t.log()).not.toContain('AVISO')
    // Al cuarto fallo seguido (un día), avisa una vez; y sigue intentando.
    for (let n = 0; n < 4; n++) {
      t.ponerEst('.', '.kit-reintento', '0')
      t.orq('espejo')
    }
    expect(t.est('.', '.kit-fallos')).toBe('5')
    expect(t.log().match(/AVISO · no puedo mirar el kit desde hace un día/g)).toHaveLength(1)
  },
  TIEMPO,
)

it(
  'apagada › con KIT_SEMANAL="no" no hay ni una llamada al kit',
  () => {
    const { t } = conKit('A', 'KIT_SEMANAL="no"\n')
    t.orq('espejo')
    expect(alKit(t)).toEqual([])
    expect(Object.keys(t.gh().issues)).toEqual([])
  },
  TIEMPO,
)
