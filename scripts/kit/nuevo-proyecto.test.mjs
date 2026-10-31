// semilla-a-repo, la parte determinista: una semilla de prueba que pasa el validador real de idea-a-semilla, el proyecto que sale, y
// lo que se niega a hacer. El validador está en el repo de semillas, no en el kit: la prueba lo busca en KIT_VALIDADOR o junto al kit
// (<proyectos>/semillas/_herramientas/validar_semilla.py) y se salta, diciéndolo, si no está.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { crear, moverPuertos, problemasDelCss, scopesDelPlan, seccion } from './nuevo-proyecto.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const VALIDADOR = [
  process.env.KIT_VALIDADOR,
  join(KIT, '../semillas/_herramientas/validar_semilla.py'),
  '/home/claude/idea-a-semilla/validar_semilla.py',
].find((r) => r && existsSync(r))
const conValidador = VALIDADOR ? test : test.skip

const tokensKit = readFileSync(join(KIT, 'design/tokens.css'), 'utf8')
const cssKit = tokensKit
  .slice(
    tokensKit.indexOf('*/', tokensKit.indexOf('semilla:inicio')) + 2,
    tokensKit.lastIndexOf('/*', tokensKit.indexOf('semilla:fin')),
  )
  .trim()
const cssSemilla = cssKit.replace(
  /--color-primario:\s*[^;]+;/,
  '--color-primario: oklch(0.6 0.2 30);',
)

const ruteo =
  'ruteo: {agente: claude, modelo: sonnet, effort: high, modo: auto, sesion: nueva, revisor: ninguno}'
const PLAN = `esquema: plan/v1
agentes_disponibles: [claude]
carriles:
  - {id: datos, dueno_de: [supabase/, src/modules/turnos/infra/]}
  - {id: ui, dueno_de: [src/modules/turnos/features/, src/app/turnos/]}
pasos:
  - id: P01
    titulo: Esquema de turnos
    depende_de: []
    carril: datos
    riesgo: rojo
    modulos: [supabase/migrations/]
    decisiones: [A1]
    ruteo: {agente: claude, modelo: opus, effort: xhigh, modo: plan→manual, sesion: nueva, revisor: claude-sesion-nueva}
    verificacion: {nivel: 1, comando: "pnpm db:probar"}
    terminado: db:probar verde
  - id: P02
    titulo: Lista de turnos
    depende_de: [P01]
    carril: ui
    riesgo: ambar
    modulos: [src/modules/turnos/features/lista/, src/app/turnos/]
    decisiones: [F1]
    ${ruteo}
    verificacion: {nivel: 1, comando: "pnpm test"}
    terminado: test verde
`
const SEMILLA = `---
esquema: semilla/v1
nombre: Turnos del consultorio
slug: turnos
version: 2
tamano: chico
tipo: interno
plataforma: PWA
arquitectura: features
stack: {next: "16.4.3"}
servicios: [supabase, vercel]
compuertas_rojas: [datos]
agentes: [claude]
tope_cuota: {ventana_5h_pct: 30, semanal_pct: 20}
piloto_auto_min: 7
generada_con: {modelo: Opus 5.5, effort: high, confirmado_por: dueño}
---

## 1. Visión y alcance

Agenda de turnos para un consultorio chico, con recepción y dueño (A1, F1).

## 6. Experiencia

- /turnos: lista con sus estados vacío, carga, error, sin permiso y sin conexión.

## 7. Escala y rendimiento

- La lista lleva cursor y página de 25.

## 8. Sistema de diseño

\`\`\`css
${cssSemilla}
\`\`\`

## 11. Glosario

- **Turno:** una hora reservada.
`
const REGISTRO = `| ID | tema | decisión | estado | fuente |
|---|---|---|---|---|
| A1 | usuarios | recepción y dueño | cerrada | dueño |
| F1 | stack | Next | recomendado aceptado | dueño |
`

function semilla(cambio = (x) => x) {
  const raiz = mkdtempSync(join(tmpdir(), 'semillas-'))
  const dir = join(raiz, 'turnos')
  mkdirSync(dir)
  const f = cambio({
    'semilla.md': SEMILLA,
    'plan.yaml': PLAN,
    'registro.md': REGISTRO,
    'CHANGELOG.md': '# v2\n',
  })
  for (const [n, t] of Object.entries(f)) writeFileSync(join(dir, n), t)
  return { dir, destino: join(raiz, 'proyectos', 'turnos'), lista: join(raiz, 'proyectos.txt') }
}

test('los puertos del bloque 5 pasan al del proyecto, y nada más', () => {
  assert.equal(
    moverPuertos('port = 55321\nshadow = 55320\nhttp://localhost:8000 e2e 8210 id 4000-8000-x', 6),
    'port = 56321\nshadow = 56320\nhttp://localhost:9000 e2e 9210 id 4000-9000-x'.replace(
      '4000-9000',
      '4000-9000',
    ),
  )
})

