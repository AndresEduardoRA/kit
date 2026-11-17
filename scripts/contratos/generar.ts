// `pnpm contrato:generar`: la versión de `provee` de cada contrato, leída de la base local según su `contratos/<id>.config.json`.
// Aquí no hay I/O de proceso: recibe `consultar` (psql de la pila o PGlite en las pruebas) y lo ya leído, y devuelve qué escribir.
import {
  canonico,
  esquemaDeConfig,
  esquemaDeContrato,
  textoDelContrato,
  type ConfigDeContrato,
  type Contrato,
} from './esquemas'
import { leerEsquema, type Consultar } from './introspeccion'
import type { Referencia } from './manifiesto'

export type Resultado<T> = { ok: true; valor: T } | { ok: false; problemas: string[] }

export const archivoDeConfig = (id: string): string => `contratos/${id}.config.json`

/** La configuración de un contrato, validada; `texto` es `null` si el archivo no existe. Puro. */
export function leerConfig(id: string, texto: string | null): Resultado<ConfigDeContrato> {
  const archivo = archivoDeConfig(id)
  if (texto === null)
    return {
      ok: false,
      problemas: [
        `Falta ${archivo}: { "esquema": "<esquema>", "objetos": ["<vista o función>", …] }.`,
      ],
    }
  let crudo: unknown
  try {
    crudo = JSON.parse(texto)
  } catch {
    return { ok: false, problemas: [`${archivo}: no es JSON válido.`] }
  }
  const r = esquemaDeConfig.safeParse(crudo)
  if (r.success) return { ok: true, valor: r.data }
  return {
    ok: false,
    problemas: r.error.issues.map(
      (i) => `${archivo}: ${i.path.join('.') || '(raíz)'}: ${i.message}`,
    ),
  }
}

/** Lee de la base los objetos de la configuración y arma el contrato, o dice qué falta o está mal. */
export async function generarContrato(e: {
  ref: Referencia
  config: ConfigDeContrato
  consultar: Consultar
}): Promise<Resultado<Contrato>> {
  const { esquema, objetos } = e.config
  if (esquema === 'public')
    return {
      ok: false,
      problemas: [
        `${archivoDeConfig(e.ref.id)}: el esquema de un contrato no puede ser \`public\`: el consumidor no distinguiría sus RPC de las del proveedor. Crea un esquema propio para lo que expones.`,
      ],
    }
  const l = await leerEsquema({ esquema, nombres: objetos, consultar: e.consultar })
  const problemas = [
    ...l.faltan.map(
      (x) => `\`${esquema}.${x}\` no existe en la base local. ¿Corriste \`pnpm db:reset\`?`,
    ),
    ...l.problemas,
  ]
  if (problemas.length) return { ok: false, problemas }
  // Lo que se escribe pasa por el mismo Zod que lo lee (`probar`, `tipos`, `usar`): un contrato que no se podría leer no se escribe.
  const r = esquemaDeContrato.safeParse(
    canonico({
      contrato: e.ref.id,
      version: e.ref.version,
      tipo: 'base',
      esquema,
      usoDelEsquema: l.usoDelEsquema,
      vistas: l.vistas,
      rpc: l.rpc,
      tipos: l.tipos,
    }),
  )
  if (r.success) return { ok: true, valor: r.data }
  return {
    ok: false,
    problemas: r.error.issues.map(
      (i) => `el contrato saldría inválido: ${i.path.join('.')}: ${i.message}`,
    ),
  }
}

/**
 * Los esquemas que PostgREST expone según `[api] schemas` de `supabase/config.toml` (`null` si no hay config.toml). Sin la clave,
 * los de fábrica de Supabase. Puro.
 */
export function esquemasExpuestos(toml: string | null): string[] | null {
  if (toml === null) return null
  const api = /^\[api\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(toml)?.[1] ?? ''
  const lista = /^schemas\s*=\s*\[([^\]]*)\]/m.exec(api)?.[1]
  if (lista === undefined) return ['public', 'graphql_public']
  return [...lista.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '')
}

/** Un esquema de contrato que PostgREST no expone: todo daría verde y el consumidor recibiría un 404. Puro. */
export function problemaDeExposicion(esquema: string, toml: string | null): string[] {
  const expuestos = esquemasExpuestos(toml)
  if (expuestos === null || expuestos.includes(esquema)) return []
  return [
    `\`${esquema}\` no está en \`[api] schemas\` de supabase/config.toml (${expuestos.join(', ')}): PostgREST no lo expone y el consumidor recibiría un 404. Súmalo ahí y en la nube (API › Exposed schemas).`,
  ]
}

/**
 * Qué hacer con el texto generado frente a lo ya integrado (`publicado`: el de la base de comparación, o `undefined` si esa versión
 * no está publicada): escribirlo, nada («sin cambios») o negarse, porque una versión publicada no se reescribe. Puro.
 */
export function decidirEscritura(
  contrato: Contrato,
  publicado: string | undefined,
  base: string,
): { escribir: boolean; error: boolean; mensaje: string } {
  const ruta = `contratos/${contrato.contrato}@${String(contrato.version)}.json`
  const texto = textoDelContrato(contrato)
  if (publicado === undefined) return { escribir: true, error: false, mensaje: `escribí ${ruta}` }
  if (publicado === texto)
    return {
      escribir: false,
      error: false,
      mensaje: `${ruta}: sin cambios (ya está publicada así).`,
    }
  return {
    escribir: false,
    error: true,
    mensaje: `${ruta} ya está publicada en ${base} con otro contenido: una versión publicada no cambia nunca. Sube \`provee\` a ${contrato.contrato}@${String(contrato.version + 1)} y vuelve a generar.`,
  }
}
