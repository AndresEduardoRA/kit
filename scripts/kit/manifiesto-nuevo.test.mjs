// El manifiesto del proyecto desde la semilla v2 (manifiesto-nuevo.mjs): bloques, contratos, --sumar sin tocar lo que ya estaba y lo
// que se niega a hacer. Con python3 y PyYAML, además, el texto pasa `validar_semilla.py --manifiesto`.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { leerManifiesto } from '../proyecto/manifiesto.mjs'
import { manifiestoDelProyecto, textoDeLaCopia } from './manifiesto-nuevo.mjs'
import { carpetaTemporal } from '../lib/temporal.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const COMUN = parse(
  /^---\n([\s\S]*?)\n---/.exec(
    readFileSync(join(KIT, 'scripts/semilla/ejemplo/semilla/comun.md'), 'utf8'),
  )?.[1] ?? '',
)
const hayPyYaml = spawnSync('python3', ['-c', 'import yaml']).status === 0

/** Que el texto pase el validador de Python (si hay PyYAML). */
function pasaPython(texto) {
  if (!hayPyYaml) return
  const archivo = join(carpetaTemporal('manifiesto-'), 'proyecto.yaml')
  writeFileSync(archivo, texto)
  const r = spawnSync(
    'python3',
    [join(KIT, 'scripts/semilla/validar_semilla.py'), '--manifiesto', archivo],
    {
      encoding: 'utf8',
    },
  )
  assert.equal(r.status, 0, r.stdout + r.stderr)
}

/** Un manifiesto de otro proyecto en la máquina, con un repo en `bloque`. */
const otro = (slug, bloque) => ({
  archivo: `/raiz/z_${slug}/proyecto.yaml`,
  manifiesto: {
    proyecto: slug,
    repos: [{ rol: 'app', nombre: `${slug}-app`, puertos: { bloque } }],
  },
})

