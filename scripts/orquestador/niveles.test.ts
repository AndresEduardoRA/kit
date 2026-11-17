import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { problemaDeModelo } from './spec-issue.mjs'

// Los niveles de modelo (niveles.sh): una tarea nombra rapido, normal o capaz y config.env dice qué alias es cada uno. Se prueba
// cargando niveles.sh con el config.env real y el `campo` real de orquestador.sh. Ninguna versión de modelo se escribe tal cual
// (la guarda de scripts/guardas marcaría este archivo): se arma en tiempo de ejecución.
const ORQ = resolve('scripts/orquestador')
const VERSION = ['claude', 'opus', '4', '1'].join('-')
const raices: string[] = []
afterAll(() => {
  for (const r of raices) rmSync(r, { recursive: true, force: true })
})

function carpeta() {
  const d = mkdtempSync(join(tmpdir(), 'orq-niveles-'))
  raices.push(d)
  return d
}

/** Corre `script` con config.env, `campo` y niveles.sh cargados; `antes` va después de config.env (para pisar un NIVEL_*). */
function bash(script: string, antes = '') {
  const r = spawnSync(
    'bash',
    [
      '-c',
      `set -u; source "${ORQ}/config.env"; ${antes}
eval "$(sed -n '/^campo() {/,/^}/p' "${ORQ}/orquestador.sh")"; source "${ORQ}/niveles.sh"; ${script}`,
    ],
    {
      encoding: 'utf8',
      env: { NODE_ENV: 'test', HOME: carpeta(), PATH: process.env['PATH'] ?? '' },
    },
  )
  return { estado: r.status, salida: (r.stdout + r.stderr).trim() }
}

/** Una spec con esos campos de frontmatter; devuelve su ruta. */
function spec(campos: string) {
  const f = join(carpeta(), 'T1-x.md')
  writeFileSync(f, `---\nid: T1\ntitulo: x\nrama: feat/x\n${campos}\n---\n\n## Objetivo\n`)
  return f
}

const elegir = (campos: string, sufijo = '', defecto = 'normal') =>
  bash(
    `if elegir_modelo "${spec(campos)}" "${sufijo}" ${defecto}; then echo "$ELEGIDO"; else echo "$MOTIVO_MODELO"; exit 1; fi`,
  )

describe('niveles.sh › de nivel a alias', () => {
  it('cada nivel da el alias de config.env, y sin nada en la spec vale el nivel por defecto', () => {
    expect(
      bash('modelo_de_nivel rapido; modelo_de_nivel normal; modelo_de_nivel capaz').salida,
    ).toBe('haiku\nsonnet\nopus')
    expect(elegir('')).toEqual({ estado: 0, salida: 'sonnet' })
    expect(elegir('', '_plan', 'capaz')).toEqual({ estado: 0, salida: 'opus' })
    expect(elegir('nivel_plan: rapido', '_plan', 'capaz').salida).toBe('haiku')
  })

  it('un alias en «modelo» se respeta, y «nivel» gana sobre «modelo»', () => {
    expect(elegir('modelo: opus').salida).toBe('opus')
    expect(elegir('modelo: opus[1m]').salida).toBe('opus[1m]')
    expect(elegir('modelo: opus\nnivel: rapido').salida).toBe('haiku')
  })

  it('una versión fija o un nivel desconocido no eligen nada y dicen por qué', () => {
    const fija = elegir(`modelo: ${VERSION}\nnivel: capaz`)
    expect(fija.estado).toBe(1)
    expect(fija.salida).toContain('es una versión fija de modelo')
    const turbo = elegir('nivel: turbo')
    expect(turbo).toEqual({ estado: 1, salida: '«nivel: turbo» no es rapido, normal ni capaz' })
  })

  it('la configuración real sólo tiene alias; una versión en NIVEL_CAPAZ se nombra', () => {
    expect(bash('niveles_invalidos').estado).toBe(1)
    const r = bash('niveles_invalidos', `NIVEL_CAPAZ="${VERSION}"; NIVEL_EJECUTAR=turbo`)
    expect(r.estado).toBe(0)
    expect(r.salida).toContain(`NIVEL_CAPAZ=«${VERSION}» es una versión fija de modelo`)
    expect(r.salida).toContain('NIVEL_EJECUTAR=«turbo» no es rapido, normal ni capaz')
    expect(bash('modelos_heredados', 'MODELO_EJECUTAR=sonnet').salida).toBe(
      'MODELO_EJECUTAR ya no se lee: va NIVEL_EJECUTAR=rapido|normal|capaz',
    )
  })
})

