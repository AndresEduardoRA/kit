// Del plan a las specs de la cola (plan-a-cola.mjs) sobre el ejemplo turnero: el orden del proyecto, las ramas, cada spec y el cierre.
// Cada spec tiene que pasar `issueDeArchivo` (spec-issue.mjs): es lo que valida el orquestador.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { archivoDeIssue, issueDeArchivo, leerArchivo } from '../orquestador/spec-issue.mjs'
import {
  ordenDelProyecto,
  ramaDelPaso,
  siNo,
  specDelCierre,
  specDelPaso,
  temaDelTitulo,
  tipoDeRama,
} from './plan-a-cola.mjs'
import { leerRegistro, pantallasDe, seccion } from './semilla.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const EJEMPLO = join(KIT, 'scripts/semilla/ejemplo/semilla')
const leer = (f) => readFileSync(join(EJEMPLO, f), 'utf8')
const planes = { app: parse(leer('repos/app/plan.yaml')), web: parse(leer('repos/web/plan.yaml')) }
const registro = leerRegistro(leer('registro.md'))
const pantallas = (rol) => pantallasDe(seccion(leer(`repos/${rol}/semilla.md`), 'Experiencia'))
const paso = (rol, id) => planes[rol].pasos.find((p) => p.id === id)

/** La spec de un paso del ejemplo, con `depende` de relleno. */
const spec = (rol, id, depende = '') =>
  specDelPaso({
    slug: 'turnero',
    rol,
    paso: paso(rol, id),
    carril: planes[rol].carriles.find((c) => c.id === paso(rol, id).carril),
    registro,
    pantallas: pantallas(rol),
    versionSemilla: 1,
    depende,
    proveedorDe: () => 'app',
  })
/** Los campos del frontmatter de una spec, como los lee el orquestador. */
const campos = (texto) => Object.fromEntries(leerArchivo(texto).campos)

test('el orden de todo el proyecto: determinista, el repo de comun primero y web después de app:P02', () => {
  assert.deepEqual(ordenDelProyecto(planes, ['app', 'web']), [
    'app:P01',
    'app:P02',
    'app:P03',
    'app:P04',
    'web:P01',
    'web:P02',
    'web:P03',
  ])
  // Con web primero en comun: web:P01 sigue esperando a app:P02.
  const otro = ordenDelProyecto(planes, ['web', 'app'])
  assert.ok(otro.indexOf('web:P01') > otro.indexOf('app:P02'))
  const ciclo = {
    a: { pasos: [{ id: 'P01', depende_de: ['b:P01'] }] },
    b: { pasos: [{ id: 'P01', depende_de: ['a:P01'] }] },
  }
  assert.throws(() => ordenDelProyecto(ciclo, ['a', 'b']), /ciclo de dependencias/)
  const huerfano = { a: { pasos: [{ id: 'P01', depende_de: ['b:P99'] }] } }
  assert.throws(
    () => ordenDelProyecto(huerfano, ['a']),
    /a:P01 depende de b:P99, que no es un paso del proyecto/,
  )
})

test('la rama: el tipo por la primera palabra, el tema sin tildes y cortado en un guion', () => {
  assert.equal(tipoDeRama('arreglar el login'), 'fix')
  assert.equal(tipoDeRama('Corregir la fecha'), 'fix')
  assert.equal(tipoDeRama('documentar el contrato'), 'docs')
  assert.equal(tipoDeRama('reorganizar los módulos'), 'refactor')
  assert.equal(tipoDeRama('optimizar la agenda'), 'perf')
  assert.equal(tipoDeRama('probar las carreras'), 'test')
  assert.equal(tipoDeRama('crear las tablas'), 'feat')
  assert.equal(
    temaDelTitulo('mostrar la agenda del día y de la semana'),
    'mostrar-la-agenda-del-dia-y-de-la-semana',
  )
  const largo = temaDelTitulo(
    'publicar la versión dos del contrato de la agenda pública con permisos',
  )
  assert.ok(largo.length <= 40 && !largo.endsWith('-'), largo)
  assert.equal(largo, 'publicar-la-version-dos-del-contrato-de')
  assert.equal(ramaDelPaso(paso('app', 'P02')), 'feat/p02-publicar-el-contrato-agenda-publica-v1')
  assert.deepEqual(
    [siNo(true), siNo(false), siNo('si'), siNo('no'), siNo(undefined)],
    ['si', 'no', 'si', 'no', 'no'],
  )
})

