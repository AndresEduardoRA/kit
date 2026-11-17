// La base de la pila local de Supabase de ESTE worktree (la principal o un carril), por el `psql` de su contenedor: el mismo camino
// que `e2e/soporte/sql.ts`, sin un cliente de Postgres en las dependencias (no se importa de `e2e/`: se repite en pocas líneas).
// Sólo lee. Nunca mira la base de otro repo ni una en la nube.
import { execFileSync } from 'node:child_process'
import { stackLocal } from '../lib/stack-local.mjs'
import type { Consultar } from './introspeccion'

/** El contenedor de la base de este worktree: `supabase_db_<project_id>` (`.env.carril` en un carril). */
export const contenedorDeLaPila = (raiz: string): string => stackLocal(raiz).contenedorDb

/** Corre la consulta (una sentencia que devuelve un `jsonb`) en la pila local y devuelve el JSON. */
export function consultarPilaLocal(contenedor: string): Consultar {
  const argumentos = [
    'exec',
    '-i',
    contenedor,
    'psql',
    '-U',
    'postgres',
    '-q',
    '-X',
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
  ]
  return (sql) =>
    Promise.resolve().then(() => {
      const salida = execFileSync('docker', argumentos, {
        input: `${sql};\n`,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 16 * 1024 * 1024,
      })
      return JSON.parse(salida) as unknown
    })
}

const textoDe = (error: unknown): string => {
  if (!error || typeof error !== 'object') return String(error)
  const e = error as { stderr?: unknown; message?: unknown }
  return [e.stderr, e.message].filter((x) => typeof x === 'string' && x).join('\n')
}

/** Qué decir cuando la consulta a la pila local falla: sin Docker, la pila apagada o un error de la consulta. Puro. */
export function explicarFalloDeLaPila(error: unknown, contenedor: string, comando: string): string {
  if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT')
    return 'No encuentro `docker`: el contrato se lee de la pila local de Supabase, que corre en Docker.'
  const texto = textoDe(error)
  if (/no such container|is not running|cannot connect to the docker daemon/i.test(texto))
    return [
      `La pila local de Supabase no está arriba (no encuentro \`${contenedor}\`). Levántala: en la principal`,
      '`pnpm exec supabase start`; en un carril `bash scripts/worktree/preparar.sh`. Después `pnpm db:reset` y vuelve a correr',
      `\`pnpm contrato:${comando}\`.`,
    ].join(' ')
  return `La consulta a la base local (\`${contenedor}\`) falló: ${texto.split('\n').slice(0, 5).join(' ')}`
}
