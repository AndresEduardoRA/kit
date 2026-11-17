import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { AUTOR, git, LINEAS, TIEMPO } from './juguete'
import { MARCADORES } from './personalizar.mjs'
import { traerArchivo } from './traer-de-proyecto.mjs'
import { conOrigen, leccionesNuevas, sumarLeccion } from './traer-lecciones.mjs'

// Del proyecto al kit (traer-de-proyecto.mjs y traer-lecciones.mjs, la parte determinista de la skill traer-de-proyecto): la mezcla
// doble que conserva los marcadores del kit, las lecciones, una corrida con el gh falso sobre un proyecto de juguete con su squash y
// `comprobar`. Sólo del kit.

const NOMBRE = MARCADORES[0] ?? ''
const valores = { nombre: 'tienda-app', slug: 'tienda', bloque: 6, funciones: '' }
const REVISOR = `Eres el revisor de ${NOMBRE}.\n\nuno\ndos\ntres\ncuatro\ncinco\n`
const raices: string[] = []
afterAll(() => {
  for (const r of raices) rmSync(r, { recursive: true, force: true })
})

describe('traerArchivo', () => {
  it('aplica el cambio del PR sobre el kit y conserva el marcador en lo que el PR no tocó', () => {
    const antes = REVISOR.replace(NOMBRE, 'tienda-app')
    const t = traerArchivo({
      ruta: '.claude/agents/revisor.md',
      kit: REVISOR,
      antes,
      despues: antes.replace('cinco', 'CINCO'),
      valores,
    })
    expect(t).toEqual({ texto: REVISOR.replace('cinco', 'CINCO'), choque: '' })
  })

  it('un cambio en la línea del marcador choca', () => {
    const antes = REVISOR.replace(NOMBRE, 'tienda-app')
    const t = traerArchivo({
      ruta: '.claude/agents/revisor.md',
      kit: REVISOR,
      antes,
      despues: antes.replace('Eres el revisor', 'Eres la revisora atenta'),
      valores,
    })
    expect(t.choque).toBe('el cambio del PR toca líneas con marcadores del kit')
  })
})

describe('traer-lecciones.mjs', () => {
  it('leccionesNuevas da las (kit) y (semilla) nuevas con su sección; sumarLeccion no duplica y crea la sección', () => {
    const antes = '# L\n\n## CI\n\n- Vieja. (kit)\n'
    const despues = `${antes}- Nueva: porque. (kit)\n\n## Para las semillas\n\n- Semilla. (semilla)\n- Mía.\n`
    expect(leccionesNuevas(antes, despues)).toEqual([
      { seccion: 'CI', linea: '- Nueva: porque. (kit)', tipo: 'kit' },
      { seccion: 'Para las semillas', linea: '- Semilla. (semilla)', tipo: 'semilla' },
    ])
    const kit = '# Lecciones\n\n## CI\n\n- Una.\n\n## Otra\n\n- Dos.\n'
    const linea = conOrigen('- Nueva: porque. (kit)', 'tienda-app', '40')
    expect(linea).toBe('- Nueva: porque. (tienda-app, PR #40)')
    const con = sumarLeccion(kit, 'CI', linea)
    expect(con).toBe(
      '# Lecciones\n\n## CI\n\n- Una.\n- Nueva: porque. (tienda-app, PR #40)\n\n## Otra\n\n- Dos.\n',
    )
    expect(sumarLeccion(con, 'CI', '- Nueva: porque. (otro, PR #1)')).toBe(con)
    expect(sumarLeccion(kit, 'Sugerencias de los proyectos', '- S. (x, PR #2)')).toBe(
      `${kit}\n## Sugerencias de los proyectos\n\n- S. (x, PR #2)\n`,
    )
    const conCabecera = '# L\n\n## Sugerencias de los proyectos\n\nLo que subió un proyecto.\n'
    expect(sumarLeccion(conCabecera, 'Sugerencias de los proyectos', '- S. (x, PR #2)')).toBe(
      `${conCabecera}\n- S. (x, PR #2)\n`,
    )
  })
})

