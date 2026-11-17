import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { cuerpo, escenario } from './prueba/escenario'
import {
  estado,
  leer,
  type Maquina,
  maquina,
  matarTodo,
  orq,
  repo,
  tarea,
  TIEMPO,
} from './prueba/maquina'

// La tarea de dependencias (README.md › «La tarea mensual de dependencias»): el espejo la crea una vez al mes con `cola` y `deps` (con
// un gh falso, prueba/escenario.ts), y una spec con `permite: dependencias` corre su sesión con ORQ_PERMITE=dependencias (el hook de
// Bash lo lee) y su prompt dice qué puede cambiar; las demás, con ORQ_PERMITE vacío aunque el servicio lo tenga (con el guion real,
// un repo con su origen y un `claude` falso, prueba/maquina.ts).
let m: Maquina | undefined
afterEach(() => {
  if (m) matarTodo(m)
  m = undefined
})

it(
  'una tarea con «permite: dependencias» le da ORQ_PERMITE=dependencias a claude; una sin permite, ORQ_PERMITE vacío',
  () => {
    m = maquina()
    const r = repo(m, 'uno')
    tarea(r, 'T1', 'permite: dependencias\n')
    tarea(r, 'T2')
    const args = join(m.raiz, 'args.log')
    orq(r, { CLAUDE_FALSO_ARGS: args }, 'correr', 'T1')
    // El entorno del servicio no se hereda: la sesión de T2 lo recibe vacío.
    orq(r, { CLAUDE_FALSO_ARGS: args, ORQ_PERMITE: 'dependencias' }, 'correr', 'T2')
    expect(estado(r, 'T1')).toBe('trabada')
    expect(estado(r, 'T2')).toBe('trabada')
    const lineas = leer(args).trim().split('\n')
    expect(lineas).toHaveLength(2)
    expect(lineas[0]).toMatch(/^ORQ_PERMITE=dependencias · -p --model sonnet /)
    expect(lineas[1]).toMatch(/^ORQ_PERMITE= · -p --model sonnet /)
  },
  TIEMPO,
)

it(
  'el prompt de una tarea con «permite: dependencias» trae el párrafo del permiso; el de una sin permite, no',
  () => {
    m = maquina()
    const r = repo(m, 'uno')
    tarea(r, 'T1', 'permite: dependencias\n')
    tarea(r, 'T2')
    const con = orq(r, {}, 'prompt', 'T1').salida
    expect(con).toContain('**Esta tarea tiene `permite: dependencias`:**')
    expect(con).toMatch(
      /sin commitear\.\n\n\*\*Esta tarea[\s\S]*para todo lo demás\.\n\n## Al terminar/,
    )
    expect(con).not.toContain('{{PERMITE}}')
    const sin = orq(r, {}, 'prompt', 'T2').salida
    expect(sin).toMatch(/sin commitear\.\n\n## Al terminar/)
    expect(sin).not.toMatch(/\{\{PERMITE\}\}|permite: dependencias/)
  },
  TIEMPO,
)

// El mes de la tarea: el de `date -u +%Y-%m`.
const MES = new Date().toISOString().slice(0, 7)
const mesPasado = () => {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d.toISOString()
}

it(
  'el espejo crea la tarea de dependencias del mes una sola vez, con cola y deps, aunque se pierda la marca local',
  () => {
    const t = escenario('DEPS_MENSUAL="si"\n')
    expect(t.orq('espejo').estado).toBe(0)
    const g = t.gh()
    expect(Object.keys(g.issues)).toEqual(['5'])
    const i = g.issues[5]!
    expect(i.labels).toEqual(['cola', 'deps'])
    expect(i.title).toBe(`actualizar las dependencias dentro de sus rangos (${MES})`)
    expect(i.body).toMatch(/^```yaml\n/)
    for (const linea of [`rama: chore/dependencias-${MES}`, 'nivel: normal', 'effort: high'])
      expect(i.body).toContain(`\n${linea}\n`)
    expect(i.body).toContain('\npermite: dependencias\n```')
    expect(i.body).not.toContain('{{')
    expect(g.etiquetas).toEqual(expect.arrayContaining(['deps', 'pedido', 'noche-roja']))
    expect(t.cola()).toEqual([`T5-dependencias-${MES}.md`])
    expect(t.log()).toContain(`T5: la tarea de dependencias de ${MES}, a la cola`)

    t.orq('espejo')
    expect(Object.keys(t.gh().issues)).toEqual(['5'])
    // Sin la marca del mes, la API dice que ya hay una de este mes.
    rmSync(join(t.datos, 'estado/.deps-mes'))
    t.orq('espejo')
    expect(Object.keys(t.gh().issues)).toEqual(['5'])
  },
  TIEMPO,
)

it(
  'una de dependencias del mes pasado ya cerrada no frena la de este mes; una vieja que sigue abierta, sí',
  () => {
    const cerrada = escenario('DEPS_MENSUAL="si"\n')
    cerrada.issue(4, cuerpo('chore/dependencias-viejo'), ['deps'])
    cerrada.cambiarGh((g) => {
      g.issues[4]!.state = 'closed'
      g.issues[4]!.created_at = mesPasado()
    })
    cerrada.orq('espejo')
    expect(cerrada.gh().issues[5]?.labels).toEqual(['cola', 'deps'])

    const abierta = escenario('DEPS_MENSUAL="si"\n')
    abierta.issue(4, cuerpo('chore/dependencias-viejo'), ['deps'])
    abierta.cambiarGh((g) => {
      g.issues[4]!.created_at = mesPasado()
    })
    abierta.orq('espejo')
    expect(Object.keys(abierta.gh().issues)).toEqual(['4'])
    expect(abierta.cola()).toEqual([])
  },
  TIEMPO,
)
