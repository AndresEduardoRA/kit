import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { cuerpo, escenario, TIEMPO } from './prueba/escenario'
import { estado, leer, type Maquina, maquina, matarTodo, orq, repo, tarea } from './prueba/maquina'

// Cada corrida de una tarea tiene su TMPDIR (`$TMP_TAREAS/<ID>`, por omisión ~/.cache/orquestador/<PROYECTO>/<ID>): fuera de /tmp,
// vacío al empezar cada corrida y borrado al integrarse la tarea. Lo que las pruebas y las herramientas de una sesión dejan sin
// borrar no se acumula en el tmpfs de la máquina, que comparten todos los proyectos. Con el guion real y un `claude` falso que anota
// su TMPDIR y deja un sobrante (prueba/maquina.ts), y con el gh falso para la integración (prueba/escenario.ts).
let m: Maquina | undefined
afterEach(() => {
  if (m) matarTodo(m)
  m = undefined
})

it(
  'la sesión corre con TMPDIR en la carpeta de la tarea, y la corrida siguiente la encuentra vacía',
  () => {
    m = maquina()
    const r = repo(m, 'uno')
    tarea(r, 'T1')
    const anotado = join(m.raiz, 'tmpdir.log')
    orq(r, { CLAUDE_FALSO_TMPDIR: anotado }, 'correr', 'T1')
    expect(estado(r, 'T1')).toBe('trabada')
    const carpeta = join(m.home, '.cache/orquestador/uno/T1')
    expect(existsSync(join(carpeta, 'sobrante'))).toBe(true)
    orq(r, { CLAUDE_FALSO_TMPDIR: anotado }, 'correr', 'T1')
    expect(leer(anotado).trim().split('\n')).toEqual([`${carpeta} 0`, `${carpeta} 0`])
  },
  TIEMPO,
)

it(
  'TMP_TAREAS en config.local.env cambia dónde cuelgan las carpetas',
  () => {
    m = maquina()
    const otra = join(m.raiz, 'tmp-tareas')
    const r = repo(m, 'uno', `TMP_TAREAS="${otra}"\n`)
    tarea(r, 'T1')
    const anotado = join(m.raiz, 'tmpdir.log')
    orq(r, { CLAUDE_FALSO_TMPDIR: anotado }, 'correr', 'T1')
    expect(leer(anotado).trim()).toBe(`${join(otra, 'T1')} 0`)
  },
  TIEMPO,
)

it(
  'al integrarse la tarea se borra su carpeta temporal; la de otra tarea queda',
  () => {
    const t = escenario()
    t.issue(11, cuerpo('feat/once'))
    t.issue(12, cuerpo('feat/doce'))
    t.orq('espejo')
    t.ponerEst('T11', 'estado', 'esperando_ci')
    t.ponerEst('T11', 'pr', '39')
    t.cambiarGh((g) => {
      g.issues[11]!.state = 'closed'
      g.prs['Cuenta/tienda-app'] = [
        {
          number: 39,
          rama: 'feat/once',
          estado: 'MERGED',
          sha: 'b'.repeat(40),
          padre: 'a'.repeat(40),
        },
      ]
    })
    const base = join(t.datos, '.cache/orquestador/tienda-app')
    for (const id of ['T11', 'T12']) {
      mkdirSync(join(base, id, 'sub'), { recursive: true })
      writeFileSync(join(base, id, 'sub/sobrante'), 'x')
    }
    t.orq('espejo')
    expect(t.est('T11', 'estado')).toBe('integrado')
    expect(existsSync(join(base, 'T11'))).toBe(false)
    expect(existsSync(join(base, 'T12', 'sub/sobrante'))).toBe(true)
  },
  TIEMPO,
)
