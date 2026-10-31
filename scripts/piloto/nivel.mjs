// El nivel de verificación de un conjunto de archivos (`.claude/rules/e2e.md`): Nivel 2 si toca alguno de los disparadores, Nivel 1 si
// no. Además informa si el conjunto toca interfaz: sólo entonces los e2e dirigidos corren también en `movil`. Viene de importadora,
// donde los disparadores nombraban sus rutas; aquí son genéricos para un proyecto Next + Supabase del kit.
//
// Uso: node scripts/piloto/nivel.mjs [--rango <a>..<b>] [archivo…]   → JSON por stdout
//   --rango lee los archivos de `git diff --name-only` y el contenido de las migraciones de `<b>`; sin él, del árbol de trabajo.
// Se prueba en `nivel.test.mjs`.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const TIPOS = 'src/shared/types/database.types.ts'
const MIGRACION = /^supabase\/migrations\/[^/]+\.sql$/
const sinComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
const cambiaRls = (sql) =>
  sql !== null &&
  /\b(create|alter|drop)\s+policy\b|\benable\s+row\s+level\s+security\b|\bsecurity\s+definer\b|\b(grant|revoke)\b/i.test(
    sinComentarios(sql),
  )
const cambiaEstructura = (sql) =>
  sql !== null &&
  /\b(create|alter|drop)\s+table\b|\b(create|drop)\s+(unique\s+)?index\b/i.test(sinComentarios(sql))

// (1) lo compartido · (2) el proxy o middleware · (3) auth · (4) RLS y permisos · (5) el layout · (6) la estructura de la base.
export const DISPARADORES = [
  {
    id: 'shared',
    aplica: (a) => (a.startsWith('src/shared/') || a.startsWith('packages/')) && a !== TIPOS,
  },
  { id: 'proxy', aplica: (a) => /^src\/(proxy|middleware)\.ts$/.test(a) },
  { id: 'auth', aplica: (a) => /(^|\/)(auth|acceso|\(acceso\))\//.test(a) && a.startsWith('src/') },
  { id: 'rls', aplica: (a, leer) => MIGRACION.test(a) && cambiaRls(leer(a)) },
  {
    id: 'layout',
    aplica: (a) => /^src\/app\/(.*\/)?layout\.tsx$/.test(a) || /^src\/app\/.*\/_shell\//.test(a),
  },
  { id: 'estructura', aplica: (a, leer) => MIGRACION.test(a) && cambiaEstructura(leer(a)) },
]

const esPrueba = (a) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(a)
export const tocaInterfaz = (a) =>
  !esPrueba(a) &&
  (/^src\/.*\.(tsx|css)$/.test(a) ||
    ['design/', 'public/', 'src/app/', 'src/shared/ui/'].some((p) => a.startsWith(p)))

/** `leer(archivo)` devuelve el contenido, o null si el archivo ya no existe. */
export function nivelDe(archivos, leer) {
  const disparadores = DISPARADORES.map(({ id, aplica }) => ({
    id,
    archivos: archivos.filter((a) => aplica(a, leer)),
  })).filter((d) => d.archivos.length > 0)
  const interfaz = archivos.filter(tocaInterfaz)
  return {
    nivel: disparadores.length > 0 ? 2 : 1,
    disparadores,
    toca_interfaz: interfaz.length > 0,
    interfaz,
    database_types: archivos.includes(TIPOS),
    archivos,
  }
}

function main(argv) {
  const i = argv.indexOf('--rango')
  const rango = i >= 0 ? argv[i + 1] : undefined
  const archivos = i >= 0 ? argv.filter((_, k) => k !== i && k !== i + 1) : argv
  if (rango === undefined) {
    const leer = (a) => {
      try {
        return readFileSync(a, 'utf8')
      } catch {
        return null
      }
    }
    return nivelDe(archivos, leer)
  }
  const git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const fin = rango.split('..').pop()
  const cambiados = git('diff', '--name-only', rango).split('\n').filter(Boolean)
  const leer = (a) => {
    try {
      return git('show', `${fin}:${a}`)
    } catch {
      return null
    }
  }
  return nivelDe([...cambiados, ...archivos], leer)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(main(process.argv.slice(2))))
}
