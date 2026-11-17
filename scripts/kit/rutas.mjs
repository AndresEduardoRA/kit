// Dónde vive cada cosa de un proyecto, calculado desde el kit (nunca una ruta fija: docs/semillas/LECCIONES.md › «Rutas»).
//
//   <raíz>/z_<slug>/semilla/        la semilla v2 de idea-a-semilla
//   <raíz>/z_<slug>/proyecto.yaml   el manifiesto suelto, sin versionar
//   <raíz>/z_<slug>/<rol>/          cada repo
//
// La raíz es dos carpetas arriba de la principal del kit (`proyectos/_herramientas/kit` → `proyectos/`). Desde un worktree del kit
// (`kit/.orquestador/worktrees/T9`) `<kit>/../..` caería en `kit/.orquestador`: por eso se sube desde la principal, la carpeta del
// `--git-common-dir`. Se prueba en `rutas.test.mjs`.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { raizDeProyectos } from '../proyecto/manifiesto.mjs'

/** La principal del kit: la carpeta del `--git-common-dir` (la misma desde cualquier worktree); sin git, el mismo `kit`. */
export function kitPrincipal(kit) {
  const r = spawnSync(
    'git',
    ['-C', kit, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    {
      encoding: 'utf8',
    },
  )
  return r.status === 0 && r.stdout.trim() ? dirname(r.stdout.trim()) : kit
}

/** La raíz de proyectos: la pedida (`--raiz`, sólo para pruebas y el CI) o dos arriba de la principal del kit. */
export const raizDelKit = (kit, pedida) => pedida ?? raizDeProyectos(kitPrincipal(kit))

/** Las rutas de un proyecto en la raíz. Puro. */
export function rutasDelProyecto(raiz, slug) {
  const carpeta = join(raiz, `z_${slug}`)
  return {
    carpeta,
    semilla: join(carpeta, 'semilla'),
    manifiesto: join(carpeta, 'proyecto.yaml'),
    /** @param {string} rol */
    repo: (rol) => join(carpeta, rol),
  }
}

/** Una carpeta que existe y tiene algo adentro (o un archivo con ese nombre): ahí no se crea un repo. */
export const carpetaOcupada = (dir) =>
  existsSync(dir) && (!statSync(dir).isDirectory() || readdirSync(dir).length > 0)
