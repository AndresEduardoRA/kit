import { execFileSync, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  empujarAlOrigen,
  esperar,
  headDe,
  lanzarGuion,
  leer,
  logDe,
  type Maquina,
  maquina,
  matarTodo,
  orq,
  type Repo,
  repo,
  sesiones,
  tarea,
  TIEMPO,
  vivo,
} from './prueba/maquina'

// El orquestador se pone al día solo (al-dia.sh): la principal detrás de origin/main avanza con --ff-only y, si cambió
// scripts/orquestador/, el bucle se relanza sin soltar su candado; con cambios o en otra rama, no la toca. Repos de prueba con su
// origen bare (prueba/maquina.ts): nada sale a la red.
let m: Maquina | undefined
afterEach(() => {
  if (m) matarTodo(m)
  m = undefined
})

/** ponerse_al_dia de al-dia.sh, solo, sobre la principal de `r`: su código de salida. */
function ponerseAlDia(r: Repo) {
  const p = spawnSync(
    'bash',
    [
      '-c',
      `REPO="${r.ruta}"; EST="${r.datos}/estado"; mkdir -p "$EST"; log() { echo "LOG $*"; }
       source "${resolve('scripts/orquestador/al-dia.sh')}"; ponerse_al_dia`,
    ],
    { encoding: 'utf8' },
  )
  return { estado: p.status, salida: p.stdout + p.stderr }
}

it(
  'principal detrás de origin/main: avanza y, si cambió scripts/orquestador/, se relanza sin soltar su candado',
  async () => {
    m = maquina()
    const a = repo(m, 'uno')
    tarea(a, 'T1')
    const pid = lanzarGuion(a, { CLAUDE_FALSO_DUERME: '20' })
    // Con una sesión en curso: el hijo comparte el candado del bucle, y el relanzado no tiene que chocar con él.
    expect(await esperar(() => sesiones(m!).length === 1)).toBe(true)
    const nuevo = empujarAlOrigen(
      a,
      'scripts/orquestador/config.env',
      `${leer(join(a.ruta, 'scripts/orquestador/config.env'))}# una línea nueva\n`,
    )
    expect(await esperar(() => /me relanzo[\s\S]*orquestador arriba/.test(logDe(a)))).toBe(true)
    expect(headDe(a)).toBe(nuevo)
    expect(vivo(pid)).toBe(true)
    expect(leer(join(a.datos, 'bucle.err'))).not.toContain('Ya hay un orquestador')
    expect(logDe(a).match(/orquestador arriba/g)).toHaveLength(2)
  },
  TIEMPO,
)

it(
  'la principal puesta al día a mano (ya no hay nada que traer) con otro scripts/orquestador/: igual se relanza',
  async () => {
    m = maquina()
    const a = repo(m, 'uno')
    tarea(a, 'T1')
    const pid = lanzarGuion(a, { CLAUDE_FALSO_DUERME: '20' })
    expect(await esperar(() => sesiones(m!).length === 1)).toBe(true)
    // Alguien commitea en la principal y empuja: origin/main y la principal quedan iguales, y ponerse_al_dia no trae nada.
    const config = join(a.ruta, 'scripts/orquestador/config.env')
    writeFileSync(config, `${leer(config)}# una línea nueva\n`)
    const conAutor = ['-c', 'user.name=prueba', '-c', 'user.email=prueba@ejemplo.invalid']
    execFileSync('git', ['-C', a.ruta, ...conAutor, 'commit', '-qam', 'a mano'])
    execFileSync('git', ['-C', a.ruta, 'push', '-q', 'origin', 'main'])
    expect(await esperar(() => /me relanzo[\s\S]*orquestador arriba/.test(logDe(a)))).toBe(true)
    expect(vivo(pid)).toBe(true)
    expect(logDe(a)).not.toContain('la principal se puso al día')
    expect(logDe(a).match(/orquestador arriba/g)).toHaveLength(2)
  },
  TIEMPO,
)

it('un cambio de main fuera de scripts/orquestador/ avanza la principal sin relanzar', () => {
  m = maquina()
  const a = repo(m, 'uno')
  const nuevo = empujarAlOrigen(a, 'README.md', '# uno\n')
  const r = ponerseAlDia(a)
  expect(r.estado).toBe(0)
  expect(r.salida).toContain('LOG la principal se puso al día con origin/main')
  expect(headDe(a)).toBe(nuevo)
  expect(ponerseAlDia(a)).toEqual({ estado: 0, salida: '' })
})

it('con cambios sin commitear o en otra rama, la principal no se toca y plan lo dice', () => {
  m = maquina()
  const a = repo(m, 'uno')
  const antes = headDe(a)
  empujarAlOrigen(a, 'scripts/orquestador/config.env', '# otra\n')
  writeFileSync(join(a.ruta, 'nota.txt'), 'a medias\n')
  expect(ponerseAlDia(a).salida).toContain('la principal tiene cambios sin commitear')
  expect(headDe(a)).toBe(antes)
  expect(orq(a, {}, 'plan').salida).toContain(
    '· la principal tiene cambios sin commitear: el orquestador no la pone al día',
  )

  execFileSync('git', ['-C', a.ruta, 'clean', '-qf'])
  execFileSync('git', ['-C', a.ruta, 'switch', '-q', '-c', 'otra'])
  expect(ponerseAlDia(a).estado).toBe(0)
  expect(headDe(a)).toBe(antes)
  expect(orq(a, {}, 'plan').salida).toContain(
    '· la principal está en «otra», no en main: el orquestador no la pone al día',
  )
})
