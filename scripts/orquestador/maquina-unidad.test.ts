import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// maquina.sh por partes, cargado solo con un HOME temporal y un `log` falso: maquina.env, los turnos y la pausa compartida.
// El escenario completo, con dos orquestadores, está en maquina.test.ts.
const MAQUINA = resolve('scripts/orquestador/maquina.sh')
const raices: string[] = []
afterAll(() => {
  for (const r of raices) rmSync(r, { recursive: true, force: true })
})

function casa() {
  const h = mkdtempSync(join(tmpdir(), 'orq-casa-'))
  raices.push(h)
  return h
}

function bash(home: string, script: string) {
  const r = spawnSync(
    'bash',
    [
      '-c',
      `set -u; PROYECTO=prueba; ID=T1; log() { echo "LOG $*"; }; source "${MAQUINA}"; ${script}`,
    ],
    { encoding: 'utf8', env: { NODE_ENV: 'test', HOME: home, PATH: process.env['PATH'] ?? '' } },
  )
  return { estado: r.status, salida: (r.stdout + r.stderr).trim() }
}

const maquinaEnv = (home: string) => join(home, '.config/orquestador/maquina.env')
function turnos(home: string, texto: string) {
  mkdirSync(join(home, '.config/orquestador'), { recursive: true })
  writeFileSync(maquinaEnv(home), texto)
  return bash(home, 'leer_turnos; echo "$TURNOS|$TURNOS_AVISO"').salida
}

describe('maquina.sh › maquina.env', () => {
  it('sin archivo valen 3 sin aviso, y asegurar_maquina_env lo crea con 3', () => {
    const h = casa()
    expect(bash(h, 'leer_turnos; echo "$TURNOS|$TURNOS_AVISO"').salida).toBe('3|')
    expect(bash(h, 'asegurar_maquina_env').salida).toBe(
      '✓ creé ~/.config/orquestador/maquina.env (TURNOS_MAQUINA=3)',
    )
    expect(readFileSync(maquinaEnv(h), 'utf8')).toContain('\nTURNOS_MAQUINA=3\n')
    expect(bash(h, 'asegurar_maquina_env').salida).toBe('')
  })

  it('un número de 1 a 99 vale (con comillas o comentario); lo demás usa 3 y avisa', () => {
    const h = casa()
    expect(turnos(h, 'TURNOS_MAQUINA="2"\n')).toBe('2|')
    expect(turnos(h, 'TURNOS_MAQUINA=12 # dos proyectos\n')).toBe('12|')
    for (const malo of ['cero', '0', 'abc', '100']) {
      expect(turnos(h, `TURNOS_MAQUINA=${malo}\n`)).toBe(
        `3|~/.config/orquestador/maquina.env: TURNOS_MAQUINA=«${malo}» no es un número de 1 a 99: uso 3.`,
      )
    }
  })
})

describe('maquina.sh › los turnos', () => {
  it('con un turno, un segundo proceso no lo toma mientras el primero lo tiene; al salir el primero, sí', () => {
    const h = casa()
    turnos(h, 'TURNOS_MAQUINA=1\n')
    const listo = join(h, 'listo')
    const primero = spawnSync(
      'bash',
      [
        '-c',
        `PROYECTO=prueba; ID=T1; source "${MAQUINA}"; tomar_turno || exit 9; touch "${listo}"
         ( source "${MAQUINA}"; ID=T2; tomar_turno; echo "segundo: $? $(turnos_libres) $(turnos_ocupados_por)" ) 9>&-`,
      ],
      { encoding: 'utf8', env: { NODE_ENV: 'test', HOME: h, PATH: process.env['PATH'] ?? '' } },
    )
    expect(primero.status).toBe(0)
    expect(existsSync(listo)).toBe(true)
    expect(primero.stdout.trim()).toBe('segundo: 1 0 prueba T1')
    expect(bash(h, 'tomar_turno; echo "$? $TURNO"').salida).toBe('0 1')
  })
})
