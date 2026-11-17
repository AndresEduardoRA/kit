import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  bloqueLibre,
  bloquesUsados,
  contratosDelRepo,
  cuentaDelRepo,
  githubDeRepo,
  leerManifiesto,
  leerManifiestoDe,
  manifiestosDeLaRaiz,
  nombreDelRepo,
  problemasDelManifiesto,
  puertosDelRepo,
  raizDeProyectos,
  repoPropio,
} from './manifiesto.mjs'
import { carpetaTemporal } from '../lib/temporal.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
// Una copia del manifiesto real de calesa (puertos heredados en app, bloque 5 en web), sólo de lectura.
const CALESA = readFileSync(join(AQUI, 'fixtures/calesa.proyecto.yaml'), 'utf8')

/** Un manifiesto mínimo de un proyecto: un repo por entrada de `puertos` (un número es un bloque; `null`, heredados). */
const yaml = (slug, puertos, extra = '') =>
  `esquema: proyecto/v1
proyecto: ${slug}
nombre: ${slug}
semilla: null
repos:
${puertos
  .map((p, i) => {
    const rol = ['app', 'web', 'crm'][i]
    return `  - rol: ${rol}
    nombre: ${slug}-${rol}
    github: Cuenta/${slug}-${rol}
    etapa: construccion
    semilla: null
    puertos: ${p === null ? '{ heredado: { api: 54621, base: 54622, app: 3000 } }' : `{ bloque: ${p} }`}
    provee: []
    consume: []`
  })
  .join('\n')}
contratos: []
${extra}`

function raizConManifiestos(manifiestos) {
  const raiz = carpetaTemporal('proyectos-')
  for (const [slug, texto] of Object.entries(manifiestos)) {
    mkdirSync(join(raiz, `z_${slug}`))
    writeFileSync(join(raiz, `z_${slug}`, 'proyecto.yaml'), texto)
  }
  mkdirSync(join(raiz, '_herramientas')) // lo que no es z_* no se lee
  return raiz
}

test('el manifiesto real de calesa se lee: repo propio por nombre, cuenta, puertos y contratos', () => {
  const m = leerManifiesto(CALESA)
  assert.equal(m.proyecto, 'calesa')
  const app = repoPropio(m, 'calesa-app')
  const web = repoPropio(m, 'calesa-web')
  assert.equal(cuentaDelRepo(app), 'AndresEduardoRA')
  assert.deepEqual(puertosDelRepo(app), { heredado: { api: 54621, base: 54622, app: 3000 } })
  assert.deepEqual(puertosDelRepo(web), { bloque: 5 })
  assert.deepEqual(contratosDelRepo(m, web), { provee: [], consume: [], contratos: [] })
  assert.throws(
    () => repoPropio(m, 'calesa-crm'),
    /no está en el manifiesto de calesa.*calesa-app, calesa-web/,
  )
  // Sin remoto vale la carpeta: un repo recién creado vive en z_<proyecto>/<rol>.
  assert.equal(repoPropio(m, 'web'), web)
  assert.equal(repoPropio(m, 'app'), app)
  // Un repo que en GitHub se llama distinto se reconoce por el nombre de su remoto.
  const ajeno = leerManifiesto(CALESA.replace('AndresEduardoRA/calesa-app', 'Otra/calesa.app'))
  assert.equal(repoPropio(ajeno, 'calesa.app').nombre, 'calesa-app')
})

test('un manifiesto de un solo repo no necesita el nombre; los contratos se reparten por repo', () => {
  const m = leerManifiesto(
    `esquema: proyecto/v1
proyecto: tienda
nombre: Tienda
semilla: null
repos:
  - { rol: app, nombre: tienda-app, github: C/tienda-app, etapa: construccion, semilla: null, puertos: { bloque: 6 }, provee: [agenda@1], consume: [] }
  - { rol: web, nombre: tienda-web, github: C/tienda-web, etapa: construccion, semilla: null, puertos: { bloque: 7 }, provee: [], consume: [agenda@1] }
  - { rol: crm, nombre: tienda-crm, github: C/tienda-crm, etapa: construccion, semilla: null, puertos: { bloque: 8 }, provee: [], consume: [] }
contratos:
  - { id: agenda, proveedor: app, consumidores: [web], tipo: base, vigentes: [1] }
`,
  )
  const [app, web, crm] = m.repos
  assert.deepEqual(contratosDelRepo(m, app).provee, ['agenda@1'])
  assert.equal(contratosDelRepo(m, web).contratos[0].id, 'agenda')
  assert.deepEqual(contratosDelRepo(m, crm).contratos, [])
  const solo = leerManifiesto(yaml('uno', [6]))
  assert.equal(repoPropio(solo, 'cualquiera-que-no-es').nombre, 'uno-app')
})

