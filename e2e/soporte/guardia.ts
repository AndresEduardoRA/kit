// La guardia de los e2e: antes de gastar minutos en una corrida, las funciones edge que los specs llaman tienen que estar servidas.
// Si no lo están, falla en segundos diciendo qué correr. Cuáles son lo dice `PILOTO_FUNCIONES` (piloto.config, separadas por espacio;
// vacío = ninguna), la misma lista que espera el job `e2e` de `.github/workflows/ci.yml`.
import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

const INTENTOS = 4
const ESPERA_ENTRE_INTENTOS_MS = 500

// La lista de `PILOTO_FUNCIONES`: del entorno o, si no está, de `piloto.config` (que es un archivo de shell con `CLAVE=valor`).
export function funcionesExigidas(
  entorno: Record<string, string | undefined> = process.env,
  config = existsSync('piloto.config') ? readFileSync('piloto.config', 'utf8') : '',
): string[] {
  const crudo = entorno['PILOTO_FUNCIONES'] ?? leerDeConfig(config)
  return crudo.split(/\s+/).filter(Boolean)
}

function leerDeConfig(config: string): string {
  const linea = config.split('\n').find((l) => /^PILOTO_FUNCIONES=/.test(l)) ?? ''
  return parseEnv(linea)['PILOTO_FUNCIONES'] ?? ''
}

// La URL de la API local: la de la app (`.env.local`) o la del carril (`PILOTO_SUPABASE_URL`).
function urlDeLaApi(): string {
  const deArchivo = existsSync('.env.local') ? parseEnv(readFileSync('.env.local', 'utf8')) : {}
  const url =
    process.env['NEXT_PUBLIC_SUPABASE_URL'] ??
    process.env['PILOTO_SUPABASE_URL'] ??
    deArchivo['NEXT_PUBLIC_SUPABASE_URL']
  if (!url)
    throw new Error('[guardia] falta NEXT_PUBLIC_SUPABASE_URL (en el entorno o en .env.local).')
  return url
}

// `OPTIONS` responde sin ejecutar nada. Un corte del runtime local se vuelve a pedir; un 404 o un 5xx es una función que no está servida.
async function estaServida(url: string): Promise<boolean> {
  for (let intento = 1; intento <= INTENTOS; intento++) {
    try {
      const respuesta = await fetch(url, { method: 'OPTIONS' })
      return respuesta.status !== 404 && respuesta.status < 500
    } catch {
      await new Promise((seguir) => setTimeout(seguir, ESPERA_ENTRE_INTENTOS_MS))
    }
  }
  return false
}

// Falla rápido si una función que un spec necesita no está servida. `E2E_SIN_FUNCIONES=1` lo salta (y lo avisa): los specs que las
// llaman fallarán por su cuenta.
export async function exigirFunciones(): Promise<void> {
  const funciones = funcionesExigidas()
  if (funciones.length === 0) return
  if (process.env['E2E_SIN_FUNCIONES'] === '1') {
    console.warn('[guardia] E2E_SIN_FUNCIONES=1: no se comprueba que las funciones estén servidas.')
    return
  }
  const base = urlDeLaApi()
  const caidas: string[] = []
  for (const nombre of funciones) {
    if (!(await estaServida(`${base}/functions/v1/${nombre}`))) caidas.push(nombre)
  }
  if (caidas.length > 0) {
    throw new Error(
      `Las funciones edge no están servidas (${caidas.join(', ')}): corre \`pnpm funciones\` en otra terminal, ` +
        'o `E2E_SIN_FUNCIONES=1` si no vas a correr los specs que las usan.',
    )
  }
}
