// Lo que un PR puede tocar, según el paso de plan.yaml que lo abrió. La corre CI sobre el diff del PR (job `carriles`):
//
//   node scripts/guardas/carriles.mjs <commit base del PR> <rama del PR>     → los problemas por stderr; exit 1 si hay alguno
//
// - Un PR de un paso (rama `<carril>/<paso>`) sólo toca lo de su carril (dueno_de), los módulos de su paso y su carpeta de notas
//   `docs/pasos/<PASO>/` (bitácora y decisiones del paso: un archivo por paso, así dos carriles nunca chocan en un doc compartido).
//   Nada de docs/ESTADO.md ni del plan: el tablero lo lleva el coordinador.
// - Todo PR: una migración nueva es posterior a la última de la base (nunca se intercala), y una migración que ya está en la base no
//   se edita, no se borra ni se renombra.
// Viene de importadora (que tenía dos carriles escritos a mano); aquí los carriles y sus dueños salen de plan.yaml.
// Se prueba en `carriles.test.mjs`.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { leerPlan } from '../coordinador/plan.mjs'

const MIGRACION = /^supabase\/migrations\/(\d{14})_([^/]+)\.sql$/
const dentro = (ruta, dueno) =>
  (ruta.replace(/\/$/, '') + '/').startsWith(dueno.replace(/\/$/, '') + '/') || ruta === dueno

/** El paso y su carril a partir de la rama (`<carril>/<paso>`), o null si no es la rama de un paso. */
export function pasoDeLaRama(plan, rama) {
  const m = /^([a-z][a-z0-9-]*)\/(.+)$/.exec(rama)
  if (!m) return null
  const carril = plan.carriles.find((c) => c.id === m[1])
  const paso = plan.pasos.find(
    (p) => p.carril === m[1] && p.id.toLowerCase() === m[2].toLowerCase(),
  )
  return carril && paso ? { carril, paso } : null
}

/**
 * @param {{ plan: object, rama: string, cambios: { estado: string, ruta: string, antes?: string }[], ultimaDeLaBase: string }} pr
 * @returns {string[]}  Puro: sin I/O.
 */
export function problemasDelPr({ plan, rama, cambios, ultimaDeLaBase }) {
  const problemas = []
  const delPaso = pasoDeLaRama(plan, rama)
  for (const { estado, ruta, antes } of cambios) {
    const viejo = antes ?? ruta
    if (MIGRACION.test(viejo) && estado[0] !== 'A')
      problemas.push(
        `${viejo}: una migración que ya está en la base no se edita ni se borra; el cambio va en una nueva.`,
      )
    const nueva = ['A', 'R', 'C'].includes(estado[0]) ? MIGRACION.exec(ruta) : null
    if (nueva && (nueva[1] ?? '') <= ultimaDeLaBase)
      problemas.push(
        `${ruta}: la versión ${nueva[1]} no es posterior a la última de la base (${ultimaDeLaBase}): créala de nuevo con \`supabase migration new\`.`,
      )
    if (!delPaso) continue
    const { carril, paso } = delPaso
    const permitidas = [...carril.dueno_de, ...(paso.modulos ?? []), `docs/pasos/${paso.id}/`]
    for (const r of new Set([ruta, viejo]))
      if (!permitidas.some((d) => dentro(r, d)))
        problemas.push(
          `${r}: el paso ${paso.id} (carril ${carril.id}) no toca esto; lo suyo es ${permitidas.join(', ')}. Si hace falta, va en el plan como un paso del dueño.`,
        )
  }
  return problemas
}

/** `git diff --name-status -M` en filas. */
export function leerCambios(texto) {
  return texto
    .split('\n')
    .filter(Boolean)
    .map((linea) => {
      const [estado = '', primera = '', segunda] = linea.split('\t')
      return segunda === undefined
        ? { estado, ruta: primera }
        : { estado, ruta: segunda, antes: primera }
    })
}

function principal([base, rama]) {
  if (!base || !rama) {
    console.error('uso: node scripts/guardas/carriles.mjs <commit base> <rama del PR>')
    process.exit(64)
  }
  const git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const plan = leerPlan(readFileSync(process.env.COORD_PLAN || 'docs/semilla/plan.yaml', 'utf8'))
  const cambios = leerCambios(git('diff', '--name-status', '-M', `${base}...HEAD`))
  const ultimaDeLaBase =
    git('ls-tree', '--name-only', base, 'supabase/migrations/')
      .split('\n')
      .map((r) => MIGRACION.exec(r)?.[1])
      .filter(Boolean)
      .sort()
      .at(-1) ?? ''
  const problemas = problemasDelPr({ plan, rama, cambios, ultimaDeLaBase })
  for (const p of problemas) console.error(`✗ ${p}`)
  if (problemas.length > 0) process.exit(1)
  console.log(`✓ carriles: ${String(cambios.length)} archivos de ${rama} cumplen.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  principal(process.argv.slice(2))
