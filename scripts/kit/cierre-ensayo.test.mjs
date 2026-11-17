// El ensayo del cierre de la construcción (scripts/flujo/cierre.mjs) de punta a punta: el ejemplo turnero creado con semilla-a-repo en
// una raíz temporal, y en su repo app el guion de verdad contra el gh falso del orquestador (scripts/orquestador/prueba/gh-falso.mjs),
// con una cola de construcción que tuvo de todo: una trabada con su respuesta, un paso omitido, una tarea fuera del plan y un PR con
// «Decisiones tomadas sin preguntar». Como nuevo-proyecto.test.mjs, sin python3 con PyYAML se salta (salvo SEMILLA_EXIGE_PYYAML=1).
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { leerManifiesto } from '../proyecto/manifiesto.mjs'
import { crear } from './nuevo-proyecto.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const hayPyYaml = spawnSync('python3', ['-c', 'import yaml']).status === 0
const exige = process.env.SEMILLA_EXIGE_PYYAML === '1'
if (!hayPyYaml && !exige)
  console.log('# aviso: sin python3 con PyYAML se salta el ensayo del cierre')
const conValidador = hayPyYaml || exige ? describe : describe.skip

const BOT = '🤖 orquestador:'
/** Un issue de la cola como lo guarda el gh falso. */
const issue = (n, yaml, labels, { cuerpo = '', comentarios = [] } = {}) => ({
  number: n,
  title: `tarea ${n}`,
  body: `\`\`\`yaml\ntitulo: tarea ${n}\nrama: feat/t${n}\n${yaml}\`\`\`\n\n## Decisiones ya tomadas\n\n- Lo de siempre.\n${cuerpo}`,
  labels,
  state: labels.includes('cola:integrada') || labels.includes('cola:omitida') ? 'closed' : 'open',
  comentarios: comentarios.map((body, i) => ({
    id: 100 + n * 10 + i,
    body,
    created_at: '2026-11-10T00:00:00Z',
  })),
})

function cola() {
  return {
    repo: 'AndresEduardoRA/turnero-app',
    siguiente: 7,
    siguienteComentario: 1000,
    etiquetas: [],
    cuentas: [],
    refs: [],
    issues: {
      1: issue(1, 'paso: P01\n', ['cola', 'cola:integrada']),
      2: issue(2, 'paso: P02\n', ['cola', 'cola:integrada'], {
        cuerpo: '- Respuesta de la persona (2026-11-10): el contrato va en v1.\n',
        comentarios: [
          `${BOT} empiezo la tarea en la rama \`feat/t2\`.`,
          `${BOT} me trabé: la semilla no dice qué versión del contrato publica\n\nResponde en un comentario de este issue…`,
        ],
      }),
      3: issue(3, 'paso: P03\n', ['cola', 'cola:omitida']),
      4: issue(4, 'paso: P04\n', ['cola', 'cola:integrada']),
      5: issue(5, '', ['cola', 'cola:integrada']),
      6: issue(6, 'paso: cierre\nal_integrar: etiquetar semilla-v1\n', ['cola', 'cola:corriendo']),
    },
    prs: {
      'AndresEduardoRA/turnero-app': [
        {
          number: 10,
          rama: 'feat/t1',
          estado: 'MERGED',
          titulo: 'feat(agenda): la agenda del día',
          cuerpo:
            '## Qué cambió\n\nLa agenda.\n\n## Decisiones tomadas sin preguntar\n\n- La semana empieza el lunes.\n',
        },
        {
          number: 11,
          rama: 'feat/t4',
          estado: 'MERGED',
          titulo: 'feat(equipo): barberos',
          cuerpo: 'Sin decisiones.',
        },
      ],
    },
  }
}

/** El repo app del ejemplo, con node_modules del kit, un gh falso primero en el PATH y la cola de arriba. */
function montar() {
  const raiz = mkdtempSync(join(tmpdir(), 'cierre-'))
  cpSync(join(KIT, 'scripts/semilla/ejemplo/semilla'), join(raiz, 'z_turnero/semilla'), {
    recursive: true,
  })
  crear('turnero', { raiz })
  const app = join(raiz, 'z_turnero/app')
  symlinkSync(join(KIT, 'node_modules'), join(app, 'node_modules'))
  const falso = join(raiz, 'gh')
  mkdirSync(join(falso, 'bin'), { recursive: true })
  writeFileSync(
    join(falso, 'bin/gh'),
    `#!/usr/bin/env bash\nexec node ${join(KIT, 'scripts/orquestador/prueba/gh-falso.mjs')} "$@"\n`,
    { mode: 0o755 },
  )
  const estado = join(falso, 'estado.json')
  writeFileSync(estado, JSON.stringify(cola()))
  const env = { ...process.env, PATH: `${join(falso, 'bin')}:${process.env.PATH}`, GH_FALSO: falso }
  const cierre = (...args) => {
    const r = spawnSync('node', ['scripts/flujo/cierre.mjs', ...args], {
      cwd: app,
      env,
      encoding: 'utf8',
    })
    return { estado: r.status, salida: r.stdout, error: r.stderr }
  }
  const editarGh = (fn) => {
    const e = JSON.parse(readFileSync(estado, 'utf8'))
    fn(e)
    writeFileSync(estado, JSON.stringify(e))
  }
  const leer = (f) => readFileSync(join(app, f), 'utf8')
  const escribir = (f, t) => writeFileSync(join(app, f), t)
  return { app, cierre, editarGh, leer, escribir }
}

const DOCS = ['ESTADO', 'PENDIENTES', 'DECISIONES', 'LECCIONES', 'FLUJO'].map((d) => `docs/${d}.md`)

