import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll } from 'vitest'
import { MARCADORES } from './personalizar.mjs'

// Un kit de juguete (un repo de git con dos commits, A y B) y el proyecto «tienda-app» que salió de A, con cambios propios; y un `gh`
// falso (scripts/orquestador/prueba/gh-falso.mjs) que sirve el kit como `imandresalpiri/kit` desde ese repo local. Para las pruebas
// de actualizar.mjs. Los marcadores salen de MARCADORES, nunca escritos a mano: lo que viaja se revisa por marcadores sueltos.
const raices: string[] = []
afterAll(() => {
  for (const r of raices)
    rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

export const TIEMPO = 60_000
export const KIT = 'imandresalpiri/kit'
// En el CI git no tiene autor: cada commit lleva el suyo.
export const AUTOR = {
  GIT_AUTHOR_NAME: 'prueba',
  GIT_AUTHOR_EMAIL: 'prueba@ejemplo.test',
  GIT_COMMITTER_NAME: 'prueba',
  GIT_COMMITTER_EMAIL: 'prueba@ejemplo.test',
}
const NOMBRE = MARCADORES[0] ?? ''
export const LINEAS = 'uno\ndos\ntres\ncuatro\ncinco\nseis\nsiete\n'
const MANIFIESTO = `esquema: proyecto/v1
proyecto: tienda
nombre: Tienda
semilla: null
repos:
  - { rol: app, nombre: tienda-app, github: Cuenta/tienda-app, etapa: construccion, semilla: null, puertos: { bloque: 6 } }
contratos: []
`

/** Lo del kit en A: lo que el proyecto trae del flujo y algo del producto (src/), que nunca se trae. */
const KIT_A: Record<string, string> = {
  'scripts/kit/flujo.txt':
    '# de juguete\nscripts/flujo/*\n.claude/agents/revisor.md\ndocs/LECCIONES.md\nscripts/kit/flujo.txt\n',
  'scripts/flujo/estado.sh': LINEAS,
  'scripts/flujo/omitido.sh': 'echo omitido\n',
  'scripts/flujo/restaurado.sh': 'echo restaurado\n',
  '.claude/agents/revisor.md': `Eres el revisor de ${NOMBRE}.\n\nuno\ndos\ntres\ncuatro\n`,
  'docs/LECCIONES.md': '# Lecciones\n\n## CI\n\n- Una vieja.\n',
  'src/x.ts': 'export const x = 1\n',
}
/** Lo que cambia en B: una línea de arriba, un archivo nuevo ejecutable, una línea con el nombre, una lección y el producto. */
const KIT_B: Record<string, string> = {
  'scripts/flujo/estado.sh': LINEAS.replace('uno', 'UNO'),
  'scripts/flujo/nuevo.sh': 'echo nuevo\n',
  '.claude/agents/revisor.md': `${KIT_A['.claude/agents/revisor.md']}cinco: ${NOMBRE}\n`,
  'docs/LECCIONES.md': `${KIT_A['docs/LECCIONES.md']}- Del kit.\n`,
  'src/x.ts': 'export const x = 2\n',
}

/** @param dir  @param args */
export const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...AUTOR },
  }).trim()

function escribir(dir: string, archivos: Record<string, string>) {
  for (const [f, t] of Object.entries(archivos)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true })
    writeFileSync(join(dir, f), t)
  }
}
function commitear(dir: string, mensaje: string) {
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', mensaje)
  return git(dir, 'rev-parse', 'HEAD')
}

/** El proyecto que salió de A: personalizado, con cambios propios lejos de los del kit y con `cambio` aplicado antes del commit. */
function crearProyecto(dir: string, A: string, cambio: (dir: string) => void) {
  git(tmpdir(), 'init', '-q', '-b', 'main', dir)
  git(dir, 'remote', 'add', 'origin', 'https://github.com/Cuenta/tienda-app.git')
  const propio = Object.fromEntries(
    Object.entries(KIT_A).map(([f, t]) => [f, t.replaceAll(NOMBRE, 'tienda-app')]),
  )
  escribir(dir, {
    ...propio,
    'scripts/flujo/estado.sh': LINEAS.replace('siete', 'SIETE'),
    'docs/LECCIONES.md': `${KIT_A['docs/LECCIONES.md']}- Sólo de aquí.\n`,
    'src/x.ts': 'export const propio = true\n',
    '.proyecto/proyecto.yaml': MANIFIESTO,
    '.kit/version': `${A}\n`,
  })
  cambio(dir)
  commitear(dir, 'chore(kit): arrancar tienda-app desde el kit')
}

/** El kit de juguete, el proyecto y cómo correr actualizar.mjs en él con el `gh` falso. */
export function juguete(cambio: (dir: string) => void = () => {}) {
  const raiz = mkdtempSync(join(tmpdir(), 'kit-juguete-'))
  raices.push(raiz)
  const kit = join(raiz, 'kit')
  const proyecto = join(raiz, 'tienda-app')
  git(tmpdir(), 'init', '-q', '-b', 'main', kit)
  escribir(kit, KIT_A)
  const A = commitear(kit, 'A')
  escribir(kit, KIT_B)
  chmodSync(join(kit, 'scripts/flujo/nuevo.sh'), 0o755)
  const B = commitear(kit, 'B')
  crearProyecto(proyecto, A, cambio)

  const falso = join(raiz, 'gh-falso')
  mkdirSync(join(falso, 'bin'), { recursive: true })
  writeFileSync(
    join(falso, 'bin/gh'),
    `#!/usr/bin/env bash\nexec node ${resolve('scripts/orquestador/prueba/gh-falso.mjs')} "$@"\n`,
    { mode: 0o755 },
  )
  const ruta = join(falso, 'estado.json')
  writeFileSync(
    ruta,
    JSON.stringify({
      repo: 'Cuenta/tienda-app',
      siguiente: 1,
      siguienteComentario: 1,
      issues: {},
      etiquetas: [],
      prs: {},
      cuentas: ['imandresalpiri'],
      git: { [KIT]: { dir: kit } },
    }),
  )
  const cambiarKit = (f: (k: { sinAcceso?: boolean }) => void) => {
    const g = JSON.parse(readFileSync(ruta, 'utf8')) as {
      git: Record<string, { sinAcceso?: boolean }>
    }
    f(g.git[KIT] ?? {})
    writeFileSync(ruta, JSON.stringify(g))
  }
  const correr = (...args: string[]) => {
    const r = spawnSync('node', [resolve('scripts/kit/actualizar.mjs'), ...args], {
      cwd: proyecto,
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: `${join(falso, 'bin')}:${process.env['PATH'] ?? ''}`,
        HOME: raiz,
        GH_FALSO: falso,
        ...AUTOR,
      },
    })
    return { estado: r.status, salida: r.stdout + r.stderr }
  }
  const leer = (f: string) => readFileSync(join(proyecto, f), 'utf8')
  return { raiz, kit, proyecto, A, B, correr, leer, cambiarKit, escribir, commitear }
}
