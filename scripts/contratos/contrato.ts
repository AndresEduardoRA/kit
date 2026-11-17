// La CLI de los contratos de base entre repos (`.claude/rules/contratos.md`):
//
//   tsx scripts/contratos/contrato.ts generar [<id>] | probar | rol
//
// - generar: escribe `contratos/<id>@<n>.json` (la versión de `provee`) desde la base local, según `contratos/<id>.config.json`.
// - probar:  la base local cumple cada versión de `vigentes` y la de `provee`.
// - rol:     `provee=true|false` y `consume=true|false`, para `$GITHUB_OUTPUT` (el job `contrato` levanta la pila sólo si provee).
//
// Errores a stderr; sale con 1 si hay problemas y con 64 si el uso está mal. Si no hay nada que hacer lo dice y sale con 0. Por
// `pnpm contrato:generar` y `pnpm contrato:probar` toma el candado de la base (`scripts/candado.sh`).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  ManifiestoInvalido,
  contratosDelRepo,
  repoDeEsteWorktree,
} from '../proyecto/manifiesto.mjs'
import { consultarPilaLocal, contenedorDeLaPila, explicarFalloDeLaPila } from './base-local'
import { textoDelContrato } from './esquemas'
import { archivoDeConfig, decidirEscritura, generarContrato, leerConfig } from './generar'
import type { Consultar } from './introspeccion'
import { contratosQueProvee } from './manifiesto'
import { cargarVersion, probarVersion, versionesAProbar } from './probar'
import { baseDePublicados, leerPublicados } from './publicados'

type Propio = NonNullable<ReturnType<typeof repoDeEsteWorktree>>
type Comando = (raiz: string, propio: Propio, args: string[]) => Promise<number>

const decir = (...lineas: string[]) => {
  for (const l of lineas) process.stdout.write(`${l}\n`)
}
const avisar = (...lineas: string[]) => {
  for (const l of lineas) process.stderr.write(`${l}\n`)
}
const fallar = (problemas: string[]) => {
  avisar(...problemas)
  return 1
}
const leerSiHay = (ruta: string): string | null =>
  existsSync(ruta) ? readFileSync(ruta, 'utf8') : null

class FalloDeLaPila extends Error {}

// La consulta a la pila local, con el fallo explicado (sin Docker, la pila apagada) en vez de la traza de `docker exec`.
function consultarConExplicacion(raiz: string, comando: string): Consultar {
  const contenedor = contenedorDeLaPila(raiz)
  const consultar = consultarPilaLocal(contenedor)
  return (sql) =>
    consultar(sql).catch((e: unknown) => {
      throw new FalloDeLaPila(explicarFalloDeLaPila(e, contenedor, comando))
    })
}

const generar: Comando = async (raiz, propio, [id]) => {
  const { contratos, problemas } = contratosQueProvee(propio.manifiesto, propio.repo)
  if (problemas.length) return fallar(problemas)
  if (!contratos.length) {
    decir('Este repo no provee contratos (`provee` del manifiesto está vacío): nada que generar.')
    return 0
  }
  const elegidos = id ? contratos.filter((c) => c.id === id) : contratos
  if (!elegidos.length)
    return fallar([
      `«${id ?? ''}» no está en \`provee\` (provee: ${contratos.map((c) => c.id).join(', ')}).`,
    ])
  const consultar = consultarConExplicacion(raiz, 'generar')
  const base = baseDePublicados()
  const publicados = leerPublicados(base, raiz) ?? new Map<string, string>()
  let codigo = 0
  for (const ref of elegidos) {
    const config = leerConfig(ref.id, leerSiHay(join(raiz, archivoDeConfig(ref.id))))
    const r = config.ok ? await generarContrato({ ref, config: config.valor, consultar }) : config
    if (!r.ok) {
      codigo = fallar(r.problemas)
      continue
    }
    const ruta = `contratos/${ref.id}@${String(ref.version)}.json`
    const d = decidirEscritura(r.valor, publicados.get(ruta), base)
    if (d.escribir) {
      mkdirSync(join(raiz, 'contratos'), { recursive: true })
      writeFileSync(join(raiz, ruta), textoDelContrato(r.valor))
    }
    if (d.error) codigo = fallar([d.mensaje])
    else decir(d.mensaje)
  }
  return codigo
}

const probar: Comando = async (raiz, propio) => {
  const { contratos, problemas } = contratosQueProvee(propio.manifiesto, propio.repo)
  if (problemas.length) return fallar(problemas)
  if (!contratos.length) {
    decir('Este repo no provee contratos (`provee` del manifiesto está vacío): nada que probar.')
    return 0
  }
  const consultar = consultarConExplicacion(raiz, 'probar')
  let codigo = 0
  for (const p of contratos)
    for (const version of versionesAProbar(p)) {
      const v = cargarVersion(
        p,
        version,
        leerSiHay(join(raiz, `contratos/${p.id}@${String(version)}.json`)),
      )
      const caidas = v.ok ? await probarVersion(v.valor, consultar) : v.problemas
      if (caidas.length) codigo = fallar(caidas)
      else decir(`✓ la base local cumple ${p.id}@${String(version)}`)
    }
  return codigo
}

const rol: Comando = (_raiz, propio) => {
  const { provee, consume } = contratosDelRepo(propio.manifiesto, propio.repo)
  decir(`provee=${String(provee.length > 0)}`, `consume=${String(consume.length > 0)}`)
  return Promise.resolve(0)
}

const COMANDOS: Record<string, Comando> = { generar, probar, rol }
const USO = `uso: tsx scripts/contratos/contrato.ts ${Object.keys(COMANDOS).join(' | ')} (generar acepta un <id>)`

/** Corre un comando en el repo de `raiz` y devuelve el código de salida. */
export async function principal(argv: string[], raiz = process.cwd()): Promise<number> {
  const [nombre = '', ...args] = argv
  const comando = COMANDOS[nombre]
  if (!comando || (nombre !== 'generar' && args.length) || args.length > 1) {
    avisar(USO)
    return 64
  }
  try {
    const propio = repoDeEsteWorktree(raiz)
    if (propio) return await comando(raiz, propio, args)
    if (nombre === 'rol') decir('provee=false', 'consume=false')
    else decir('Este repo no tiene .proyecto/proyecto.yaml: no provee ni consume contratos.')
    return 0
  } catch (e) {
    if (e instanceof ManifiestoInvalido || e instanceof FalloDeLaPila) return fallar([e.message])
    throw e
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void principal(process.argv.slice(2)).then((codigo) => {
    process.exitCode = codigo
  })
