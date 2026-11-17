// La cola desde el plan (cola.mjs por publicar-proyecto.mjs cola) con un GitHub falso sobre el ejemplo turnero recién creado: los
// números, las dependencias cruzadas, el cierre, sin duplicar tras un corte, autores sin permiso y --actualizar. Corre el validador
// de verdad: sin python3 con PyYAML se salta diciéndolo (salvo con SEMILLA_EXIGE_PYYAML=1).
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { leerEstado, llamadas } from './prueba/gh-falso.mjs'
import { APP, conRepos, conValidador, issues, montar, resumen, WEB } from './prueba/montar.mjs'

conValidador('publicar-proyecto.mjs cola', () => {
  test('los números de GitHub, las dependencias cruzadas por rama y el cierre de cada repo; volver a correr no crea nada', () => {
    const p = montar(conRepos())
    const r = p.correr('cola')
    assert.equal(r.estado, 0, r.error)
    assert.deepEqual(resumen(p.gh, APP), [
      [1, 'P01', ''],
      [2, 'P02', 'T1'],
      [3, 'P03', 'T1'],
      [4, 'P04', 'T1'],
      [5, 'cierre', 'T1 T2 T3 T4'],
    ])
    assert.deepEqual(resumen(p.gh, WEB), [
      [1, 'P01', 'turnero-app:feat/p02-publicar-el-contrato-agenda-publica-v1'],
      [2, 'P02', 'T1'],
      [3, 'P03', 'T2'],
      [4, 'cierre', 'T1 T2 T3'],
    ])
    for (const i of issues(p.gh, APP)) assert.deepEqual(i.labels, [{ name: 'cola' }])
    assert.match(r.salida, /creados: 9 issues · ya estaban: 0/)
    const otra = p.correr('cola')
    assert.equal(otra.estado, 0, otra.error)
    assert.match(otra.salida, /creados: 0 issues · ya estaban: 9/)
    assert.equal(leerEstado(p.gh).posts, 9)
    // Cada llamada va con el token de la cuenta dueña.
    assert.ok(
      llamadas(p.gh).every(
        (l) => l.args[0] === 'auth' || l.token === 'token-falso-AndresEduardoRA',
      ),
    )
  })

  test('un corte a mitad (falla el tercer POST) y otra vuelta: sin duplicados y con los números en orden', () => {
    const p = montar({ ...conRepos(), fallaEnPost: 3 })
    const r = p.correr('cola')
    assert.equal(r.estado, 1)
    assert.match(
      r.error,
      /P03: no pude crear el issue[\s\S]*Vuelve a correr: no duplica \(busca por `paso:`\)/,
    )
    assert.deepEqual(
      resumen(p.gh, APP).map((x) => x[1]),
      ['P01', 'P02'],
    )
    p.editarEstado((e) => (e.fallaEnPost = 0))
    assert.equal(p.correr('cola').estado, 0)
    assert.deepEqual(
      resumen(p.gh, APP).map((x) => x.slice(0, 2)),
      [
        [1, 'P01'],
        [2, 'P02'],
        [3, 'P03'],
        [4, 'P04'],
        [5, 'cierre'],
      ],
    )
    assert.equal(issues(p.gh, WEB).length, 4)
  })

  test('el límite de la API para con lo hecho y lo dice', () => {
    const p = montar({ ...conRepos(), limite: true })
    const r = p.correr('cola')
    assert.equal(r.estado, 1)
    assert.match(r.error, /límite de la API de GitHub/)
  })

  test('un issue de una cuenta sin permiso con `paso: P03` no cuenta', () => {
    const falso = {
      number: 1,
      title: 'falso',
      body: '```yaml\ntitulo: falso\nrama: feat/falso\npaso: P03\n```\n',
      labels: [{ name: 'cola' }],
      state: 'open',
      author_association: 'NONE',
    }
    const p = montar(conRepos({ [APP]: { issues: [falso], siguiente: 2 } }))
    assert.equal(p.correr('cola').estado, 0)
    const app = issues(p.gh, APP)
    assert.deepEqual(
      app.filter((i) => i.campos.paso === 'P03').map((i) => [i.number, i.author_association]),
      [
        [1, 'NONE'],
        [4, 'OWNER'],
      ],
    )
    assert.equal(app.find((i) => i.campos.paso === 'cierre')?.campos.depende, 'T2 T3 T4 T5')
  })

  test('--actualizar app con un paso nuevo: sólo ese issue, el cierre lo suma y los demás quedan byte a byte', () => {
    const P05 = `  - id: P05
    titulo: probar la agenda con volumen
    depende_de: [P03]
    carril: agenda
    riesgo: verde
    modulos: [src/modules/agenda/]
    decisiones: [A2]
    ruteo: {nivel: normal, effort: high, planificar: no, revisor: no}
    verificacion: {nivel: 1, comando: "pnpm test"}
    terminado: la agenda con 20.000 turnos trae un día en una sola página
`
    let semilla = ''
    const p = montar(conRepos(), (s) => (semilla = s))
    assert.equal(p.correr('cola').estado, 0)
    const antes = issues(p.gh, APP).map((i) => i.body)
    writeFileSync(
      join(semilla, 'repos/app/plan.yaml'),
      readFileSync(join(semilla, 'repos/app/plan.yaml'), 'utf8') + P05,
    )
    const r = p.correr('cola', '--actualizar', 'app')
    assert.equal(r.estado, 0, r.error)
    const app = issues(p.gh, APP)
    assert.deepEqual(
      app.slice(0, 4).map((i) => i.body),
      antes.slice(0, 4),
    )
    assert.deepEqual(app[5]?.campos, {
      titulo: 'probar la agenda con volumen',
      rama: 'test/p05-probar-la-agenda-con-volumen',
      depende: 'T3',
      conflicto: 'agenda',
      planificar: 'no',
      nivel: 'normal',
      effort: 'high',
      paso: 'P05',
    })
    assert.equal(app[4]?.campos.depende, 'T1 T2 T3 T4 T6')
    assert.match(r.salida, /\(cierre\): depende suma T6/)
    assert.equal(issues(p.gh, WEB).length, 4, 'web no se toca')
    // Un cierre que ya arrancó no se toca: se avisa.
    p.editarEstado((e) => e.repos[APP].issues[4].labels.push({ name: 'cola:corriendo' }))
    writeFileSync(
      join(semilla, 'repos/app/plan.yaml'),
      readFileSync(join(semilla, 'repos/app/plan.yaml'), 'utf8') +
        P05.replaceAll('P05', 'P06')
          .replace('depende_de: [P03]', 'depende_de: [P05]')
          .replace('probar la agenda', 'optimizar la agenda'),
    )
    const tarde = p.correr('cola', '--actualizar', 'app')
    assert.equal(tarde.estado, 0, tarde.error)
    assert.match(tarde.salida, /\(cierre\) ya arrancó: su depende no se tocó \(faltan T7\)/)
  })

  test('--actualizar de un repo en mantenimiento se niega', () => {
    const p = montar(conRepos())
    const copia = join(p.z, 'app/.proyecto/proyecto.yaml')
    writeFileSync(
      copia,
      readFileSync(copia, 'utf8').replace('etapa: construccion', 'etapa: mantenimiento'),
    )
    const r = p.correr('cola', '--actualizar', 'app')
    assert.equal(r.estado, 1)
    assert.match(r.error, /turnero-app está en mantenimiento/)
  })

  test('en seco imprime las specs y no crea nada', () => {
    const p = montar(conRepos())
    const r = p.correr('cola', '--en-seco')
    assert.equal(r.estado, 0, r.error)
    assert.match(
      r.salida,
      /^--- turnero-web · P01 · fijar la copia del contrato agenda-publica v1$/m,
    )
    assert.match(r.salida, /se crearían: 9 issues/)
    assert.equal(leerEstado(p.gh).posts, 0)
  })
})
