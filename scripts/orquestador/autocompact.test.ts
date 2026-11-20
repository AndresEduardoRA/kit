import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { escenario } from './prueba/escenario'
import { leer, type Maquina, maquina, matarTodo, orq, repo, tarea, TIEMPO } from './prueba/maquina'

// El tope de contexto de las sesiones (README.md › config.env, AUTOCOMPACT_SESION): `claude -p` recibe `--autocompact <tokens>` si la
// variable vale algo válido y nada si está vacía o es inválida (con el guion real y el `claude` falso, prueba/maquina.ts).
let m: Maquina | undefined
afterEach(() => {
  if (m) matarTodo(m)
  m = undefined
})

/** Los argumentos con los que el claude falso fue llamado en una tarea, con su configuración local. */
function argumentos(local: string, extra = '') {
  m = maquina()
  const r = repo(m, 'uno', local)
  tarea(r, 'T1', extra)
  const args = join(m.raiz, 'args.log')
  orq(r, { CLAUDE_FALSO_ARGS: args }, 'correr', 'T1')
  return leer(args).trim().split('\n')
}

it(
  'la sesión recibe --autocompact 300000 con lo que trae config.env',
  () => {
    const [sesion, ...mas] = argumentos('')
    expect(mas).toEqual([])
    expect(sesion).toContain(' --autocompact 300000 ')
  },
  TIEMPO,
)

it(
  'la sesión del plan recibe el mismo tope',
  () => {
    const lineas = argumentos('', 'planificar: si\n')
    expect(lineas.length).toBeGreaterThanOrEqual(1)
    for (const l of lineas) expect(l).toContain(' --autocompact 300000 ')
  },
  TIEMPO,
)

it(
  'AUTOCOMPACT_SESION cambia el tope; vacío o inválido no pasa el flag',
  () => {
    expect(argumentos('AUTOCOMPACT_SESION=450000\n')[0]).toContain(' --autocompact 450000 ')
    for (const v of ['""', 'mucho', '50000', '2000000']) {
      const [sesion] = argumentos(`AUTOCOMPACT_SESION=${v}\n`)
      expect(sesion).not.toContain('--autocompact')
      matarTodo(m!)
    }
  },
  TIEMPO * 2,
)

it(
  'el prompt nombra su archivo para releerlo tras una compactación',
  () => {
    m = maquina()
    const r = repo(m, 'uno')
    tarea(r, 'T1')
    const p = orq(r, {}, 'prompt', 'T1').salida
    expect(p).toMatch(
      /si se compactó tu contexto, relee la spec y el plan en `[^`]*estado\/T1\/prompt-1-tarea\.md`/,
    )
    expect(p).not.toContain('{{PROMPT}}')
  },
  TIEMPO,
)

it('la redacción de un pedido recibe el tope y su prompt nombra su archivo', () => {
  const t = escenario('', { conOrigen: true })
  t.issue(40, 'Quiero avisos al celular.', ['pedido'])
  const env = {
    CLAUDE_FALSO_MODO: 'trabada',
    CLAUDE_FALSO_DUERME: '0',
    CLAUDE_FALSO_ARGS: join(t.datos, 'claude-args.log'),
    CLAUDE_FALSO_PROMPT: join(t.datos, 'claude-prompt.md'),
    GIT_ALLOW_PROTOCOL: 'file',
  }
  t.orqCon(env, 'redactar', '40')
  expect(leer(join(t.datos, 'claude-args.log'))).toContain(' --autocompact 300000 ')
  expect(leer(join(t.datos, 'claude-prompt.md'))).toMatch(
    /relee el pedido y lo que ya se habló en `[^`]*prompt-1\.md`/,
  )
})
