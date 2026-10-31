import assert from 'node:assert/strict'
import { test } from 'node:test'
import { leerCambios, pasoDeLaRama, problemasDelPr } from './carriles.mjs'

const plan = {
  carriles: [
    { id: 'datos', dueno_de: ['supabase/', 'src/modules/turnos/infra/'] },
    { id: 'ui', dueno_de: ['src/app/'] },
  ],
  pasos: [
    { id: 'P01', carril: 'datos', modulos: ['supabase/migrations/'] },
    { id: 'P02', carril: 'ui', modulos: ['src/app/turnos/', 'src/modules/turnos/features/lista/'] },
  ],
}
const pr = (rama, cambios, ultimaDeLaBase = '20261001000000') =>
  problemasDelPr({ plan, rama, cambios, ultimaDeLaBase })

test('la rama dice el paso, sin importar mayúsculas', () => {
  assert.equal(pasoDeLaRama(plan, 'ui/p02').paso.id, 'P02')
  assert.equal(pasoDeLaRama(plan, 'ui/P01'), null) // P01 no es de ui
  assert.equal(pasoDeLaRama(plan, 'main'), null)
})

test('un paso toca lo de su carril, sus módulos y sus notas', () => {
  assert.deepEqual(
    pr('ui/p02', [
      { estado: 'M', ruta: 'src/app/turnos/page.tsx' },
      { estado: 'A', ruta: 'src/modules/turnos/features/lista/lista.tsx' },
      { estado: 'A', ruta: 'docs/pasos/P02/bitacora.md' },
    ]),
    [],
  )
})

test('fuera de lo suyo: ESTADO, otro carril, otro paso', () => {
  const p = pr('ui/p02', [
    { estado: 'M', ruta: 'docs/ESTADO.md' },
    { estado: 'M', ruta: 'src/modules/turnos/infra/repo.ts' },
    { estado: 'A', ruta: 'docs/pasos/P01/notas.md' },
  ])
  assert.equal(p.length, 3)
  assert.match(p[0], /docs\/ESTADO.md: el paso P02 \(carril ui\) no toca esto/)
})

test('un renombre cuenta las dos rutas', () => {
  assert.equal(
    pr('ui/p02', [{ estado: 'R100', antes: 'src/modules/turnos/infra/a.ts', ruta: 'src/app/a.ts' }])
      .length,
    1,
  )
})

test('migraciones: nueva y posterior sí; editar, borrar o intercalar no (en cualquier rama)', () => {
  assert.deepEqual(
    pr('datos/p01', [{ estado: 'A', ruta: 'supabase/migrations/20261002000000_turnos.sql' }]),
    [],
  )
  const p = pr('main', [
    { estado: 'M', ruta: 'supabase/migrations/20260901000000_base.sql' },
    { estado: 'A', ruta: 'supabase/migrations/20260915000000_tarde.sql' },
  ])
  assert.equal(p.length, 2)
  assert.match(p[0], /no se edita ni se borra/)
  assert.match(p[1], /no es posterior/)
})

test('leerCambios', () => {
  assert.deepEqual(leerCambios('M\ta.ts\nR090\tb.ts\tc.ts\n'), [
    { estado: 'M', ruta: 'a.ts' },
    { estado: 'R090', ruta: 'c.ts', antes: 'b.ts' },
  ])
})
