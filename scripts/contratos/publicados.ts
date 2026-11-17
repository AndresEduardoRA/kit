// Una versión publicada de un contrato no cambia nunca: ni la del proveedor (`contratos/<id>@<n>.json`) ni la copia fijada del
// consumidor (`.proyecto/contratos/<id>@<n>.json`). Se compara el árbol contra lo integrado: `CONTRATOS_BASE` (en el CI del PR,
// `FETCH_HEAD`, el main recién bajado) o `origin/main` en local. Sin esa referencia (un clon sin main) no hay contra qué comparar.
// Borrar una versión sí se puede: es el último paso de un cambio, y si sigue en `vigentes` la tumba `contrato:probar`.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const CARPETAS_DE_VERSIONES = ['contratos', '.proyecto/contratos'] as const
const RUTA_DE_VERSION = /^(?:contratos|\.proyecto\/contratos)\/[a-z][a-z0-9-]{1,30}@\d+\.json$/

/** ¿Es la ruta (relativa a la raíz) la de una versión: `contratos/x@1.json` o `.proyecto/contratos/x@1.json`? Puro. */
export const esVersion = (ruta: string): boolean => RUTA_DE_VERSION.test(ruta)

/** Las versiones que están en la base y en el árbol con otro contenido, en orden. Puro. */
export function versionesModificadas(
  enBase: ReadonlyMap<string, string>,
  enArbol: ReadonlyMap<string, string>,
): string[] {
  return [...enBase]
    .filter(([ruta, texto]) => enArbol.has(ruta) && enArbol.get(ruta) !== texto)
    .map(([ruta]) => ruta)
    .sort()
}

/** Por qué cae una versión modificada, con lo que hay que hacer en su lugar. Puro. */
export function explicarModificada(ruta: string, base: string): string {
  const version = /([a-z][a-z0-9-]{1,30})@(\d+)\.json$/.exec(ruta)
  const id = version?.[1] ?? '<id>'
  const siguiente = `${id}@${String(Number(version?.[2] ?? 0) + 1)}`
  const pista = ruta.startsWith('.proyecto/')
    ? 'Una copia fijada va tal cual sale de main del proveedor: para otra versión se cambia `consume`.'
    : `Lo nuevo va en ${siguiente} (\`provee\`).`
  return `${ruta} cambió respecto de ${base}: una versión publicada no cambia nunca. ${pista}`
}

/** La referencia contra la que se compara: `CONTRATOS_BASE` o `origin/main`. */
export const baseDePublicados = (entorno: NodeJS.ProcessEnv = process.env): string =>
  entorno['CONTRATOS_BASE'] || 'origin/main'

const git = (raiz: string, ...args: string[]) =>
  execFileSync('git', ['-C', raiz, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 16 * 1024 * 1024,
  })

/** Las versiones de la base (`git ls-tree` + `git show`), o `null` si la referencia no existe en este clon. */
export function leerPublicados(base: string, raiz: string): Map<string, string> | null {
  try {
    git(raiz, 'rev-parse', '--verify', '--quiet', `${base}^{commit}`)
  } catch {
    return null
  }
  const rutas = git(raiz, 'ls-tree', '-r', '--name-only', base, '--', ...CARPETAS_DE_VERSIONES)
    .split('\n')
    .filter(esVersion)
  return new Map(rutas.map((ruta) => [ruta, git(raiz, 'show', `${base}:${ruta}`)]))
}

/** Las versiones del árbol de trabajo. */
export function leerDelArbol(raiz: string): Map<string, string> {
  const enArbol = new Map<string, string>()
  for (const carpeta of CARPETAS_DE_VERSIONES) {
    const dir = join(raiz, carpeta)
    if (!existsSync(dir)) continue
    for (const nombre of readdirSync(dir)) {
      const ruta = `${carpeta}/${nombre}`
      if (esVersion(ruta)) enArbol.set(ruta, readFileSync(join(dir, nombre), 'utf8'))
    }
  }
  return enArbol
}
