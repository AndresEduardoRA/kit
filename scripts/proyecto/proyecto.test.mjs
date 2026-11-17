import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { archivoDeIssue } from '../orquestador/spec-issue.mjs'
import { leerManifiesto } from './manifiesto.mjs'
import { instalarGh, leerEstado } from './proyecto-gh-falso.mjs'
import {
  cabecera,
  conLoDeLosRepos,
  difierenLosCamposDelProyecto,
  lineasDelRepo,
  marca,
  resumenDelProyecto,
  retroConBloque,
  retroDeCuerpo,
  unidadesDelResumen,
} from './proyecto-texto.mjs'
import { carpetaTemporal } from '../lib/temporal.mjs'

// `proyecto.sh` con un `gh` falso de dos repos de cuentas distintas (cuentaa/demo-app y cuentab/demo-web): estado, sincronizar, reconstruir,
// resumen (a un ntfy falso) e instalar-resumen (con un `systemctl` falso). Lo puro, aparte, al principio.
const GUION = join(dirname(fileURLToPath(import.meta.url)), 'proyecto.sh')

const SUELTO = `# Manifiesto de Demo (proyecto/v1). Suelto.
esquema: proyecto/v1
proyecto: demo
nombre: Demo
semilla: semilla/

repos:
  - rol: app
    nombre: demo-app
    github: cuentaa/demo-app # la cuenta A
    etapa: construccion   # lo manda el repo
    semilla: null
    puertos:
      bloque: 5
    provee: []
    consume: []

  - rol: web
    nombre: demo-web
    github: cuentab/demo-web
    etapa: construccion
    semilla: null
    puertos:
      bloque: 6
    provee: []
    consume: []

contratos:
  - id: agenda
    proveedor: app
    consumidores: [web]
    tipo: base
    vigentes: [1]
`

/** La copia de un repo: el suelto con cambios de texto (\`[de, a]\`). */
const copia = (...cambios) => cambios.reduce((t, [de, a]) => t.replace(de, a), SUELTO)
const MANTENIMIENTO = ['    etapa: construccion   # lo manda el repo', '    etapa: mantenimiento']

function mundo(estado = {}) {
  const dir = carpetaTemporal('proyecto-')
  const raiz = join(dir, 'proyectos')
  mkdirSync(join(raiz, 'z_demo'), { recursive: true })
  writeFileSync(join(raiz, 'z_demo/proyecto.yaml'), SUELTO)
  const entorno = instalarGh(join(dir, 'gh'), { cuentas: ['cuentaa', 'cuentab'], ...estado })
  mkdirSync(join(dir, 'home'))
  const env = {
    ...process.env,
    ...entorno,
    HOME: join(dir, 'home'),
    PROYECTOS_RAIZ: raiz,
    PROYECTO_AHORA: '2026-11-17T12:00:00Z',
  }
  delete env.GH_TOKEN
  const correr = (...args) => {
    const r = spawnSync('bash', [GUION, ...args], { encoding: 'utf8', env })
    return { estado: r.status, salida: r.stdout, error: r.stderr }
  }
  return { dir, raiz, env, correr, gh: join(dir, 'gh') }
}

const run = (sha, conclusion, cuando = '2026-11-16T20:00:00Z') => ({
  conclusion,
  created_at: cuando,
  id: 7,
  head_sha: sha,
})
const pr = (numero, sha, creado, titulo = 'algo') => ({
  number: numero,
  title: titulo,
  head: { ref: `feat/x${numero}`, sha },
  created_at: creado,
})

// ---------- lo puro ----------

test('marca: el mismo criterio que estado.sh', () => {
  assert.equal(marca('success'), '✓')
  assert.equal(marca('timed_out'), '✗')
  assert.equal(marca(''), '·')
  assert.equal(marca('in_progress'), '·')
})

