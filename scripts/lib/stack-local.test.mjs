import assert from 'node:assert/strict'
import { test } from 'node:test'
import { baseDelBloque, variablesDelCarril } from './stack-local.mjs'

test('dos proyectos con bloques distintos y todos sus carriles no comparten ningún puerto', () => {
  const usados = new Map()
  for (const [proyecto, bloque] of [
    ['tienda', 5],
    ['agenda', 6],
  ]) {
    const tabla = Object.fromEntries([...Array(9)].map((_, i) => [`c${i + 1}`, 100 * (i + 1)]))
    const conjuntos = [
      baseDelBloque(bloque),
      ...Object.keys(tabla).map((c) => variablesDelCarril(proyecto, c, tabla, bloque)),
    ]
    for (const v of conjuntos)
      for (const [clave, puerto] of Object.entries(v)) {
        if (typeof puerto !== 'number') continue
        assert.ok(
          !usados.has(puerto),
          `${proyecto} ${clave} ${puerto} ya lo usa ${usados.get(puerto)}`,
        )
        assert.ok(puerto < 65536)
        usados.set(puerto, `${proyecto} ${clave}`)
      }
  }
})

test('ningún bloque válido toca los puertos de importadora (546xx–548xx, 3000–3410)', () => {
  for (const b of [1, 2, 3, 5, 6, 7, 8, 9])
    for (let c = 0; c <= 9; c++) {
      const tabla = { x: 100 * c }
      const v = c === 0 ? baseDelBloque(b) : variablesDelCarril('p', 'x', tabla, b)
      for (const puerto of Object.values(v).filter((x) => typeof x === 'number')) {
        assert.ok(puerto < 54620 || puerto > 54830, `bloque ${b} carril ${c}: ${puerto}`)
        assert.ok(puerto < 3000 || puerto > 3410, `bloque ${b} carril ${c}: ${puerto}`)
      }
    }
})

test('el bloque 4, uno fuera de rango y un carril desconocido fallan', () => {
  assert.throws(() => baseDelBloque(4), /choca/)
  assert.throws(() => baseDelBloque(10), /1 a 9/)
  assert.throws(() => variablesDelCarril('p', 'zz', { a: 100 }, 5), /carril desconocido/)
  assert.equal(variablesDelCarril('tienda', 'a', { a: 100 }, 5).SUPABASE_PROJECT_ID, 'tienda-a')
})