test('dos proyectos con bloques distintos: cada manifiesto da el suyo y el libre es otro', () => {
  const raiz = raizConManifiestos({ alfa: yaml('alfa', [5]), beta: yaml('beta', [6]) })
  const todos = manifiestosDeLaRaiz(raiz)
  assert.deepEqual(
    todos.map((x) => x.manifiesto.proyecto),
    ['alfa', 'beta'],
  )
  assert.deepEqual(
    bloquesUsados(todos).map((u) => u.bloque),
    [5, 6],
  )
  assert.equal(bloqueLibre(todos), 7)
  // El orden de reparto es 5,6,7,8,9,1,2,3 (nunca el 4).
  const ocho = raizConManifiestos(
    Object.fromEntries([5, 6, 7, 8, 9, 1, 2].map((b) => [`p${b}`, yaml(`p${b}`, [b])])),
  )
  assert.equal(bloqueLibre(manifiestosDeLaRaiz(ocho)), 3)
  const lleno = raizConManifiestos(
    Object.fromEntries([5, 6, 7, 8, 9, 1, 2, 3].map((b) => [`p${b}`, yaml(`p${b}`, [b])])),
  )
  assert.throws(
    () => bloqueLibre(manifiestosDeLaRaiz(lleno)),
    /no queda un bloque de puertos libre/,
  )
})

test('un repo con puertos heredados no ocupa ningún bloque', () => {
  const raiz = raizConManifiestos({ calesa: CALESA.replace('bloque: 5', 'bloque: 6') })
  assert.deepEqual(
    bloquesUsados(manifiestosDeLaRaiz(raiz)).map((u) => u.bloque),
    [6],
  )
  assert.equal(bloqueLibre(manifiestosDeLaRaiz(raiz)), 5)
})

test('bloque repetido: dos manifiestos con el mismo bloque fallan nombrando los dos', () => {
  const raiz = raizConManifiestos({ uno: yaml('uno', [5]), dos: yaml('dos', [5]) })
  assert.throws(
    () => bloqueLibre(manifiestosDeLaRaiz(raiz)),
    (e) =>
      e.message.includes('mismo bloque') &&
      e.message.includes('uno-app') &&
      e.message.includes('dos-app') &&
      e.message.includes(join(raiz, 'z_uno', 'proyecto.yaml')) &&
      e.message.includes(join(raiz, 'z_dos', 'proyecto.yaml')),
  )
})