test('proyecto nuevo: app en el bloque 5, web en el 6, el contrato con vigentes [1] y provee/consume vacíos', () => {
  const r = manifiestoDelProyecto({ comun: COMUN })
  assert.deepEqual(
    r.crear.map((c) => [c.rol, c.bloque, c.github]),
    [
      ['app', 5, 'AndresEduardoRA/turnero-app'],
      ['web', 6, 'AndresEduardoRA/turnero-web'],
    ],
  )
  assert.deepEqual(r.agregados, ['app', 'web'])
  const m = leerManifiesto(r.texto)
  assert.equal(m.proyecto, 'turnero')
  assert.equal(m.nombre, 'Turnero')
  for (const repo of m.repos) {
    assert.deepEqual([repo.provee, repo.consume, repo.etapa], [[], [], 'construccion'])
  }
  assert.deepEqual(m.contratos, [
    { id: 'agenda-publica', proveedor: 'app', consumidores: ['web'], tipo: 'base', vigentes: [1] },
  ])
  pasaPython(r.texto)
  // La copia: la misma, con su cabecera.
  const copia = textoDeLaCopia(r.texto, 'turnero')
  assert.match(copia, /^# Copia del manifiesto del proyecto turnero/)
  assert.deepEqual(leerManifiesto(copia), m)
  assert.ok(!copia.includes('Vive suelto'))
  pasaPython(copia)
})

test('los bloques saltan los que usan los otros manifiestos de la máquina', () => {
  const r = manifiestoDelProyecto({ comun: COMUN, otros: [otro('otro', 5)] })
  assert.deepEqual(
    r.crear.map((c) => c.bloque),
    [6, 7],
  )
  // Dos manifiestos ajenos con el mismo bloque: falla nombrando a los dos.
  assert.throws(
    () => manifiestoDelProyecto({ comun: COMUN, otros: [otro('uno', 7), otro('dos', 7)] }),
    /mismo bloque[\s\S]*uno-app[\s\S]*dos-app/,
  )
})

// Un manifiesto escrito a mano desde la plantilla: comentarios alineados y sólo app.
const PREVIO = `# Manifiesto de Turnero, a mano.
esquema: proyecto/v1
proyecto: turnero               # la carpeta es z_turnero
nombre: Turnero
semilla: semilla/

repos:
  - rol: app                    # el panel
    nombre: turnero-app
    github: AndresEduardoRA/turnero-app   # cuenta/repo
    etapa: construccion
    semilla: null
    puertos:
      bloque: 8                 # elegido a mano
    provee: []
    consume: []

contratos: [] # todavía nada
`

test('--sumar web: lo que ya estaba queda byte a byte; web entra con el bloque libre y el contrato con sus dos repos', () => {
  const r = manifiestoDelProyecto({ comun: COMUN, previo: PREVIO, sumar: 'web' })
  assert.deepEqual(
    r.crear.map((c) => [c.rol, c.bloque]),
    [['web', 5]],
  )
  const hastaContratos = PREVIO.slice(0, PREVIO.indexOf('contratos:'))
  assert.ok(
    r.texto.startsWith(hastaContratos.trimEnd()),
    'app, sus comentarios y la cabecera, tal cual',
  )
  assert.match(
    r.texto,
    /\n {2}- rol: web\n {4}nombre: turnero-web\n[\s\S]*puertos: \{ bloque: 5 \}/,
  )
  assert.match(r.texto, /\ncontratos: # todavía nada\n {2}- id: agenda-publica\n/)
  const m = leerManifiesto(r.texto)
  assert.deepEqual(
    m.repos.map((x) => x.rol),
    ['app', 'web'],
  )
  assert.deepEqual(m.contratos?.[0]?.consumidores, ['web'])
  pasaPython(r.texto)
})

test('a un contrato que ya está sólo se le suman los consumidores que faltan; vigentes no se toca', () => {
  const previo = PREVIO.replace(
    'contratos: [] # todavía nada\n',
    'contratos:\n  - id: agenda-publica\n    proveedor: app\n    consumidores: []\n    tipo: base\n    vigentes: [1, 2]\n',
  )
  const r = manifiestoDelProyecto({ comun: COMUN, previo, sumar: 'web' })
  const m = leerManifiesto(r.texto)
  assert.deepEqual(m.contratos, [
    {
      id: 'agenda-publica',
      proveedor: 'app',
      consumidores: ['web'],
      tipo: 'base',
      vigentes: [1, 2],
    },
  ])
  assert.match(r.texto, /\n {4}consumidores: \[web\]\n {4}tipo: base\n {4}vigentes: \[1, 2\]\n/)
  // Con la lista en bloque, el consumidor se agrega como un elemento más.
  const enBloque = previo.replace('consumidores: []', 'consumidores:\n      - crm')
  const comun = { ...COMUN, repos: [...COMUN.repos, { ...COMUN.repos[1], rol: 'crm' }] }
  const conCrm = manifiestoDelProyecto({
    comun: { ...comun, contratos: [{ ...COMUN.contratos[0], consumidores: ['crm', 'web'] }] },
    previo: enBloque.replace(
      '  - rol: app',
      '  - rol: crm\n    nombre: turnero-crm\n    github: A/turnero-crm\n    etapa: mantenimiento\n    semilla: null\n    puertos: { bloque: 9 }\n\n  - rol: app',
    ),
    sumar: 'web',
  })
  assert.match(conCrm.texto, /consumidores:\n {6}- crm\n {6}- web\n/)
})

test('volver a correr: nada que crear con las carpetas hechas, y el manifiesto byte a byte igual', () => {
  const primero = manifiestoDelProyecto({ comun: COMUN })
  const segundo = manifiestoDelProyecto({
    comun: COMUN,
    previo: primero.texto,
    ocupadas: new Set(['app', 'web']),
  })
  assert.equal(segundo.texto, primero.texto)
  assert.equal(segundo.cambio, false)
  assert.deepEqual(segundo.crear, [])
  assert.deepEqual(
    segundo.saltados.map((s) => s.rol),
    ['app', 'web'],
  )
  // Un corte después de escribir el manifiesto: la vuelta siguiente crea lo que falta, con el bloque reservado.
  const tercero = manifiestoDelProyecto({
    comun: COMUN,
    previo: primero.texto,
    ocupadas: new Set(['app']),
  })
  assert.deepEqual(
    tercero.crear.map((c) => [c.rol, c.bloque]),
    [['web', 6]],
  )
})

test('una carpeta ocupada se salta y no entra al manifiesto; si era el proveedor de un contrato, no valida', () => {
  const r = manifiestoDelProyecto({ comun: COMUN, ocupadas: new Set(['web']) })
  assert.deepEqual(
    r.crear.map((c) => c.rol),
    ['app'],
  )
  assert.deepEqual(r.saltados, [{ rol: 'web', motivo: 'z_turnero/web ya existe y no está vacía' }])
  assert.deepEqual(leerManifiesto(r.texto).contratos?.[0]?.consumidores, [])
  assert.throws(
    () => manifiestoDelProyecto({ comun: COMUN, ocupadas: new Set(['app']) }),
    /proveedor: no es un repo del manifiesto/,
  )
})

test('se niega: repo nuevo sin --sumar, --sumar sin proyecto, mantenimiento fuera del manifiesto, --bloque con varios', () => {
  assert.throws(
    () => manifiestoDelProyecto({ comun: COMUN, previo: PREVIO }),
    /el proyecto ya existe: para sumar web usa --sumar/,
  )
  assert.throws(
    () => manifiestoDelProyecto({ comun: COMUN, sumar: 'web' }),
    /no tiene manifiesto: corre sin --sumar/,
  )
  assert.throws(
    () => manifiestoDelProyecto({ comun: COMUN, previo: PREVIO, sumar: 'app' }),
    /ya está en el manifiesto/,
  )
  const conMantenimiento = {
    ...COMUN,
    repos: [{ ...COMUN.repos[0], etapa: 'mantenimiento' }, COMUN.repos[1]],
  }
  assert.throws(
    () => manifiestoDelProyecto({ comun: conMantenimiento }),
    /turnero-app: en mantenimiento y fuera del manifiesto\. Agrégalo a mano[\s\S]*heredado o bloque/,
  )
  assert.throws(
    () => manifiestoDelProyecto({ comun: COMUN, bloque: 7 }),
    /--bloque 7 sirve sólo si se suma un solo repo al manifiesto \(aquí son 2\)/,
  )
  // Con un solo repo, --bloque vale si nadie lo usa.
  assert.deepEqual(
    manifiestoDelProyecto({ comun: COMUN, previo: PREVIO, sumar: 'web', bloque: 9 }).crear[0]
      ?.bloque,
    9,
  )
  assert.throws(
    () =>
      manifiestoDelProyecto({
        comun: COMUN,
        previo: PREVIO,
        sumar: 'web',
        bloque: 6,
        otros: [otro('otro', 6)],
      }),
    /el bloque 6 ya lo usa otro-app \(\/raiz\/z_otro\/proyecto\.yaml\)/,
  )
})
