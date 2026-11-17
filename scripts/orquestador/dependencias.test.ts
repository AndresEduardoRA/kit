import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
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

// La tarea de dependencias (README.md › «La tarea mensual de dependencias»): una spec con `permite: dependencias` corre su sesión con
// ORQ_PERMITE=dependencias (el hook de Bash lo lee) y su prompt dice qué puede cambiar; las demás, con ORQ_PERMITE vacío aunque el
// servicio lo tenga. Con el guion real, un repo con su origen y un `claude` falso (prueba/maquina.ts).
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
