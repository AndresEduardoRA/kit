import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { cuerpo, escenario } from './prueba/escenario'

// Cambiar de máquina (README.md › «Cómo decide»): en una máquina sin estado, una tarea que otra máquina ya publicó se ve `pendiente`.
// El bucle real, con un gh y un claude falsos (prueba/escenario.ts): con su PR abierto la adopta, con su PR integrado la da por
// integrada, y sin GitHub no la lanza a ciegas; en ninguno de los tres se llama a claude. Un PR de esa rama de antes del issue es de
// otra tarea: ahí sí se lanza (y así se ve que la prueba detecta un lanzamiento).
const TIEMPO = 120_000
type Escenario = ReturnType<typeof escenario>

/** Una máquina nueva: el issue #5 lleva `cola:esperando-ci` (lo dejó otra máquina) y aquí no hay nada de T5. */
function maquinaNueva(prs: { number: number; estado: string; creado: string }[] = []) {
  const t = escenario('INTERVALO=1\n', { conOrigen: true })
  t.issue(5, cuerpo('feat/turnos'), ['cola', 'cola:esperando-ci'])
  t.cambiarGh((g) => {
    g.issues[5]!.created_at = '2026-11-01T10:00:00Z'
    g.prs['Cuenta/tienda-app'] = prs.map((p) => ({ ...p, rama: 'feat/turnos' }))
  })
  return t
}

/** Corre el bucle hasta que `listo()` (o 40 s) y `despues` ms más, para ver que no hace nada de más; después lo corta. */
async function bucle(t: Escenario, listo: () => boolean, despues = 3000) {
  const p = spawn('bash', [join(t.repo, 'scripts/orquestador/orquestador.sh')], {
    detached: true,
    stdio: 'ignore',
    env: {
      NODE_ENV: 'test',
      HOME: t.datos,
      PATH: `${join(t.falso, 'bin')}:${process.env['PATH'] ?? ''}`,
      GH_FALSO: t.falso,
      CLAUDE_FALSO_LOG: join(t.datos, 'claude.log'),
      GIT_ALLOW_PROTOCOL: 'file',
    },
  })
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
  try {
    const hasta = Date.now() + 40_000
    while (Date.now() < hasta && !listo()) await espera(300)
    await espera(despues)
  } finally {
    if (p.pid) process.kill(-p.pid, 'SIGKILL')
  }
}
const lanzo = (t: Escenario) =>
  existsSync(join(t.datos, 'estado/orquestador.log')) && t.log().includes('T5: lanzada')
const sinSesion = (t: Escenario) => {
  expect(t.log()).not.toContain('T5: lanzada')
  expect(existsSync(join(t.datos, 'claude.log'))).toBe(false)
}

it(
  'otra máquina › con el PR de su rama abierto la adopta: esperando al CI con ese PR, sin sesión y sin tocarle la etiqueta',
  async () => {
    const t = maquinaNueva([{ number: 40, estado: 'OPEN', creado: '2026-11-02T10:00:00Z' }])
    await bucle(t, () => t.est('T5', 'estado') === 'esperando_ci' || lanzo(t))
    expect(t.est('T5', 'estado')).toBe('esperando_ci')
    expect(t.est('T5', 'pr')).toBe('40')
    sinSesion(t)
    expect(t.log()).toContain('T5: su rama feat/turnos ya tiene el PR #40 abierto')
    const g = t.gh().issues[5]!
    expect(g.labels).toEqual(['cola', 'cola:esperando-ci'])
    expect(g.comentarios.map((c) => c.body)).toEqual([
      '🤖 orquestador: adopté el PR #40 que abrió otra máquina: no lanzo una sesión nueva y sigo su CI desde aquí.\n',
    ])
    // El espejo nunca le escribió etiquetas al issue: ni antes de adoptarla (le habría borrado cola:esperando-ci) ni después.
    const parches = t.llamadas().filter((l) => l.args.includes('PATCH') || l.args[1] === 'edit')
    expect(parches).toEqual([])
  },
  TIEMPO,
)

it(
  'otra máquina › con el PR de su rama integrado queda integrada, sin sesión, y su issue se cierra',
  async () => {
    const t = maquinaNueva([{ number: 41, estado: 'MERGED', creado: '2026-11-02T10:00:00Z' }])
    await bucle(t, () => t.est('T5', 'estado') === 'integrado' || lanzo(t), 1000)
    expect(t.est('T5', 'estado')).toBe('integrado')
    expect(t.est('T5', 'pr')).toBe('41')
    sinSesion(t)
    const g = t.gh().issues[5]!
    expect(g.state).toBe('closed')
    expect(g.labels).toContain('cola:integrada')
  },
  TIEMPO,
)

it(
  'otra máquina › si GitHub no responde, ni la adopta ni la lanza (lo dice una vez y vuelve a mirar)',
  async () => {
    const t = maquinaNueva()
    expect(t.orq('espejo').estado).toBe(0)
    expect(t.cola()).toEqual(['T5-turnos.md'])
    t.cambiarGh((g) => {
      g.sinRed = true
    })
    const aviso = 'T5: no pude preguntarle a GitHub si otra máquina ya publicó su PR'
    await bucle(
      t,
      () => existsSync(join(t.datos, 'estado/orquestador.log')) && t.log().includes(aviso),
    )
    expect(t.est('T5', 'estado')).toBe('')
    expect(t.est('T5', 'pr')).toBe('')
    sinSesion(t)
    expect(t.log().split(aviso)).toHaveLength(2)
  },
  TIEMPO,
)

it(
  'otra máquina › un PR integrado de esa rama de antes del issue es de otra tarea: la lanza',
  async () => {
    const t = maquinaNueva([{ number: 12, estado: 'MERGED', creado: '2026-10-01T10:00:00Z' }])
    await bucle(t, () => lanzo(t), 0)
    expect(lanzo(t)).toBe(true)
    expect(t.est('T5', 'pr')).toBe('')
  },
  TIEMPO,
)

it(
  'otra máquina › «verificar» avisa (sin fallar por eso) de las tareas en curso según su issue que aquí no tienen estado',
  () => {
    const t = escenario()
    t.issue(5, cuerpo('feat/uno'), ['cola', 'cola:corriendo'])
    t.issue(6, cuerpo('feat/dos'), ['cola', 'cola:esperando-ci'])
    t.issue(7, cuerpo('feat/tres'), ['cola', 'cola:esperando-ci'])
    t.issue(8, cuerpo('feat/cuatro'), ['cola', 'cola:trabada'])
    t.ponerEst('T7', 'estado', 'esperando_ci')
    const salida = t.orq('verificar').salida
    expect(salida).toContain(
      '⚠ T5 T6 en curso según su issue y sin estado aquí: ¿corre este orquestador en otra máquina? páralo allí antes de encenderlo aquí',
    )
    expect(salida).not.toMatch(/✗ .*otra máquina/)
  },
  TIEMPO,
)
