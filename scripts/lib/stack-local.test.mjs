import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  baseDelBloque,
  baseDelRepo,
  baseHeredada,
  conLosDelOrquestador,
  proyectoDelRepo,
  variablesDelCarril,
} from './stack-local.mjs'

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

test('los carriles del orquestador: 100, 200 y 300 sin plan; con plan, los desfases que el plan deja libres', () => {
  assert.deepEqual(conLosDelOrquestador({}), { a: 100, b: 200, c: 300 })
  const conPlan = conLosDelOrquestador({ datos: 100, ui: 200 })
  assert.deepEqual(conPlan, { datos: 100, ui: 200, a: 300, b: 400, c: 500 })
  assert.equal(
    new Set(Object.values(conPlan)).size,
    Object.keys(conPlan).length,
    'ningún desfase repetido',
  )
  // Un carril del plan que se llama como uno del orquestador manda; con el plan lleno no queda lugar para los demás.
  assert.deepEqual(conLosDelOrquestador({ a: 100 }), { a: 100, b: 200, c: 300 })
  const lleno = Object.fromEntries([...Array(8)].map((_, i) => [`c${i + 1}`, 100 * (i + 1)]))
  assert.deepEqual(Object.keys(conLosDelOrquestador(lleno)).slice(8), ['a'])
  assert.equal(variablesDelCarril('turnos', 'b', conPlan, 5).SUPABASE_API_PORT, 55321 + 400)
})

// ---------- los puertos salen del manifiesto del repo (.proyecto/proyecto.yaml) ----------

/** Un repo temporal con su copia del manifiesto: `puertos` es `{ bloque: N }` o `{ heredado: {…} }`; `remoto`, su origin. */
function repoConManifiesto({ slug, rol = 'app', puertos, remoto }) {
  const raiz = mkdtempSync(join(tmpdir(), `${slug}-`))
  execFileSync('git', ['init', '-q', '-b', 'main', raiz])
  if (remoto) execFileSync('git', ['-C', raiz, 'remote', 'add', 'origin', remoto])
  mkdirSync(join(raiz, '.proyecto'))
  writeFileSync(
    join(raiz, '.proyecto/proyecto.yaml'),
    `esquema: proyecto/v1
proyecto: ${slug}
nombre: ${slug}
semilla: null
repos:
  - rol: ${rol}
    nombre: ${slug}-${rol}
    github: Cuenta/${slug}-${rol}
    etapa: construccion
    semilla: null
    puertos: ${JSON.stringify(puertos)}
    provee: []
    consume: []
contratos: []
`,
  )
  return raiz
}

const puertosDe = (raiz, proyecto, tabla, respaldo) => {
  const base = baseDelRepo(raiz, respaldo)
  return [
    base,
    ...Object.keys(tabla).map((carril) => variablesDelCarril(proyecto, carril, tabla, base)),
  ]
}

test('dos proyectos con bloques distintos, leídos de sus manifiestos, no comparten ningún puerto (ni en sus carriles)', () => {
  const tabla = Object.fromEntries([...Array(9)].map((_, i) => [`c${i + 1}`, 100 * (i + 1)]))
  const usados = new Map()
  for (const [slug, bloque] of [
    ['tienda', 5],
    ['agenda', 6],
  ]) {
    const raiz = repoConManifiesto({ slug, puertos: { bloque } })
    assert.deepEqual(
      baseDelRepo(raiz, undefined),
      baseDelBloque(bloque),
      'sale del manifiesto, no del respaldo',
    )
    for (const v of puertosDe(raiz, proyectoDelRepo(raiz), tabla))
      for (const [clave, puerto] of Object.entries(v)) {
        if (typeof puerto !== 'number') continue
        assert.ok(!usados.has(puerto), `${slug} ${clave} ${puerto} ya lo usa ${usados.get(puerto)}`)
        usados.set(puerto, `${slug} ${clave}`)
      }
  }
  assert.ok(usados.size > 100)
})

test('un repo con puertos heredados (546xx) los conserva y no choca con un bloque', () => {
  const raiz = repoConManifiesto({
    slug: 'calesa',
    puertos: { heredado: { api: 54621, base: 54622, app: 3000 } },
  })
  const base = baseDelRepo(raiz, '5') // el respaldo no manda: hay manifiesto
  assert.deepEqual(base, baseHeredada({ api: 54621, base: 54622, app: 3000 }))
  assert.deepEqual(base, {
    SUPABASE_DB_SHADOW_PORT: 54620,
    SUPABASE_API_PORT: 54621,
    SUPABASE_DB_PORT: 54622,
    SUPABASE_STUDIO_PORT: 54623,
    SUPABASE_LOCAL_SMTP_PORT: 54624,
    SUPABASE_ANALYTICS_PORT: 54627,
    SUPABASE_EDGE_RUNTIME_INSPECTOR_PORT: 8083,
    PUERTO_APP: 3000,
    E2E_PORT: 3210,
  })
  // El carril a (+100) de calesa-app: lo que tiene hoy en .env.carril.
  const a = variablesDelCarril('calesa', 'a', { a: 100 }, base)
  assert.equal(a.SUPABASE_API_PORT, 54721)
  assert.equal(a.SUPABASE_DB_PORT, 54722)
  assert.equal(a.PUERTO_APP, 3100)
  assert.equal(a.E2E_PORT, 3310)
  assert.equal(a.SUPABASE_PROJECT_ID, 'calesa-a')
  // Con calesa-web en el bloque 5 (55xxx, 8xxx) y todos sus carriles: ni un puerto repetido.
  const web = repoConManifiesto({ slug: 'calesa', rol: 'web', puertos: { bloque: 5 } })
  const tabla = { a: 100, b: 200, c: 300 }
  const usados = new Map()
  for (const [dueno, donde] of [
    ['app', raiz],
    ['web', web],
  ])
    for (const v of puertosDe(donde, 'calesa', tabla))
      for (const [clave, puerto] of Object.entries(v)) {
        if (typeof puerto !== 'number') continue
        // El inspector de edge de app se queda en 8083 (+carril): sólo choca si otro bloque cae ahí; el 5 usa 55329.
        assert.ok(
          !usados.has(puerto),
          `${dueno} ${clave} ${puerto} ya lo usa ${usados.get(puerto)}`,
        )
        usados.set(puerto, `${dueno} ${clave}`)
      }
})

test('sin manifiesto todo funciona como antes: el bloque de respaldo (PILOTO_BLOQUE) y el proyecto de piloto.config', () => {
  const sin = mkdtempSync(join(tmpdir(), 'sin-manifiesto-'))
  assert.deepEqual(baseDelRepo(sin, '6'), baseDelBloque(6))
  assert.deepEqual(baseDelRepo(sin, 6), baseDelBloque(6))
  assert.equal(proyectoDelRepo(sin, 'viejo'), 'viejo')
  assert.throws(() => baseDelRepo(sin, undefined), /debe ser un entero de 1 a 9/)
  assert.equal(variablesDelCarril('viejo', 'a', { a: 100 }, '6').SUPABASE_API_PORT, 56321 + 100)
})

test('un manifiesto inválido corta con el campo y el comando del validador', () => {
  const raiz = repoConManifiesto({ slug: 'roto', puertos: { bloque: 4 } })
  assert.throws(
    () => baseDelRepo(raiz, 5),
    /puertos\.bloque: 1 a 9, nunca 4[\s\S]*validar_semilla\.py --manifiesto/,
  )
})