test('manifiesto ausente: el repo funciona como antes (null) y una raíz sin z_* no tiene manifiestos', () => {
  const vacio = carpetaTemporal('sin-manifiesto-')
  assert.equal(leerManifiestoDe(vacio), null)
  assert.deepEqual(manifiestosDeLaRaiz(vacio), [])
  assert.deepEqual(manifiestosDeLaRaiz(join(vacio, 'no-existe')), [])
  assert.equal(bloqueLibre([]), 5)
  // La CLI no imprime nada y sale con 0: el guion de bash cae a lo de antes.
  const r = spawnSync('node', [join(AQUI, 'manifiesto.mjs'), 'cuenta', vacio], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
})

test('un manifiesto inválido dice qué campo y con qué comando validarlo', () => {
  const roto = yaml('equis', [4])
    .replace('esquema: proyecto/v1', 'esquema: v0')
    .replace('nombre: equis-app', 'nombre: otro')
  assert.throws(
    () => leerManifiesto(roto, 'ruta/proyecto.yaml'),
    (e) =>
      e.message.startsWith('ruta/proyecto.yaml: manifiesto inválido') &&
      e.message.includes('esquema: debe ser proyecto/v1') &&
      e.message.includes('repos[app].nombre: debe ser equis-app') &&
      e.message.includes('repos[app].puertos.bloque: 1 a 9, nunca 4') &&
      e.message.includes('validar_semilla.py --manifiesto ruta/proyecto.yaml'),
  )
  assert.throws(() => leerManifiesto('a: [', 'm.yaml'), /m\.yaml: no es YAML válido/)
  assert.deepEqual(problemasDelManifiesto('texto'), ['el archivo no es un mapa YAML'])
  const sinPuertos = yaml('equis', [5]).replace('puertos: { bloque: 5 }', 'puertos: {}')
  assert.deepEqual(problemasDelManifiesto(parseYaml(sinPuertos)), [
    'repos[app].puertos: lleva bloque: N o heredado: {api, base, app}',
  ])
  const heredadoMalo = yaml('equis', [null]).replace('api: 54621', 'api: "x"')
  assert.match(
    problemasDelManifiesto(parseYaml(heredadoMalo)).join('\n'),
    /puertos\.heredado\.api: debe ser un número/,
  )
  const bloqueDoble = yaml('equis', [5, 5])
  assert.match(problemasDelManifiesto(parseYaml(bloqueDoble)).join('\n'), /el 5 ya es de app/)
  const contratoSuelto = yaml('equis', [5]).replace('provee: []', 'provee: [fantasma@1]')
  assert.match(
    problemasDelManifiesto(parseYaml(contratoSuelto)).join('\n'),
    /el contrato «fantasma» no está en contratos/,
  )
})

test('el nombre del repo sale del remoto, o de la carpeta si no hay', () => {
  assert.equal(
    nombreDelRepo('https://github.com/AndresEduardoRA/calesa-app.git', '/x/app'),
    'calesa-app',
  )
  assert.equal(
    nombreDelRepo('git@github.com:Cuenta/tienda-web.git\n'.trim(), '/x/web'),
    'tienda-web',
  )
  assert.equal(nombreDelRepo('/tmp/origin.git', '/x/app'), 'origin')
  assert.equal(nombreDelRepo(null, '/x/proyectos/app/'), 'app')
})

test('la raíz de proyectos es <kit>/../..', () => {
  assert.equal(raizDeProyectos('/p/_herramientas/kit'), '/p')
})

test('la CLI da el nombre, la cuenta y el bloque del repo propio (por el remoto)', () => {
  const raiz = carpetaTemporal('cli-')
  execFileSync('git', ['init', '-q', '-b', 'main', raiz])
  execFileSync('git', [
    '-C',
    raiz,
    'remote',
    'add',
    'origin',
    'https://github.com/AndresEduardoRA/calesa-web.git',
  ])
  mkdirSync(join(raiz, '.proyecto'))
  writeFileSync(join(raiz, '.proyecto/proyecto.yaml'), CALESA)
  const cli = (campo) =>
    execFileSync('node', [join(AQUI, 'manifiesto.mjs'), campo, raiz], { encoding: 'utf8' }).trim()
  assert.equal(cli('proyecto'), 'calesa')
  assert.equal(cli('nombre'), 'calesa-web')
  assert.equal(cli('cuenta'), 'AndresEduardoRA')
  assert.equal(cli('bloque'), '5')
  // El de app tiene puertos heredados: no hay bloque que imprimir.
  execFileSync('git', [
    '-C',
    raiz,
    'remote',
    'set-url',
    'origin',
    'https://github.com/AndresEduardoRA/calesa-app.git',
  ])
  assert.equal(cli('nombre'), 'calesa-app')
  assert.equal(cli('bloque'), '')
  // El github de un hermano por su nombre (las dependencias <repo>:<rama> del orquestador); uno que no está, nada.
  const github = (nombre) =>
    execFileSync('node', [join(AQUI, 'manifiesto.mjs'), 'github', nombre, raiz], {
      encoding: 'utf8',
    }).trim()
  assert.equal(github('calesa-web'), githubDeRepo(leerManifiesto(CALESA), 'calesa-web'))
  assert.match(github('calesa-web'), /^AndresEduardoRA\/calesa-web$/)
  assert.equal(github('calesa-crm'), '')
  // Inválido: sale con 1 y dice el campo.
  writeFileSync(
    join(raiz, '.proyecto/proyecto.yaml'),
    CALESA.replace('esquema: proyecto/v1', 'esquema: v0'),
  )
  const r = spawnSync('node', [join(AQUI, 'manifiesto.mjs'), 'cuenta', raiz], { encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /esquema: debe ser proyecto\/v1[\s\S]*validar_semilla\.py --manifiesto/)
})
