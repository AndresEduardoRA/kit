// publicar-proyecto.mjs crear, proteger y secretos con un GitHub falso (prueba/gh-falso.mjs) sobre el ejemplo turnero recién creado.
// La cola está en cola.test.mjs. Corre el validador de verdad: sin python3 con PyYAML se salta diciéndolo.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { AJUSTES, CHECK } from './github.mjs'
import { leerEstado, llamadas } from './prueba/gh-falso.mjs'
import { APP, conRepos, conValidador, montar, WEB } from './prueba/montar.mjs'

conValidador('publicar-proyecto.mjs crear, proteger y secretos', () => {
  test('crear: públicos, con los ajustes de calesa-app, origin y las 14 etiquetas; uno que ya existe no se recrea', () => {
    const p = montar({ cuentas: { AndresEduardoRA: { plan: 'free' } } })
    const r = p.correr('crear')
    assert.equal(r.estado, 0, r.error)
    assert.match(r.salida, /✓ AndresEduardoRA\/turnero-app: creado público/)
    const e = leerEstado(p.gh)
    for (const repo of [APP, WEB]) {
      assert.equal(e.repos[repo].private, false)
      assert.deepEqual(e.repos[repo].ajustes, AJUSTES)
      assert.equal(e.repos[repo].labels.length, 14)
    }
    assert.ok(e.repos[APP].labels.some((l) => l.name === 'cola:trabada' && l.color === 'b60205'))
    assert.equal(
      execFileSync('git', ['-C', join(p.z, 'web'), 'remote', 'get-url', 'origin'], {
        encoding: 'utf8',
      }).trim(),
      'https://github.com/AndresEduardoRA/turnero-web.git',
    )
    const n = llamadas(p.gh).length
    const otra = p.correr('crear')
    assert.equal(otra.estado, 0, otra.error)
    assert.match(otra.salida, /turnero-app: ya existía: sólo ajustes y etiquetas/)
    assert.ok(
      !llamadas(p.gh)
        .slice(n)
        .some((l) => l.args[0] === 'repo'),
      'no se recrea',
    )
  })

  test('privado: con GitHub Free se niega; con un plan de pago, se crea privado', () => {
    const libre = montar({ cuentas: { AndresEduardoRA: { plan: 'free' } } })
    const r = libre.correr('crear', '--privado')
    assert.equal(r.estado, 1)
    assert.match(
      r.error,
      /AndresEduardoRA tiene GitHub Free: privado deja sin auto-merge ni protección/,
    )
    const pago = montar({ cuentas: { AndresEduardoRA: { plan: 'pro' } } })
    assert.equal(pago.correr('crear', '--privado').estado, 0)
    assert.equal(leerEstado(pago.gh).repos[APP].private, true)
  })

  test('proteger: verde protege con strict; corriendo sale con 75; rojo se niega salvo --aunque-rojo', () => {
    const verde = { id: 1, name: CHECK, status: 'completed', conclusion: 'success', html_url: 'u' }
    const p = montar(
      conRepos({
        [APP]: { checks: [verde] },
        [WEB]: { checks: [{ ...verde, status: 'in_progress', conclusion: null }] },
      }),
    )
    assert.equal(p.correr('proteger').estado, 75)
    const e = leerEstado(p.gh)
    assert.deepEqual(e.repos[APP].proteccion.required_status_checks, {
      strict: true,
      checks: [{ context: CHECK }],
    })
    assert.equal(e.repos[WEB].proteccion, null)
    p.editarEstado(
      (x) =>
        (x.repos[WEB].checks = [{ ...verde, conclusion: 'failure', html_url: 'https://ci/1' }]),
    )
    const rojo = p.correr('proteger', '--rol', 'web')
    assert.equal(rojo.estado, 1)
    assert.match(
      rojo.error,
      /main de AndresEduardoRA\/turnero-web no queda protegido: cayó «Listo · todo en verde» \(https:\/\/ci\/1\)\. No enciendas su orquestador/,
    )
    assert.equal(p.correr('proteger', '--rol', 'web', '--aunque-rojo').estado, 0)
    assert.notEqual(leerEstado(p.gh).repos[WEB].proteccion, null)
  })

  test('secretos: un token o un archivo de entorno versionados se encuentran; un repo limpio pasa', () => {
    const p = montar()
    const app = join(p.z, 'app')
    const token = ['ghp', '_', 'x'.repeat(36)].join('')
    writeFileSync(join(app, 'notas.md'), `token: ${token}\n`)
    writeFileSync(join(app, '.env.local'), 'X=1\n')
    const git = (...a) =>
      execFileSync('git', ['-C', app, '-c', 'user.name=t', '-c', 'user.email=t@e.test', ...a])
    git('add', '-f', 'notas.md', '.env.local')
    git('commit', '-q', '-m', 'x')
    const r = p.correr('secretos')
    assert.equal(r.estado, 1)
    assert.match(r.salida, /^turnero-app\/notas\.md:1: token de GitHub: no se publica$/m)
    assert.match(
      r.salida,
      /^turnero-app\/\.env\.local: archivo de entorno versionado: no se publica$/m,
    )
    assert.match(r.salida, /^✓ turnero-web: nada versionado con forma de secreto$/m)
    // crear revisa lo mismo antes de tocar GitHub.
    assert.equal(p.correr('crear').estado, 1)
    assert.deepEqual(leerEstado(p.gh).repos, {})
  })
})