conValidador('cierre.mjs sobre el ejemplo turnero', () => {
  test('pasos, aplicar, retro y comprobar dejan el repo en mantenimiento con sus cinco docs y la retro', () => {
    const r = montar()
    assert.equal(r.cierre('pasos', '--etiqueta', 'semilla-v1').estado, 0)
    r.editarGh((e) => (e.issues[4].labels = ['cola', 'cola:trabada']))
    const trabado = r.cierre('pasos', '--etiqueta', 'semilla-v1')
    assert.equal(trabado.estado, 1)
    assert.match(trabado.salida, /^✗ P04 \(#4\): sin integrar \(cola:trabada\)$/m)
    r.editarGh((e) => (e.issues[4].labels = ['cola', 'cola:integrada']))

    const aplicado = r.cierre('aplicar', '--etiqueta', 'semilla-v1')
    assert.equal(aplicado.estado, 0, aplicado.salida + aplicado.error)
    for (const d of DOCS) assert.ok(existsSync(join(r.app, d)), d)
    assert.ok(!existsSync(join(r.app, 'docs/semilla')), 'docs/semilla/ se fue')
    const m = leerManifiesto(r.leer('.proyecto/proyecto.yaml'))
    const app = m.repos.find((x) => x.rol === 'app')
    assert.deepEqual([app?.etapa, app?.semilla], ['mantenimiento', 'semilla-v1'])
    assert.equal(m.repos.find((x) => x.rol === 'web')?.etapa, 'construccion')
    execFileSync('python3', [
      join(KIT, 'scripts/semilla/validar_semilla.py'),
      '--manifiesto',
      join(r.app, '.proyecto/proyecto.yaml'),
    ])
    assert.match(r.leer('docs/DECISIONES.md'), /^- \*\*F1 · Choque de reservas\.\*\* /m)
    assert.match(r.leer('docs/PENDIENTES.md'), /^- \*\*\[F1\]\*\* Riesgo: dos clientes/m)
    assert.match(r.leer('docs/PENDIENTES.md'), /^- \*\*\[#10\]\*\* La semana empieza el lunes\./m)
    assert.match(r.leer('docs/LECCIONES.md'), /^## Para las semillas$/m)

    const retro = r.cierre('retro')
    assert.equal(retro.estado, 0, retro.error)
    assert.match(
      retro.salida,
      /T2 \(P02\) «tarea 2»: la semilla no dice qué versión del contrato publica · respuesta: el contrato va en v1\./,
    )
    assert.match(retro.salida, /^- #10 La semana empieza el lunes\. → «clasificar/m)
    assert.match(retro.salida, /T3 \(P03\) «tarea 3»: se omitió/)
    assert.match(retro.salida, /T5 «tarea 5»: no estaba en el plan/)

    const cuerpo = join(r.app, '..', 'cuerpo.md')
    writeFileSync(cuerpo, `## Qué cambió\n\nEl cierre.\n\n${retro.salida}`)
    const pendiente = r.cierre('comprobar', '--etiqueta', 'semilla-v1', '--cuerpo', cuerpo)
    assert.equal(pendiente.estado, 1)
    assert.match(pendiente.salida, /^✗ queda «completar» en docs\/ESTADO\.md$/m)
    assert.match(pendiente.salida, /^✗ queda «clasificar» en la retro$/m)

    r.escribir(
      'docs/ESTADO.md',
      r.leer('docs/ESTADO.md').replace(/«completar.*$/gm, 'hecho y en verde.'),
    )
    writeFileSync(
      cuerpo,
      readFileSync(cuerpo, 'utf8').replace(/«clasificar[^»]*»/g, 'hueco de la semilla'),
    )
    const listo = r.cierre('comprobar', '--etiqueta', 'semilla-v1', '--cuerpo', cuerpo)
    assert.equal(listo.estado, 0, listo.salida)
    assert.match(listo.salida, /^✓ cierre listo$/m)

    // Una retoma que vuelve a aplicar no toca nada.
    const antes = DOCS.map((d) => r.leer(d)).concat(r.leer('.proyecto/proyecto.yaml'))
    const otra = r.cierre('aplicar', '--etiqueta', 'semilla-v1')
    assert.equal(otra.estado, 0)
    assert.match(otra.salida, /el cierre ya se aplicó/)
    assert.deepEqual(DOCS.map((d) => r.leer(d)).concat(r.leer('.proyecto/proyecto.yaml')), antes)

    r.escribir('docs/ESTADO.md', `${'línea\n'.repeat(61)}`)
    const largo = r.cierre('comprobar', '--etiqueta', 'semilla-v1', '--cuerpo', cuerpo)
    assert.equal(largo.estado, 1)
    assert.match(largo.salida, /^✗ docs\/ESTADO\.md tiene 61 líneas \(máximo 60\)$/m)
  })

  test('sin red sale con 2; una etiqueta mal escrita, con 64', () => {
    const r = montar()
    r.editarGh((e) => (e.sinRed = true))
    const sinRed = r.cierre('pasos', '--etiqueta', 'semilla-v1')
    assert.equal(sinRed.estado, 2)
    assert.match(sinRed.error, /^GitHub no respondió: /)
    assert.equal(r.cierre('aplicar', '--etiqueta', 'v1').estado, 64)
    r.editarGh((e) => {
      e.sinRed = false
      e.refs = [{ ref: 'refs/tags/semilla-v1', sha: 'a'.repeat(40) }]
    })
    assert.match(
      r.cierre('pasos', '--etiqueta', 'semilla-v1').salida,
      /la etiqueta semilla-v1 ya existe/,
    )
  })
})