describe('niveles.sh y spec-issue.mjs dicen lo mismo', () => {
  it('el mismo veredicto y el mismo texto para cada campo de modelo', () => {
    const casos: [string, string][] = [
      ['modelo', 'sonnet'],
      ['modelo', 'opus[1m]'],
      ['modelo', VERSION],
      ['modelo_plan', ['Opus', '4'].join(' ')],
      ['modelo', 'Opus'],
      ['nivel', 'capaz'],
      ['nivel', 'turbo'],
      ['nivel', 'rapido normal'],
      ['nivel_plan', 'rapido'],
      ['nivel_plan', 'Rapido'],
      ['effort', 'high'],
    ]
    for (const [clave, valor] of casos) {
      const r = bash(`problema_de_modelo ${clave} '${valor}'`)
      const js = problemaDeModelo(clave, valor)
      expect(r.salida, `${clave}: ${valor}`).toBe(js)
      expect(r.estado, `${clave}: ${valor}`).toBe(js ? 1 : 0)
    }
  })
})

describe('niveles.sh › la cola sólo local', () => {
  it('una spec con una versión fija no se lanza: «plan» dice el error', () => {
    const datos = carpeta()
    mkdirSync(join(datos, 'cola'))
    writeFileSync(
      join(datos, 'cola', 'T7-x.md'),
      `---\nid: T7\ntitulo: x\nrama: feat/x\nmodelo: ${VERSION}\n---\n`,
    )
    writeFileSync(
      join(datos, 'cola', 'T8-y.md'),
      '---\nid: T8\ntitulo: y\nrama: feat/y\nnivel: capaz\n---\n',
    )
    const r = spawnSync('bash', [join(ORQ, 'orquestador.sh'), 'plan'], {
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        HOME: datos,
        PATH: process.env['PATH'] ?? '',
        ORQ_DATOS: datos,
        ORQ_SOLO_LOCAL: '1',
      },
    })
    expect(r.stdout).toContain(
      `T7  spec con error: «modelo: ${VERSION}» es una versión fija de modelo`,
    )
    expect(r.stdout).not.toContain('T7  LISTA')
    expect(r.stdout).toContain('T8  LISTA para lanzar')
  })
})

describe('niveles.sh › qué modelo es hoy un alias', () => {
  it('le pregunta al alias y junta lo que dice ser con las claves de modelUsage', () => {
    const bin = carpeta()
    writeFileSync(
      join(bin, 'claude'),
      `#!/usr/bin/env bash\nexec bash ${ORQ}/prueba/claude-falso.sh "$@"\n`,
      { mode: 0o755 },
    )
    const r = spawnSync('bash', ['-c', `source "${ORQ}/niveles.sh"; identidad_de_modelo sonnet`], {
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        CLAUDE_FALSO_MODO: 'identidad',
      },
    })
    expect(r.stdout.trim()).toBe('Soy el modelo falso · modelo-falso')
    expect(r.status).toBe(0)
    const mudo = spawnSync(
      'bash',
      ['-c', `source "${ORQ}/niveles.sh"; identidad_de_modelo sonnet`],
      {
        encoding: 'utf8',
        env: {
          NODE_ENV: 'test',
          PATH: `${bin}:${process.env['PATH'] ?? ''}`,
          CLAUDE_FALSO_MODO: 'limite',
        },
      },
    )
    expect(mudo.status).toBe(1)
  })
})