test('lineasDelRepo: un PR con CI verde pero de hace días va en rojo; la cola nunca es un total exacto', () => {
  const l = lineasDelRepo(
    {
      github: 'c/r',
      prs: [
        {
          numero: 3,
          titulo: 'x',
          rama: 'feat/x',
          creado: '2026-11-05T10:00:00Z',
          listo: 'success',
        },
      ],
      ci: null,
      noche: null,
      trabadas: [],
      preguntas: [],
      urgentes: [],
      enCola: 100,
    },
    new Date('2026-11-17T12:00:00Z'),
  )
  assert.match(l[0].texto, /PR #3 abierto desde 2026-11-05 .* lleva 12 días abierto/)
  assert.equal(l[0].marca, '✗')
  assert.ok(l.some((x) => x.texto === 'más de 99 en la cola'))
  assert.ok(l.some((x) => x.texto === 'CI de main: sin corridas todavía'))
})

test('resumenDelProyecto: sólo lo rojo, o «todo en verde»; lo que no se pudo mirar no es verde', () => {
  const m = { nombre: 'Demo', proyecto: 'demo' }
  const verde = resumenDelProyecto(m, [
    { nombre: 'demo-app', lineas: [{ marca: '✓', texto: 'ok' }] },
  ])
  assert.deepEqual([verde.rojo, verde.mensaje], [false, 'Todo en verde en 1 repo.'])
  const mal = resumenDelProyecto(m, [
    {
      nombre: 'demo-app',
      lineas: [
        { marca: '✓', texto: 'ok' },
        { marca: '✗', texto: '#4 trabada: t' },
      ],
    },
    { nombre: 'demo-web', lineas: [{ marca: '·', texto: 'sin red', incompleto: true }] },
  ])
  assert.equal(mal.rojo, true)
  assert.equal(mal.mensaje, '✗ demo-app: #4 trabada: t\n· demo-web: sin red')
})

test('retroDeCuerpo y retroConBloque: la sección, y un bloque por repo que se reescribe sin tocar los demás', () => {
  const cuerpo =
    '## Qué\n\nx\n\n## Retro\nTexto.\n\n### Tareas trabadas\n\n- ninguna\n\n## Verificación\n\ny\n'
  assert.equal(retroDeCuerpo(cuerpo), 'Texto.\n\n### Tareas trabadas\n\n- ninguna')
  assert.equal(retroDeCuerpo('## Qué\nx'), null)
  const a = retroConBloque('', 'Demo', {
    repo: 'demo-app',
    pr: 9,
    fecha: '2026-11-10',
    retro: 'uno',
  })
  const b = retroConBloque(a, 'Demo', {
    repo: 'demo-web',
    pr: 4,
    fecha: '2026-11-12',
    retro: 'dos',
  })
  const c = retroConBloque(b, 'Demo', {
    repo: 'demo-app',
    pr: 9,
    fecha: '2026-11-10',
    retro: 'uno, corregido',
  })
  assert.match(c, /^# Retro de la construcción de Demo/)
  assert.ok(
    c.includes('<!-- retro: demo-app -->\n## demo-app · PR #9 (2026-11-10)\n\nuno, corregido\n'),
  )
  assert.ok(c.includes('## demo-web · PR #4 (2026-11-12)\n\ndos\n'))
  assert.equal(
    retroConBloque(c, 'Demo', {
      repo: 'demo-app',
      pr: 9,
      fecha: '2026-11-10',
      retro: 'uno, corregido',
    }),
    c,
  )
})

test('conLoDeLosRepos: sólo cambia lo que difiere y deja los comentarios y el resto como estaban', () => {
  const app = leerManifiesto(
    copia(
      MANTENIMIENTO,
      [
        '    semilla: null\n    puertos:\n      bloque: 5',
        '    semilla: semilla-v2\n    puertos:\n      bloque: 5',
      ],
      [
        '    provee: []\n    consume: []\n\n  - rol: web',
        '    provee: [agenda@1]\n    consume: []\n\n  - rol: web',
      ],
      ['vigentes: [1]', 'vigentes: [1, 2]'],
    ),
  )
  const { texto, cambios } = conLoDeLosRepos(SUELTO, [{ rol: 'app', copia: app }])
  assert.equal(cambios.length, 4)
  assert.ok(texto.includes('github: cuentaa/demo-app # la cuenta A'))
  assert.ok(texto.includes('etapa: mantenimiento   # lo manda el repo'))
  assert.ok(texto.includes('semilla: semilla-v2'))
  assert.ok(texto.includes('provee: [agenda@1]'))
  assert.ok(texto.includes('vigentes: [1, 2]'))
  assert.equal(leerManifiesto(texto).repos[1].etapa, 'construccion')
  assert.deepEqual(conLoDeLosRepos(texto, [{ rol: 'app', copia: app }]).cambios, [])
})

test('conLoDeLosRepos: una clave que falta en el suelto se agrega después de la que corresponde', () => {
  const sin = SUELTO.replace(
    '    semilla: null\n    puertos:\n      bloque: 5',
    '    puertos:\n      bloque: 5',
  )
  const app = leerManifiesto(
    copia([
      '    semilla: null\n    puertos:\n      bloque: 5',
      '    semilla: semilla-v2\n    puertos:\n      bloque: 5',
    ]),
  )
  const { texto } = conLoDeLosRepos(sin, [{ rol: 'app', copia: app }])
  assert.match(
    texto,
    /etapa: construccion {3}# lo manda el repo\n {4}semilla: semilla-v2\n {4}puertos:/,
  )
})

test('difierenLosCamposDelProyecto: puertos, github y consumidores son del proyecto; etapa y provee, no', () => {
  const s = leerManifiesto(SUELTO)
  assert.deepEqual(difierenLosCamposDelProyecto(s, leerManifiesto(copia(MANTENIMIENTO))), [])
  const d = difierenLosCamposDelProyecto(
    s,
    leerManifiesto(copia(['bloque: 6', 'bloque: 7'], ['consumidores: [web]', 'consumidores: []'])),
  )
  assert.equal(d.length, 2)
  assert.match(d[0], /^repos\[web\]/)
  assert.match(d[1], /^contratos\[agenda\]/)
})

test('cabecera: ASCII tal cual; con tildes o símbolos, RFC 2047', () => {
  assert.equal(cabecera('[demo] Resumen diario'), '[demo] Resumen diario')
  assert.equal(cabecera('[demo] ✓'), `=?UTF-8?B?${Buffer.from('[demo] ✓').toString('base64')}?=`)
})

test('unidadesDelResumen: 08:00 de La Paz, sincronizar sin frenar al resumen', () => {
  const { servicio, timer } = unidadesDelResumen({
    kit: '/k',
    raiz: '/p',
    home: '/h',
    path: '/usr/bin',
  })
  assert.match(timer, /OnCalendar=\*-\*-\* 08:00:00 America\/La_Paz/)
  assert.match(timer, /Persistent=true/)
  assert.match(
    servicio,
    /ExecStart=-\/usr\/bin\/env bash \/k\/scripts\/proyecto\/proyecto\.sh sincronizar --todos/,
  )
  assert.match(
    servicio,
    /\nExecStart=\/usr\/bin\/env bash \/k\/scripts\/proyecto\/proyecto\.sh resumen --todos/,
  )
})

// ---------- estado ----------

const ROJO = {
  'cuentaa/demo-app': {
    pulls: [
      pr(12, 'aaa', '2026-11-05T10:00:00Z', 'feat: agenda'),
      pr(13, 'bbb', '2026-11-17T09:00:00Z', 'fix: algo'),
    ],
    checks: { aaa: 'failure', bbb: 'success' },
    runs: {
      push: run('0123456789abcdef', 'success'),
      schedule: run('fedcba9876543210', 'failure'),
    },
    issues: [
      { number: 7, title: 'T7 agenda', labels: [{ name: 'cola' }, { name: 'cola:trabada' }] },
      { number: 8, title: 'T8 otra', labels: [{ name: 'cola' }, { name: 'cola:urgente' }] },
      { number: 9, title: 'T9 más', labels: [{ name: 'cola' }] },
      {
        number: 10,
        title: 'un PR que la API cuela entre los issues',
        labels: [{ name: 'cola:trabada' }],
        pull_request: {},
      },
    ],
  },
  'cuentab/demo-web': {
    pulls: [],
    runs: { push: run('11112222', 'success') },
    issues: [],
  },
}

test('estado: dos repos de dos cuentas, cada uno con el token de la suya; lo rojo con ✗', () => {
  const w = mundo({ repos: structuredClone(ROJO) })
  const r = w.correr('estado', 'z_demo')
  assert.equal(r.estado, 0, r.error)
  assert.match(r.salida, /^Demo \(demo\) — 2 repos\n {2}demo-app · construcción\n/)
  assert.match(
    r.salida,
    /✗ PR #12 abierto desde 2026-11-05 \(feat\/x12\): feat: agenda — CI en rojo, lleva 12 días abierto/,
  )
  assert.match(r.salida, /✓ PR #13 abierto desde 2026-11-17 \(feat\/x13\): fix: algo\n/)
  assert.match(r.salida, /✓ CI de main \(01234567, 2026-11-16T20:00:00Z\)/)
  assert.match(
    r.salida,
    /✗ e2e de la noche \(fedcba98, .*gh run view 7 -R cuentaa\/demo-app --log-failed/,
  )
  assert.match(r.salida, /✗ #7 trabada: T7 agenda/)
  assert.doesNotMatch(r.salida, /#10/)
  assert.match(r.salida, /· #8 urgente: T8 otra/)
  assert.match(r.salida, /· 3 en la cola/)
  assert.match(
    r.salida,
    /demo-web · construcción\n {4}✓ sin PR abiertos\n {4}✓ CI de main \(11112222/,
  )
  assert.match(r.salida, /✓ ninguna trabada ni con pregunta\n {4}· 0 en la cola/)
  const tokens = readFileSync(join(w.gh, 'llamadas.log'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .map((c) => [/repos\/([^/]+)/.exec(c.args.at(-1))?.[1], c.token])
  for (const [cuenta, token] of tokens) assert.equal(token, `token-${cuenta}`)
})

test('estado: sin token de una cuenta, esa línea lo dice y el resto sigue', () => {
  const w = mundo({ cuentas: ['cuentaa'], repos: structuredClone(ROJO) })
  const r = w.correr('estado', 'demo')
  assert.equal(r.estado, 0)
  assert.match(r.salida, /demo-app · construcción\n {4}✗ PR #12/)
  assert.match(r.salida, /demo-web · construcción\n {4}✗ sin acceso a cuentab \(gh auth login\)\n/)
})

test('estado: sin red dice sólo lo local y no frena', () => {
  const w = mundo({
    repos: { 'cuentaa/demo-app': { sinRed: true }, 'cuentab/demo-web': { sinRed: true } },
  })
  const r = w.correr('estado', '--todos')
  assert.equal(r.estado, 0)
  assert.match(r.salida, /demo-app · construcción\n {4}· GitHub no respondió: sólo lo local/)
  assert.match(r.salida, /demo-web · construcción\n {4}· GitHub no respondió/)
})

test('estado: un repo sin workflow ci no es un fallo de red', () => {
  const w = mundo({
    repos: { 'cuentaa/demo-app': { sinWorkflow: true }, 'cuentab/demo-web': { sinWorkflow: true } },
  })
  const r = w.correr('estado', 'z_demo')
  assert.match(r.salida, /· CI de main: sin corridas todavía/)
  assert.doesNotMatch(r.salida, /no respondió/)
})

test('estado: sin el manifiesto suelto sugiere reconstruir; --todos no frena, una carpeta pedida sí', () => {
  const w = mundo()
  mkdirSync(join(w.raiz, 'z_otro'))
  const todos = w.correr('estado', '--todos')
  assert.equal(todos.estado, 0)
  assert.match(
    todos.salida,
    /· no hay z_otro\/proyecto\.yaml: rehazlo con `bash _herramientas\/kit\/scripts\/proyecto\/proyecto\.sh reconstruir z_otro`/,
  )
  assert.equal(w.correr('estado', 'z_otro').estado, 1)
  assert.equal(w.correr('estado').estado, 64)
})

// ---------- sincronizar ----------

test('sincronizar: trae lo del repo al suelto y abre un issue donde difiere lo del proyecto; no lo duplica', () => {
  const copiaApp = copia(MANTENIMIENTO, ['bloque: 6', 'bloque: 7'])
  const copiaWeb = copia()
  const w = mundo({
    repos: {
      'cuentaa/demo-app': { contents: copiaApp, issues: [] },
      'cuentab/demo-web': { contents: copiaWeb, issues: [] },
    },
  })
  const r = w.correr('sincronizar', 'z_demo')
  assert.equal(r.estado, 0, r.error)
  assert.match(r.salida, /✓ z_demo: demo-app: etapa "construccion" → "mantenimiento"/)
  assert.match(
    r.salida,
    /✗ demo-app: su copia difiere \(1\); abrí el issue #100 «sincronizar el manifiesto» en su cola/,
  )
  assert.match(r.salida, /✓ demo-web: su copia coincide con el proyecto/)
  const suelto = readFileSync(join(w.raiz, 'z_demo/proyecto.yaml'), 'utf8')
  assert.ok(suelto.includes('etapa: mantenimiento   # lo manda el repo'))
  assert.ok(suelto.includes('bloque: 6'), 'lo del proyecto no se pisa con lo de la copia')
  const issue = leerEstado(w.gh).repos['cuentaa/demo-app'].creados[0]
  assert.deepEqual(issue.labels, [{ name: 'cola' }])
  assert.match(
    issue.body,
    /^```yaml\ntitulo: sincronizar el manifiesto\nrama: chore\/sincronizar-manifiesto\n/,
  )
  assert.match(issue.body, /repos\[web\]/)
  // El orquestador tiene que poder leerlo como una tarea más.
  const tarea = archivoDeIssue({
    number: 100,
    title: issue.title,
    body: issue.body,
    labels: ['cola'],
  })
  assert.match(JSON.stringify(tarea), /chore\/sincronizar-manifiesto/)
  assert.ok(issue.body.includes('Copia del manifiesto del proyecto demo'))
  assert.ok(issue.body.includes('etapa: mantenimiento'), 'el esperado ya trae lo que manda el repo')
  assert.ok(issue.body.includes('bloque: 6'))
  assert.equal(leerEstado(w.gh).repos['cuentab/demo-web'].creados, undefined)
  const otra = w.correr('sincronizar', 'z_demo')
  assert.match(otra.salida, /✓ z_demo: el manifiesto ya tiene lo que mandan los repos/)
  assert.match(otra.salida, /· demo-app: su copia difiere y ya está pedido en #100/)
  assert.equal(leerEstado(w.gh).repos['cuentaa/demo-app'].creados.length, 1)
})

test('sincronizar: sin acceso, sin red o con una copia inválida lo dice y sigue', () => {
  const w = mundo({
    cuentas: ['cuentaa'],
    repos: {
      'cuentaa/demo-app': { contents: 'esquema: otro\n' },
      'cuentab/demo-web': { contents: copia() },
    },
  })
  const r = w.correr('sincronizar', 'z_demo')
  assert.equal(r.estado, 1)
  assert.match(r.salida, /✗ demo-app: su copia no sirve — /)
  assert.match(r.salida, /✗ demo-web: sin acceso a cuentab/)
  const sinCopia = mundo({
    repos: {
      'cuentaa/demo-app': { issues: [] },
      'cuentab/demo-web': { contents: copia(), issues: [] },
    },
  })
  assert.match(
    sinCopia.correr('sincronizar', 'z_demo').salida,
    /· demo-app: todavía no tiene \.proyecto\/proyecto\.yaml en main/,
  )
  const sinRed = mundo({
    repos: { 'cuentaa/demo-app': { sinRed: true }, 'cuentab/demo-web': { sinRed: true } },
  })
  const s = sinRed.correr('sincronizar', '--todos')
  assert.equal(s.estado, 0)
  assert.match(s.salida, /· demo-app: GitHub no respondió/)
})

test('sincronizar: copia la retro del PR de cierre a semilla/retro.md', () => {
  const w = mundo({
    repos: {
      'cuentaa/demo-app': {
        contents: copia(),
        issues: [],
        retro: [
          {
            number: 3,
            title: 'feat: otra cosa',
            body: '## Retro\nno',
            closed_at: '2026-11-01T00:00:00Z',
          },
          {
            number: 31,
            title: 'chore(docs): cerrar la construcción (semilla-v2)',
            body: '## Qué\nx\n\n## Retro\nTexto.\n\n### Tareas trabadas\n\n- ninguna\n',
            closed_at: '2026-11-16T10:00:00Z',
          },
        ],
      },
      'cuentab/demo-web': { contents: copia(), issues: [] },
    },
  })
  const r = w.correr('sincronizar', 'z_demo')
  assert.match(r.salida, /✓ demo-app: la retro del PR #31 está en semilla\/retro\.md/)
  const retro = readFileSync(join(w.raiz, 'z_demo/semilla/retro.md'), 'utf8')
  assert.match(
    retro,
    /<!-- retro: demo-app -->\n## demo-app · PR #31 \(2026-11-16\)\n\nTexto\.\n\n### Tareas trabadas/,
  )
  assert.doesNotMatch(retro, /no\n/)
  assert.doesNotMatch(
    w.correr('sincronizar', 'z_demo').salida,
    /la retro del PR/,
    'sin cambios no la reescribe',
  )
})

// ---------- reconstruir ----------

test('reconstruir: rehace el suelto desde las copias de los repos y no pisa uno que existe sin --forzar', () => {
  const w = mundo()
  const dir = join(w.raiz, 'z_demo')
  mkdirSync(join(dir, 'app/.proyecto'), { recursive: true })
  mkdirSync(join(dir, 'web/.proyecto'), { recursive: true })
  mkdirSync(join(dir, '.web.creando-1/.proyecto'), { recursive: true })
  writeFileSync(
    join(dir, 'app/.proyecto/proyecto.yaml'),
    `# Copia del manifiesto del proyecto p (esquema proyecto/v1).\n${copia(MANTENIMIENTO)}`,
  )
  writeFileSync(
    join(dir, 'web/.proyecto/proyecto.yaml'),
    `# Copia\n${copia(['    nombre: demo-web\n    github: cuentab/demo-web\n    etapa: construccion', '    nombre: demo-web\n    github: cuentab/demo-web\n    etapa: mantenimiento'])}`,
  )
  const antes = readFileSync(join(dir, 'proyecto.yaml'), 'utf8')
  const sin = w.correr('reconstruir', 'z_demo')
  assert.equal(sin.estado, 1)
  assert.match(sin.error, /ya existe: para rehacerlo/)
  assert.equal(readFileSync(join(dir, 'proyecto.yaml'), 'utf8'), antes)
  const r = w.correr('reconstruir', 'z_demo', '--forzar')
  assert.equal(r.estado, 0, r.error)
  const nuevo = readFileSync(join(dir, 'proyecto.yaml'), 'utf8')
  assert.equal(readFileSync(join(dir, 'proyecto.yaml.anterior'), 'utf8'), antes)
  assert.match(nuevo, /^# Manifiesto de Demo \(proyecto\/v1\)\. Suelto, sin versionar/)
  const m = leerManifiesto(nuevo)
  assert.deepEqual(
    m.repos.map((x) => [x.rol, x.etapa]),
    [
      ['app', 'mantenimiento'],
      ['web', 'mantenimiento'],
    ],
  )
  assert.equal(m.contratos[0].id, 'agenda')
})

test('reconstruir: sin ninguna copia local falla diciendo qué hacer; la carpeta tiene que existir', () => {
  const w = mundo()
  rmProyecto(w)
  const r = w.correr('reconstruir', 'z_demo')
  assert.equal(r.estado, 1)
  assert.match(r.error, /no hay ninguna copia en z_demo\/<rol>\/\.proyecto\/proyecto\.yaml/)
  assert.equal(w.correr('reconstruir', 'z_nada').estado, 64)
})

function rmProyecto(w) {
  spawnSync('rm', ['-f', join(w.raiz, 'z_demo/proyecto.yaml')])
}

// ---------- resumen ----------

/** Un ntfy falso: guarda cada POST. */
async function conNtfy(prueba) {
  const recibidos = []
  const servidor = createServer((req, res) => {
    let cuerpo = ''
    req.on('data', (d) => (cuerpo += d))
    req.on('end', () => {
      recibidos.push({
        url: req.url,
        titulo: req.headers.title,
        prioridad: req.headers.priority,
        tags: req.headers.tags,
        cuerpo,
      })
      res.end('ok')
    })
  })
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok))
  try {
    await prueba(`http://127.0.0.1:${servidor.address().port}`, recibidos)
  } finally {
    servidor.close()
  }
}

const correrAsync = (w, ...args) =>
  new Promise((ok) => {
    const p = spawn('bash', [GUION, ...args], { env: w.env })
    let salida = ''
    let error = ''
    p.stdout.on('data', (d) => (salida += d))
    p.stderr.on('data', (d) => (error += d))
    p.on('close', (estado) => ok({ estado, salida, error }))
  })

function ntfyEnv(w, servidor, extra = '') {
  mkdirSync(join(w.env.HOME, '.config/orquestador'), { recursive: true })
  writeFileSync(
    join(w.env.HOME, '.config/orquestador/maquina.env'),
    `TURNOS_MAQUINA=3\nNTFY_TEMA=mi-tema # el mío\nNTFY_SERVIDOR=${servidor}\n${extra}`,
  )
}

test('resumen: un aviso por proyecto al tema de maquina.env, con lo rojo; en verde, lo dice', async () => {
  await conNtfy(async (servidor, recibidos) => {
    const w = mundo({ repos: structuredClone(ROJO) })
    mkdirSync(join(w.raiz, 'z_qq'))
    writeFileSync(
      join(w.raiz, 'z_qq/proyecto.yaml'),
      SUELTO.replaceAll('proyecto: demo', 'proyecto: qq')
        .replace('nombre: P', 'nombre: Quéso')
        .replaceAll('demo-app', 'qq-app')
        .replaceAll('demo-web', 'qq-web'),
    )
    w.env.PROYECTO_AHORA = '2026-11-17T12:00:00Z'
    ntfyEnv(w, servidor)
    // z_q: sus repos no existen en el gh falso → «GitHub no respondió»: tampoco es verde.
    const r = await correrAsync(w, 'resumen', '--todos')
    assert.equal(r.estado, 0, r.error)
    assert.equal(recibidos.length, 2)
    const p = recibidos.find((x) => x.titulo === '[demo] Resumen diario')
    assert.equal(p.url, '/mi-tema')
    assert.equal(p.prioridad, 'high')
    assert.equal(p.tags, 'warning')
    assert.match(p.cuerpo, /✗ demo-app: PR #12 abierto desde 2026-11-05/)
    assert.match(p.cuerpo, /✗ demo-app: #7 trabada: T7 agenda/)
    assert.doesNotMatch(p.cuerpo, /demo-web/)
    const q = recibidos.find((x) => x.titulo === '[qq] Resumen diario')
    assert.match(q.cuerpo, /· qq-app: GitHub no respondió/)
  })
})

test('resumen: todo en verde, y sin NTFY_TEMA no manda nada y sale con 1', async () => {
  await conNtfy(async (servidor, recibidos) => {
    const w = mundo({
      repos: {
        'cuentaa/demo-app': { runs: { push: run('abcdef012345', 'success') }, issues: [] },
        'cuentab/demo-web': { runs: { push: run('abcdef012345', 'success') }, issues: [] },
      },
    })
    const sinTema = await correrAsync(w, 'resumen', '--todos')
    assert.equal(sinTema.estado, 1)
    assert.match(sinTema.error, /falta NTFY_TEMA en ~\/\.config\/orquestador\/maquina\.env/)
    assert.match(sinTema.salida, /Todo en verde en 2 repos\./)
    ntfyEnv(w, servidor)
    const r = await correrAsync(w, 'resumen', '--todos')
    assert.equal(r.estado, 0, r.error)
    assert.deepEqual(
      recibidos.map((x) => [x.titulo, x.prioridad, x.tags, x.cuerpo]),
      [['[demo] Resumen diario', 'low', 'white_check_mark', 'Todo en verde en 2 repos.']],
    )
  })
})

test('resumen: el nombre del proyecto con tildes viaja en el título sin romper la cabecera', async () => {
  await conNtfy(async (servidor, recibidos) => {
    const w = mundo({
      repos: {
        'cuentaa/demo-app': { runs: { push: run('abcdef012345', 'success') }, issues: [] },
        'cuentab/demo-web': { runs: { push: run('abcdef012345', 'success') }, issues: [] },
      },
    })
    ntfyEnv(w, servidor)
    mkdirSync(join(w.raiz, 'z_ñ'))
    writeFileSync(join(w.raiz, 'z_ñ/proyecto.yaml'), 'esquema: otro\n')
    const r = await correrAsync(w, 'resumen', '--todos')
    assert.equal(r.estado, 0, r.error)
    assert.equal(recibidos.length, 2)
  })
})

// ---------- instalar-resumen ----------

test('instalar-resumen: escribe servicio y timer en systemd de usuario y los activa', () => {
  const w = mundo()
  mkdirSync(join(w.dir, 'bin'))
  writeFileSync(
    join(w.dir, 'bin/systemctl'),
    `#!/bin/sh\necho "$@" >> ${JSON.stringify(join(w.dir, 'systemctl.log'))}\n`,
  )
  chmodSync(join(w.dir, 'bin/systemctl'), 0o755)
  w.env.PATH = `${join(w.dir, 'bin')}:${w.env.PATH}`
  const r = w.correr('instalar-resumen')
  assert.equal(r.estado, 0, r.error)
  const unidades = join(w.env.HOME, '.config/systemd/user')
  const timer = readFileSync(join(unidades, 'proyectos-resumen.timer'), 'utf8')
  const servicio = readFileSync(join(unidades, 'proyectos-resumen.service'), 'utf8')
  assert.match(timer, /OnCalendar=\*-\*-\* 08:00:00 America\/La_Paz/)
  assert.match(servicio, /proyecto\.sh sincronizar --todos/)
  assert.match(servicio, /proyecto\.sh resumen --todos/)
  assert.ok(servicio.includes(`WorkingDirectory=${w.raiz}`))
  assert.equal(
    readFileSync(join(w.dir, 'systemctl.log'), 'utf8'),
    '--user daemon-reload\n--user enable --now proyectos-resumen.timer\n',
  )
  assert.ok(existsSync(join(unidades, 'proyectos-resumen.service')))
})

test('un uso mal escrito sale con 64 y dice el uso', () => {
  const w = mundo()
  const r = w.correr('adivinar')
  assert.equal(r.estado, 64)
  assert.match(r.error, /uso: bash _herramientas\/kit\/scripts\/proyecto\/proyecto\.sh/)
})
