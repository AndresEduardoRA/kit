// Los nombres de un proyecto que quedaron sin generalizar en el kit (`traer-de-proyecto.mjs comprobar`): el nombre del repo o su slug
// en las líneas agregadas respecto de origin/main y en los archivos sin seguir (el diff no los ve). Las lecciones llevan el nombre en
// su sufijo a propósito: no se miran. Sólo del kit (no viaja). Se prueba en `traer-de-proyecto.test.ts`.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CON_NOMBRE_A_PROPOSITO = ['docs/LECCIONES.md', 'docs/semillas/LECCIONES.md']

/**
 * El nombre del repo o el slug como palabra (`tienda` también dentro de `tienda-app`, no dentro de `tiendas`). Puro.
 * @param {string} nombre  @param {string} slug
 */
export function nombresDe(nombre, slug) {
  const esc = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9_-])(${esc(nombre)}|${esc(slug)})(?![A-Za-z0-9_])`, 'i')
}

/**
 * Las líneas `archivo:línea: texto` del repo en `raiz` que nombran el proyecto y no estaban en origin/main.
 * @param {string} raiz  @param {string} nombre  @param {string} slug
 */
export function nombresSinGeneralizar(raiz, nombre, slug) {
  const git = (/** @type {string[]} */ ...a) =>
    spawnSync('git', ['-C', raiz, ...a], { encoding: 'utf8' }).stdout
  const re = nombresDe(nombre, slug)
  const quedan = []
  let archivo = ''
  let n = 0
  for (const l of git('diff', '-U0', '--no-color', 'origin/main').split('\n')) {
    const h = /^@@ -\S+ \+(\d+)/.exec(l)
    if (l.startsWith('+++ ')) archivo = l.replace(/^\+\+\+ (b\/)?/, '')
    else if (h) n = Number(h[1])
    else if (l.startsWith('+')) {
      if (!CON_NOMBRE_A_PROPOSITO.includes(archivo) && re.test(l))
        quedan.push(`${archivo}:${n}: ${l.slice(1).trim()}`)
      n++
    }
  }
  for (const f of git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean))
    readFileSync(join(raiz, f), 'utf8')
      .split('\n')
      .forEach((l, i) => {
        if (re.test(l)) quedan.push(`${f}:${i + 1}: ${l.trim()}`)
      })
  return quedan
}