test('la spec de app:P01: ruteo, carril, paso, decisiones con su texto, revisor y sin pantallas', () => {
  const t = spec('app', 'P01')
  assert.deepEqual(campos(t), {
    titulo: 'crear las tablas de turnos con su rls',
    rama: 'feat/p01-crear-las-tablas-de-turnos-con-su-rls',
    conflicto: 'datos',
    planificar: 'si',
    nivel: 'capaz',
    effort: 'xhigh',
    paso: 'P01',
  })
  assert.match(
    t,
    /^«crear las tablas de turnos con su rls»: paso P01 del plan de turnero-app \(semilla v1, riesgo rojo\)\.$/m,
  )
  assert.match(t, /^- \*\*B1\*\* · Roles: Cliente sin cuenta; barbero y dueño con cuenta$/m)
  assert.match(t, /^- \*\*F1\*\* · Choque de reservas: /m)
  assert.match(t, /^Terminado cuando: cada fila de la matriz de seguridad tiene su prueba/m)
  assert.match(t, /carril `datos` \(dueño de `supabase\/`, `contratos\/`\)/)
  assert.match(t, /^Este paso no dibuja pantallas: .*PT409/m)
  assert.match(t, /^`pnpm db:reset && pnpm db:probar` — nivel 2/m)
  assert.match(t, /segunda lectura del agente `revisor`/)
})

test('app:P02 publica el contrato; web:P01 lo adopta desde turnero-app; P03 trae sus estados', () => {
  assert.match(
    spec('app', 'P02'),
    /publica el contrato `agenda-publica@1`: suma `provee: \[agenda-publica@1\]`/,
  )
  const web = spec('web', 'P01', 'turnero-app:feat/p02-publicar-el-contrato-agenda-publica-v1')
  assert.equal(campos(web).depende, 'turnero-app:feat/p02-publicar-el-contrato-agenda-publica-v1')
  assert.match(
    web,
    /adopta el contrato `agenda-publica@1`: copia `contratos\/agenda-publica@1\.json` de main de `turnero-app`/,
  )
  assert.match(web, /suma `consume: \[agenda-publica@1\]`/)
  assert.equal(campos(web).planificar, 'no')
  assert.ok(!web.includes('`revisor`'), 'sin revisor')
  const p03 = spec('app', 'P03', 'T1')
  assert.match(
    p03,
    /^- \*\*Agenda del día\*\* \(`\/agenda`, barbero, dueño\): vacío, carga, error, sin permiso, sin conexión$/m,
  )
  assert.match(
    p03,
    /^- \*\*Semana\*\* \(`\/agenda\/semana`, dueño\): vacío, carga, error, sin permiso, sin conexión$/m,
  )
  assert.ok(!p03.includes('/barberos'))
  assert.match(
    spec('web', 'P03'),
    /^- \*\*Cancelar\*\* \(`\/cancelar\/\[codigo\]`\): código inválido, fuera de plazo, hecho$/m,
  )
})

test('un título con «: », «#», corchetes y comillas vuelve igual del issue (si no, el paso se recrearía en cada vuelta)', () => {
  const titulo = 'probar: pagos #2 [x] "y"'
  const texto = specDelPaso({
    slug: 'turnero',
    rol: 'app',
    paso: { ...paso('app', 'P03'), titulo },
    registro,
    pantallas: [],
    versionSemilla: 1,
    depende: 'T1',
  })
  const issue = issueDeArchivo(texto)
  const vuelta = campos(archivoDeIssue({ number: 7, title: issue.titulo, body: issue.cuerpo }))
  assert.equal(vuelta.titulo, titulo)
  assert.equal(vuelta.paso, 'P03')
  assert.equal(vuelta.rama, 'test/p03-probar-pagos-2-x-y')
})

test('cada spec del ejemplo y el cierre pasan issueDeArchivo, con el bloque yaml que lee el orquestador', () => {
  for (const rol of ['app', 'web'])
    for (const p of planes[rol].pasos) {
      const issue = issueDeArchivo(spec(rol, p.id, 'T1'))
      assert.equal(issue.titulo, p.titulo)
      assert.match(issue.cuerpo, new RegExp(`^\`\`\`yaml\\n[\\s\\S]*\\npaso: ${p.id}\\n\`\`\`\\n`))
    }
  const plantilla = readFileSync(
    join(KIT, 'scripts/orquestador/plantillas/cerrar-construccion.md'),
    'utf8',
  )
  const cierre = specDelCierre(plantilla, {
    repo: 'turnero-app',
    version: 1,
    depende: 'T1 T2 T3 T4',
  })
  assert.ok(!cierre.includes('{{'), 'sin marcadores')
  assert.deepEqual(campos(cierre), {
    titulo: 'cerrar la construcción de turnero-app (semilla v1)',
    rama: 'chore/cerrar-construccion',
    depende: 'T1 T2 T3 T4',
    conflicto: 'docs',
    planificar: 'si',
    nivel: 'capaz',
    effort: 'high',
    al_integrar: 'etiquetar semilla-v1',
    paso: 'cierre',
  })
  assert.match(issueDeArchivo(cierre).cuerpo, /\nal_integrar: etiquetar semilla-v1\n/)
})