const MANIFIESTO = `esquema: proyecto/v1
proyecto: tienda
nombre: Tienda
semilla: null
repos:
  - { rol: app, nombre: tienda-app, github: Cuenta/tienda-app, etapa: construccion, semilla: null, puertos: { bloque: 6 } }
contratos: []
`

function escribir(dir: string, archivos: Record<string, string>) {
  for (const [f, t] of Object.entries(archivos)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true })
    writeFileSync(join(dir, f), t)
  }
}
function commit(dir: string, archivos: Record<string, string>, m: string) {
  escribir(dir, archivos)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', m)
  return git(dir, 'rev-parse', 'HEAD')
}

/** El gh falso que sirve el proyecto como Cuenta/tienda-app desde su repo local: el PR #40 integrado (S) y el #41 abierto. */
function ghFalso(raiz: string, proyecto: string, S: string) {
  const falso = join(raiz, 'gh-falso')
  escribir(falso, {
    'bin/gh': `#!/usr/bin/env bash\nexec node ${resolve('scripts/orquestador/prueba/gh-falso.mjs')} "$@"\n`,
    'estado.json': JSON.stringify({
      repo: 'Otra/otro',
      siguiente: 1,
      siguienteComentario: 1,
      issues: {},
      etiquetas: [],
      prs: {},
      cuentas: ['Cuenta'],
      git: {
        'Cuenta/tienda-app': {
          dir: proyecto,
          prs: [
            { number: 40, estado: 'MERGED', sha: S },
            { number: 41, estado: 'OPEN' },
          ],
        },
      },
    }),
  })
  spawnSync('chmod', ['+x', join(falso, 'bin/gh')])
  return falso
}

/** Un kit de juguete (con su origin/main) y el proyecto tienda-app con el PR #40 integrado (su squash S sobre P). */
function montaje(kitCambia: Record<string, string> = {}) {
  const raiz = mkdtempSync(join(tmpdir(), 'traer-'))
  raices.push(raiz)
  const kit = join(raiz, 'kit')
  const proyecto = join(raiz, 'tienda-app')
  const lecciones = '# Lecciones\n\n## CI\n\n- Una vieja.\n'
  git(tmpdir(), 'init', '-q', '-b', 'main', kit)
  commit(
    kit,
    {
      '.kit/plantilla': 'x\n',
      'scripts/kit/flujo.txt': 'scripts/flujo/*\n.claude/agents/revisor.md\ndocs/LECCIONES.md\n',
      'scripts/flujo/estado.sh': LINEAS,
      '.claude/agents/revisor.md': REVISOR,
      'docs/LECCIONES.md': lecciones,
      'docs/semillas/LECCIONES.md': '# Lecciones para hacer semillas\n\n## GitHub\n\n- Otra.\n',
      ...kitCambia,
    },
    'kit',
  )
  git(kit, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  git(tmpdir(), 'init', '-q', '-b', 'main', proyecto)
  commit(
    proyecto,
    {
      '.proyecto/proyecto.yaml': MANIFIESTO,
      'scripts/flujo/estado.sh': LINEAS,
      '.claude/agents/revisor.md': REVISOR.replace(NOMBRE, 'tienda-app'),
      'docs/LECCIONES.md': `${lecciones}- Sólo de aquí.\n`,
      'src/x.ts': 'export const x = 1\n',
    },
    'P',
  )
  const S = commit(
    proyecto,
    {
      'scripts/flujo/estado.sh': LINEAS.replace('siete', 'SIETE'),
      '.claude/agents/revisor.md': REVISOR.replace(NOMBRE, 'tienda-app').replace('cinco', 'CINCO'),
      'scripts/flujo/nuevo.sh': 'echo tienda-app\n',
      'docs/LECCIONES.md': `${lecciones}- Sólo de aquí.\n- Haz X: porque Y. (kit)\n- Pide Z: porque W. (semilla)\n`,
      'src/x.ts': 'export const x = 2\n',
    },
    'S',
  )
  const falso = ghFalso(raiz, proyecto, S)
  const correr = (...args: string[]) => {
    const r = spawnSync('node', [resolve('scripts/kit/traer-de-proyecto.mjs'), ...args], {
      cwd: kit,
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: `${join(falso, 'bin')}:${process.env['PATH'] ?? ''}`,
        HOME: raiz,
        TMPDIR: raiz,
        GH_FALSO: falso,
        ...AUTOR,
      },
    })
    return { estado: r.status, salida: r.stdout + r.stderr }
  }
  return { raiz, kit, correr, leer: (f: string) => readFileSync(join(kit, f), 'utf8') }
}

