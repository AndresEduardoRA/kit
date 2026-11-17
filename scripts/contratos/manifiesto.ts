// Lo que el manifiesto (`.proyecto/proyecto.yaml`) dice de los contratos de ESTE repo, revisado para los comandos `contrato:*`.
// Va aparte de `problemasDelManifiesto` (scripts/proyecto/manifiesto.mjs): un contrato mal escrito no debe tumbar los puertos ni el
// orquestador, que leen el mismo manifiesto. Todo puro: texto adentro, datos afuera.
import { contratosDelRepo, githubDeRepo } from '../proyecto/manifiesto.mjs'
import { leerContrato, type Contrato } from './esquemas'

type Manifiesto = Parameters<typeof contratosDelRepo>[0]
type Repo = Parameters<typeof contratosDelRepo>[1]
type Definicion = ReturnType<typeof contratosDelRepo>['contratos'][number]

export type Referencia = { id: string; version: number }
export type Provisto = Referencia & { vigentes: number[] }
export type Consumido = Referencia & { proveedor: string; github: string | null }

export const CARPETA_DE_COPIAS = '.proyecto/contratos'
export const archivoDeVersion = (r: Referencia): string => `${r.id}@${String(r.version)}.json`

/** `agenda@2` → `{ id: 'agenda', version: 2 }`. El manifiesto ya validó el formato; uno roto falla aquí. Puro. */
export function referencia(ref: string): Referencia {
  const m = /^([a-z][a-z0-9-]{1,30})@(\d+)$/.exec(ref)
  if (!m?.[1] || !m[2]) throw new Error(`«${ref}» no es <contrato>@<versión>`)
  return { id: m[1], version: Number(m[2]) }
}

const definicionDe = (m: Manifiesto, id: string): Definicion | undefined =>
  (m.contratos ?? []).find((d) => d.id === id)

const SOPORTADOS = ['base']
const CONOCIDOS = ['base', 'http', 'archivo']

function problemasDeLaDefinicion(c: Definicion): string[] {
  const en = `contratos[${c.id}]`
  const p: string[] = []
  if (c.tipo === undefined) p.push(`${en}.tipo: falta (sólo «base» está soportado).`)
  else if (!CONOCIDOS.includes(c.tipo))
    p.push(`${en}.tipo: «${c.tipo}» no es un tipo de contrato (base, http o archivo).`)
  else if (!SOPORTADOS.includes(c.tipo))
    p.push(`${en}.tipo: «${c.tipo}» todavía no soportado (sólo «base»).`)
  for (const v of c.vigentes ?? [])
    if (!Number.isInteger(v) || v <= 0)
      p.push(`${en}.vigentes: «${String(v)}» no es una versión (enteros mayores que 0).`)
  return p
}

function unaVersionPorContrato(refs: Referencia[], en: string): string[] {
  return [...Map.groupBy(refs, (r) => r.id)]
    .filter(([, rs]) => rs.length > 1)
    .map(
      ([id, rs]) =>
        `${en}: dos versiones de ${id} (${rs.map((r) => `${id}@${String(r.version)}`).join(', ')}): va una sola.`,
    )
}

/** Lo que este repo provee, con las versiones vigentes de cada contrato, o los problemas. Puro. */
export function contratosQueProvee(
  m: Manifiesto,
  repo: Repo,
): { contratos: Provisto[]; problemas: string[] } {
  const { provee } = contratosDelRepo(m, repo)
  const en = `repos[${repo.rol}].provee`
  const refs = provee.map(referencia)
  const problemas = unaVersionPorContrato(refs, en)
  const contratos: Provisto[] = []
  for (const r of refs) {
    const c = definicionDe(m, r.id)
    if (!c || c.proveedor !== repo.rol) {
      problemas.push(
        `${en}: «${r.id}@${String(r.version)}» es de ${c?.proveedor ?? 'otro repo'}, no de ${repo.rol}.`,
      )
      continue
    }
    problemas.push(...problemasDeLaDefinicion(c))
    contratos.push({ ...r, vigentes: c.vigentes ?? [] })
  }
  return { contratos, problemas }
}

/** Lo que este repo consume, con el repo de GitHub de quien lo provee, o los problemas. Puro. */
export function contratosQueConsume(
  m: Manifiesto,
  repo: Repo,
): { contratos: Consumido[]; problemas: string[] } {
  const { consume } = contratosDelRepo(m, repo)
  const en = `repos[${repo.rol}].consume`
  const refs = consume.map(referencia)
  const problemas = unaVersionPorContrato(refs, en)
  const contratos: Consumido[] = []
  for (const r of refs) {
    const c = definicionDe(m, r.id)
    if (!c || !(c.consumidores ?? []).includes(repo.rol)) {
      const son = (c?.consumidores ?? []).join(', ') || 'ninguno'
      problemas.push(
        `${en}: «${r.id}@${String(r.version)}»: ${repo.rol} no está entre los consumidores de ${r.id} (son: ${son}).`,
      )
      continue
    }
    problemas.push(...problemasDeLaDefinicion(c))
    const proveedor = m.repos.find((x) => x.rol === c.proveedor)
    contratos.push({
      ...r,
      proveedor: c.proveedor,
      github: proveedor ? githubDeRepo(m, proveedor.nombre) : null,
    })
  }
  return { contratos, problemas }
}

/**
 * Las copias fijadas de `.proyecto/contratos/` frente a `consume`: una copia que nadie nombra, un `consume` sin su copia, o una copia
 * que no es el contrato que dice su nombre. `leer` devuelve el texto de un archivo de la carpeta. Puro.
 */
export function problemasDeLasCopias(
  consume: Consumido[],
  archivos: readonly string[],
  leer: (archivo: string) => string,
): { copias: Contrato[]; problemas: string[] } {
  const esperados = new Map(consume.map((c) => [archivoDeVersion(c), c]))
  const nombrados = consume.map((c) => `${c.id}@${String(c.version)}`).join(', ') || 'nada'
  const problemas: string[] = []
  const copias: Contrato[] = []
  for (const a of [...archivos].sort())
    if (!esperados.has(a))
      problemas.push(
        `${CARPETA_DE_COPIAS}/${a}: no está en \`consume\` (consume: ${nombrados}). Bórrala o nómbrala.`,
      )
  for (const [archivo, c] of esperados) {
    if (!archivos.includes(archivo)) {
      problemas.push(
        `Falta ${CARPETA_DE_COPIAS}/${archivo}: cópiala de contratos/${archivo} en main de ${c.github ?? c.proveedor} (.claude/rules/contratos.md).`,
      )
      continue
    }
    const ruta = `${CARPETA_DE_COPIAS}/${archivo}`
    const r = leerContrato(leer(archivo), ruta)
    if (!r.ok) problemas.push(...r.problemas)
    else if (r.contrato.contrato !== c.id || r.contrato.version !== c.version)
      problemas.push(
        `${ruta}: adentro dice ${r.contrato.contrato}@${String(r.contrato.version)}: la copia va tal cual sale de main del proveedor.`,
      )
    else copias.push(r.contrato)
  }
  return { copias, problemas }
}
