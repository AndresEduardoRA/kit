import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
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

// Un preparar.sh que cae a mitad deja `.env.carril` en el worktree: esa letra seguiría contando como usada y las demás tareas verían
// «los tres carriles ocupados» sin que nadie los use. El orquestador suelta el carril (quitar.sh) antes de volver a la cola. Con el
// guion real y stubs de preparar.sh y quitar.sh (prueba/maquina.ts).
let m: Maquina | undefined
afterEach(() => {
  if (m) matarTodo(m)
  m = undefined
})

const AUTOR = ['-c', 'user.name=prueba', '-c', 'user.email=prueba@ejemplo.test']

it(
  'si preparar.sh cae después de escribir .env.carril, se suelta el carril y la tarea vuelve a la cola',
  () => {
    m = maquina()
    const r = repo(m, 'uno')
    const quitado = join(m.raiz, 'quitado.log')
    writeFileSync(
      join(r.ruta, 'scripts/worktree/preparar.sh'),
      'printf "CARRIL=a\\n" > .env.carril\nexit 1\n',
    )
    writeFileSync(
      join(r.ruta, 'scripts/worktree/quitar.sh'),
      `rm -f .env.carril\necho quitado >> ${quitado}\n`,
    )
    execFileSync('git', [...AUTOR, 'commit', '-q', '-am', 'preparar que cae'], { cwd: r.ruta })
    execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: r.ruta })
    tarea(r, 'T1')
    orq(r, {}, 'correr', 'T1')
    expect(estado(r, 'T1')).toBe('pendiente')
    expect(estado(r, 'T1', 'fallos_carril')).toBe('1')
    expect(existsSync(join(r.datos, 'worktrees/T1/.env.carril'))).toBe(false)
    expect(leer(quitado)).toBe('quitado\n')
  },
  TIEMPO,
)