it(
  'la CLI › aplica lo de flujo del PR sobre el kit, sube las lecciones, deja fuera src/ y lista lo que falta generalizar',
  () => {
    const m = montaje()
    const r = m.correr('Cuenta/tienda-app', '40')
    expect(r.salida).toContain('traer de Cuenta/tienda-app el PR #40')
    expect(r.estado).toBe(0)
    expect(m.leer('scripts/flujo/estado.sh')).toBe(LINEAS.replace('siete', 'SIETE'))
    expect(m.leer('.claude/agents/revisor.md')).toBe(REVISOR.replace('cinco', 'CINCO'))
    expect(m.leer('scripts/flujo/nuevo.sh')).toBe('echo tienda-app\n')
    expect(existsSync(join(m.kit, 'src/x.ts'))).toBe(false)
    expect(m.leer('docs/LECCIONES.md')).toBe(
      '# Lecciones\n\n## CI\n\n- Una vieja.\n- Haz X: porque Y. (tienda-app, PR #40)\n',
    )
    expect(m.leer('docs/semillas/LECCIONES.md')).toMatch(
      /\n## Sugerencias de los proyectos\n\n- Pide Z: porque W\. \(tienda-app, PR #40\)\n$/,
    )
    expect(r.salida).toContain('· nuevos en el kit (generalízalos) (1):\n  scripts/flujo/nuevo.sh')
    expect(r.salida).toContain(
      '· por generalizar (1):\n  scripts/flujo/nuevo.sh:1: echo tienda-app',
    )

    const queda = m.correr('comprobar', '--nombre', 'tienda-app', '--slug', 'tienda')
    expect(queda.estado).toBe(1)
    expect(queda.salida).toContain('scripts/flujo/nuevo.sh:1: echo tienda-app')
    expect(queda.salida).not.toContain('LECCIONES')
    writeFileSync(join(m.kit, 'scripts/flujo/nuevo.sh'), `echo ${NOMBRE}\n`)
    expect(m.correr('comprobar', '--nombre', 'tienda-app', '--slug', 'tienda').estado).toBe(0)
  },
  TIEMPO,
)

it(
  'la CLI › un choque deja las tres versiones y sale con 3; un PR sin integrar sale con 1',
  () => {
    const m = montaje({ 'scripts/flujo/estado.sh': LINEAS.replace('siete', 'Siete') })
    const r = m.correr('Cuenta/tienda-app', '40')
    expect(r.estado).toBe(3)
    expect(r.salida).toContain('scripts/flujo/estado.sh: el cambio del PR choca con el kit')
    const carpeta = readdirSync(m.raiz).find((n) => n.startsWith('traer-tienda-app-40-')) ?? ''
    expect(r.salida).toContain(`quedaron en ${join(m.raiz, carpeta)}`)
    const copias = join(m.raiz, carpeta)
    for (const lado of ['antes', 'despues', 'kit'])
      expect(existsSync(join(copias, lado, 'scripts/flujo/estado.sh')), lado).toBe(true)
    expect(m.leer('scripts/flujo/estado.sh')).toBe(LINEAS.replace('siete', 'Siete'))

    const abierto = m.correr('Cuenta/tienda-app', '41')
    expect(abierto.estado).toBe(1)
    expect(abierto.salida).toContain('el PR #41 de Cuenta/tienda-app no está integrado')
    expect(m.correr('tienda-app', '40').estado).toBe(64)
  },
  TIEMPO,
)
