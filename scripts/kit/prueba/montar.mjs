// Lo común de las pruebas de publicar-proyecto.mjs (cola.test.mjs y publicar-proyecto.test.mjs): el ejemplo turnero creado en una
// raíz temporal, un gh falso con su estado y la CLI que corre con los dos.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe } from 'node:test'
import { fileURLToPath } from 'node:url'
import { archivoDeIssue, leerArchivo } from '../../orquestador/spec-issue.mjs'
import { crear } from '../nuevo-proyecto.mjs'
import { instalarGhFalso, leerEstado, nuevoRepo } from './gh-falso.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const CLI = join(KIT, 'scripts/kit/publicar-proyecto.mjs')
export const hayPyYaml = spawnSync('python3', ['-c', 'import yaml']).status === 0
const exige = process.env.SEMILLA_EXIGE_PYYAML === '1'
if (!hayPyYaml && !exige)
  console.log('# aviso: sin python3 con PyYAML se saltan las pruebas de publicar-proyecto')
export const conValidador = hayPyYaml || exige ? describe : describe.skip
export const APP = 'AndresEduardoRA/turnero-app'
export const WEB = 'AndresEduardoRA/turnero-web'

/** El ejemplo creado en una raíz temporal y un gh falso con `estado`; `correr(...args)` corre la CLI con ellos. */
export function montar(estado = {}, cambio = () => {}) {
  const raiz = mkdtempSync(join(tmpdir(), 'proyectos-'))
  const semilla = join(raiz, 'z_turnero', 'semilla')
  cpSync(join(KIT, 'scripts/semilla/ejemplo/semilla'), semilla, { recursive: true })
  crear('turnero', { raiz })
  cambio(semilla)
  const gh = mkdtempSync(join(tmpdir(), 'gh-falso-'))
  const env = { ...instalarGhFalso(gh, estado), PUBLICAR_PAUSA_MS: '0' }
  const correr = (...args) => {
    const r = spawnSync('node', [CLI, 'turnero', ...args, '--raiz', raiz], {
      env,
      encoding: 'utf8',
    })
    return { estado: r.status, salida: r.stdout, error: r.stderr }
  }
  const editarEstado = (fn) => {
    const e = leerEstado(gh)
    fn(e)
    writeFileSync(join(gh, 'estado.json'), JSON.stringify(e))
  }
  return { raiz, z: join(raiz, 'z_turnero'), gh, correr, editarEstado }
}
export const conRepos = (extra = {}) => ({
  repos: { [APP]: nuevoRepo(extra[APP]), [WEB]: nuevoRepo(extra[WEB]) },
})
/** Los issues de un repo del gh falso, con su tarea como la lee el orquestador. */
export const issues = (gh, repo) =>
  leerEstado(gh).repos[repo].issues.map((i) => ({
    ...i,
    campos: Object.fromEntries(leerArchivo(archivoDeIssue(i)).campos),
  }))
export const resumen = (gh, repo) =>
  issues(gh, repo).map((i) => [i.number, i.campos.paso, i.campos.depende ?? ''])
