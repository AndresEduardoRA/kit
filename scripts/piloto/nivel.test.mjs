import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nivelDe } from './nivel.mjs'

const sql = {
  'supabase/migrations/1_a.sql': 'create policy x on t using (true);',
  'supabase/migrations/2_b.sql': '-- create policy no\nselect 1;',
}
const leer = (a) => sql[a] ?? null

test('los seis disparadores del Nivel 2', () => {
  for (const [archivo, id] of [
    ['src/shared/lib/x.ts', 'shared'],
    ['packages/ui/a.ts', 'shared'],
    ['src/proxy.ts', 'proxy'],
    ['src/middleware.ts', 'proxy'],
    ['src/app/(acceso)/entrar/page.tsx', 'auth'],
    ['src/modules/equipo/features/auth/a.ts', 'auth'],
    ['supabase/migrations/1_a.sql', 'rls'],
    ['src/app/(app)/layout.tsx', 'layout'],
  ]) {
    const n = nivelDe([archivo], leer)
    assert.equal(n.nivel, 2, archivo)
    assert.ok(
      n.disparadores.some((d) => d.id === id),
      `${archivo} → ${id}`,
    )
  }
})

test('Nivel 1: una pantalla, los tipos generados, una policy en un comentario', () => {
  assert.equal(
    nivelDe(
      [
        'src/app/turnos/page.tsx',
        'src/shared/types/database.types.ts',
        'supabase/migrations/2_b.sql',
      ],
      leer,
    ).nivel,
    1,
  )
})

test('interfaz: tsx y css sí, pruebas y lógica no', () => {
  assert.equal(nivelDe(['src/modules/x/features/a/lista.tsx'], leer).toca_interfaz, true)
  assert.equal(
    nivelDe(['src/modules/x/entities/reglas.ts', 'src/app/x.test.tsx'], leer).toca_interfaz,
    false,
  )
})
