// `pnpm contrato:probar`: la base local cumple cada versión vigente de lo que el repo provee, y también la de `provee` (una base que no
// cumple su última versión generada es un bug). Sin I/O de proceso: recibe `consultar` y los textos ya leídos.
import { diferencias } from './comparar'
import { leerContrato, type Contrato } from './esquemas'
import type { Resultado } from './generar'
import { leerEsquema, type Consultar } from './introspeccion'
import type { Provisto } from './manifiesto'

/** Las versiones que se prueban de un contrato: `vigentes` ∪ {la de `provee`}, de menor a mayor. Puro. */
export const versionesAProbar = (p: Provisto): number[] =>
  [...new Set([...p.vigentes, p.version])].sort((a, b) => a - b)

/**
 * Una versión publicada del proveedor, validada: `texto` es `null` si el archivo no está. Una de `vigentes` sin archivo es un error
 * (alguien la consume); la de `provee` sin archivo pide generarla. Puro.
 */
export function cargarVersion(
  p: Provisto,
  version: number,
  texto: string | null,
): Resultado<Contrato> {
  const archivo = `contratos/${p.id}@${String(version)}.json`
  if (texto === null)
    return {
      ok: false,
      problemas: [
        p.vigentes.includes(version)
          ? `Falta ${archivo}: está en \`vigentes\`. Restáurala desde main, o sácala de vigentes sólo si nadie la consume (.claude/rules/contratos.md).`
          : `Falta ${archivo}: es la versión de \`provee\`. Genérala con \`pnpm contrato:generar\`.`,
      ],
    }
  const r = leerContrato(texto, archivo)
  if (!r.ok) return { ok: false, problemas: r.problemas }
  if (r.contrato.contrato !== p.id || r.contrato.version !== version)
    return {
      ok: false,
      problemas: [
        `${archivo}: adentro dice ${r.contrato.contrato}@${String(r.contrato.version)}: el archivo lo escribe \`pnpm contrato:generar\`.`,
      ],
    }
  return { ok: true, valor: r.contrato }
}

/** Lo que la base ya no cumple de una versión publicada, con `<id>@<n> ›` adelante. Vacío: la cumple. */
export async function probarVersion(publicado: Contrato, consultar: Consultar): Promise<string[]> {
  const nombres = [...publicado.vistas.map((v) => v.nombre), ...publicado.rpc.map((r) => r.nombre)]
  const l = await leerEsquema({ esquema: publicado.esquema, nombres, consultar })
  const actual: Contrato = {
    ...publicado,
    usoDelEsquema: l.usoDelEsquema,
    vistas: l.vistas,
    rpc: l.rpc,
    // Un tipo prometido se compara aunque ya no lo use ningún objeto listado: sigue siendo parte de la versión.
    tipos: l.tiposDelEsquema,
  }
  const en = `${publicado.contrato}@${String(publicado.version)}`
  return [...l.problemas, ...diferencias(publicado, actual)].map((d) => `${en} › ${d}`)
}
