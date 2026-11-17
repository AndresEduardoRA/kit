import { afterEach, expect, it } from 'vitest'
import {
  esperar,
  estado,
  lanzarGuion,
  type Maquina,
  maquina,
  matarTodo,
  orq,
  repo,
  sesiones,
  tarea,
  TIEMPO,
  turnosDeLaMaquina,
  vivo,
} from './prueba/maquina'

// Dos orquestadores en la misma máquina (maquina.sh): comparten los turnos de sesión y la pausa por el límite del plan. Con el
// guion real, dos repos, un HOME compartido y un `claude` falso (prueba/maquina.ts).
let m: Maquina | undefined
afterEach(() => {
  if (m) matarTodo(m)
  m = undefined
})

it(
  'dos orquestadores con TURNOS_MAQUINA=1 nunca corren dos sesiones a la vez, y cada nivel llega como su alias',
  async () => {
    m = maquina()
    turnosDeLaMaquina(m, 'TURNOS_MAQUINA=1\n')
    const a = repo(m, 'uno')
    const b = repo(m, 'dos')
    tarea(a, 'T1', 'nivel: capaz\n')
    tarea(a, 'T2')
    tarea(b, 'T1')
    tarea(b, 'T2', 'nivel: rapido\n')
    lanzarGuion(a, {})
    lanzarGuion(b, {})
    const trabadas = () =>
      [a, b].every((r) => ['T1', 'T2'].every((id) => estado(r, id) === 'trabada'))
    expect(await esperar(trabadas, 60_000)).toBe(true)

    const s = sesiones(m).sort((x, y) => x.inicio - y.inicio)
    expect(s).toHaveLength(4)
    for (let i = 1; i < s.length; i++) {
      expect(s[i - 1]!.fin, 'la sesión anterior terminó').not.toBeNull()
      expect(s[i]!.inicio).toBeGreaterThanOrEqual(s[i - 1]!.fin!)
    }
    const modelo = (r: { ruta: string }, id: string) =>
      s.find((x) => x.pwd === `${r.ruta}/.orquestador/worktrees/${id}`)?.modelo
    expect(modelo(a, 'T1')).toBe('opus')
    expect(modelo(a, 'T2')).toBe('sonnet')
    expect(modelo(b, 'T1')).toBe('sonnet')
    expect(modelo(b, 'T2')).toBe('haiku')
  },
  TIEMPO,
)

it(
  'el turno se suelta al matar el hijo, aunque su claude quede huérfano',
  async () => {
    m = maquina()
    turnosDeLaMaquina(m, 'TURNOS_MAQUINA=1\n')
    const a = repo(m, 'uno')
    const b = repo(m, 'dos')
    tarea(a, 'T1')
    tarea(b, 'T1')
    const hijo = lanzarGuion(a, { CLAUDE_FALSO_DUERME: '300' }, 'correr', 'T1')
    expect(await esperar(() => sesiones(m!).length === 1)).toBe(true)
    const plan = orq(b, {}, 'plan').salida
    expect(plan).toContain('dos · turnos de la máquina: 0 de 1 libres · paralelo 3')
    expect(plan).toContain('T1  espera: sin turno en la máquina (1 de 1 ocupados: uno T1)')

    process.kill(hijo, 'SIGKILL')
    expect(await esperar(() => !vivo(hijo))).toBe(true)
    const claude = sesiones(m)[0]!.pid
    expect(vivo(claude)).toBe(true)
    // El claude huérfano sigue durmiendo (300 s): si retuviera el turno, esto no pasaría en 10 s.
    expect(
      await esperar(() => orq(b, {}, 'plan').salida.includes('T1  LISTA para lanzar'), 10_000),
    ).toBe(true)
    expect(vivo(claude)).toBe(true)
  },
  TIEMPO,
)