test('los scopes salen de los carriles y los módulos del plan', () => {
  const plan = {
    carriles: [
      { id: 'datos', dueno_de: ['supabase/', 'src/modules/turnos/infra/'] },
      { id: 'ui', dueno_de: [] },
    ],
    pasos: [{ modulos: ['src/modules/pagos/features/x/'] }],
  }
  assert.deepEqual(scopesDelPlan(plan), ['datos', 'ui', 'pagos', 'turnos'])
})

test('el contrato de tokens: nombres del kit y tema oscuro', () => {
  assert.deepEqual(problemasDelCss(cssSemilla, cssKit), [])
  const p = problemasDelCss(':root { --color-primario: red; --fondo: x; }', cssKit)
  assert.match(p[0], /le faltan tokens del contrato del kit: .*--color-paper/)
  assert.match(p.join('\n'), /no trae el tema oscuro/)
})

test('seccion', () => {
  assert.equal(seccion('## 1. A\nx\n## 2. B\ny', 'A'), 'x')
  assert.equal(seccion('## 1. A\nx', 'Z'), null)
})

conValidador(
  'un proyecto de punta a punta: reemplazos, docs derivados, commit y sin marcadores',
  () => {
    const s = semilla()
    writeFileSync(s.lista, '') // ningún otro proyecto: el bloque es el 5
    const r = crear(s.dir, s.destino, { validador: VALIDADOR, listaProyectos: s.lista })
    assert.equal(r.bloque, 5)
    const leer = (f) => readFileSync(join(s.destino, f), 'utf8')
    assert.match(leer('piloto.config'), /^PROYECTO=turnos$/m)
    assert.match(leer('piloto.config'), /^PILOTO_AUTO_MIN=7$/m)
    assert.match(leer('piloto.config'), /^COORD_TOPE_PCT=30$/m)
    assert.match(leer('piloto.config'), /^CARRILES_MAX=2$/m)
    assert.match(leer('supabase/config.toml'), /^project_id = "turnos"$/m)
    assert.match(
      leer('.github/workflows/ci.yml'),
      /SUPABASE_API_LOCAL: http:\/\/127\.0\.0\.1:55321/,
    )
    assert.match(leer('AGENTS.md'), /^# Turnos del consultorio$/m)
    assert.match(leer('AGENTS.md'), /Scopes: datos, ui, turnos\./)
    assert.match(leer('commitlint.config.mjs'), /'datos',\n\s+'ui',\n\s+'turnos',/)
    assert.match(leer('src/shared/config/app.ts'), /COLOR_TEMA = 'oklch\(0\.6 0\.2 30\)'/)
    assert.match(leer('design/tokens.css'), /--color-primario: oklch\(0\.6 0\.2 30\);/)
    assert.match(leer('docs/UX.md'), /versión 2[\s\S]*\/turnos: lista/)
    assert.match(leer('docs/GLOSARIO.md'), /\*\*Turno:\*\*/)
    assert.ok(existsSync(join(s.destino, 'docs/semilla/plan.yaml')))
    assert.ok(!existsSync(join(s.destino, 'scripts/kit')), 'el generador no viaja')
    assert.ok(!existsSync(join(s.destino, 'node_modules')))
    assert.equal(
      execFileSync('git', ['-C', s.destino, 'log', '--format=%s'], { encoding: 'utf8' }).trim(),
      'chore(kit): arrancar turnos desde el kit (semilla v2)',
    )
    assert.equal(JSON.parse(leer('package.json')).name, 'turnos')
  },
)

conValidador('el bloque salta los que ya usan otros proyectos', () => {
  const s = semilla()
  const otro = join(dirname(s.lista), 'otro')
  mkdirSync(otro)
  writeFileSync(join(otro, 'piloto.config'), 'PILOTO_BLOQUE=5\n')
  writeFileSync(s.lista, `${otro}\n`)
  assert.equal(
    crear(s.dir, s.destino, { validador: VALIDADOR, listaProyectos: s.lista, enSeco: true }).bloque,
    6,
  )
})

conValidador(
  'se niega: semilla que no valida, plan con choque, tokens fuera de contrato, destino ocupado',
  () => {
    const opciones = { validador: VALIDADOR, enSeco: true, listaProyectos: '/dev/null' }
    const s1 = semilla((f) => ({
      ...f,
      'semilla.md': f['semilla.md'].replace('(A1, F1)', '(A1, F1) etc.'),
    }))
    assert.throws(() => crear(s1.dir, s1.destino, opciones), /no pasa el validador[\s\S]*etc\./)
    const s2 = semilla((f) => ({
      ...f,
      'semilla.md': f['semilla.md'].replace(/--color-paper:/g, '--color-fondo:'),
    }))
    assert.throws(() => crear(s2.dir, s2.destino, opciones), /contrato del kit[\s\S]*--color-paper/)
    const s3 = semilla()
    mkdirSync(s3.destino, { recursive: true })
    writeFileSync(join(s3.destino, 'algo'), 'x')
    assert.throws(() => crear(s3.dir, s3.destino, opciones), /ya existe y no está vacía/)
  },
)

if (!VALIDADOR)
  console.log(
    '# aviso: sin validar_semilla.py (KIT_VALIDADOR): se saltan las pruebas de punta a punta',
  )
