import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import { baseDeComparacion, cambiosDelDiff } from './e2e-afectados.mjs'
import { atrapa, localizadoresNoExactos, textosDeLaLinea } from './e2e-afectados/textos.mjs'

// Las piezas de `e2e-afectados.mjs`: los textos visibles de una línea, los localizadores no exactos de un spec, el diff y la base.
describe('e2e-afectados › textos y localizadores', () => {
  it.each([
    ['      aria-label="Recargar la página"', ['Recargar la página']],
    ['<span>Destacados</span>', ['Destacados']],
    ['          Otra persona cambió esta categoría', ['Otra persona cambió esta categoría']],
    ['toast.success(`Categoría «${nombre}» guardada`)', ['Categoría «']],
    ['<div className="flex items-center gap-2">', []],
    ["import { Button } from '@/shared/ui/button'", []],
    ["'use client'", []],
    ['const x = useMemo(() => f(a), [a])', []],
    ["throw new Error('AbortError')", []],
  ])('%s', (linea, textos) => {
    expect(textosDeLaLinea(linea)).toEqual(textos)
  })

  it('los localizadores no exactos: getByRole sin exact, getByText, getByLabel, hasText', () => {
    const locs = localizadoresNoExactos(
      [
        "page.getByRole('button', { name: 'Recargar' })",
        "page.getByRole('button', { name: 'Guardar', exact: true })",
        "page.getByText('Categoría guardada')",
        "page.getByLabel('Nombre', { exact: true })",
        "page.getByLabel('Teléfono')",
        "filas.filter({ hasText: 'Activo' })",
        'page.getByText(`Hola ${x}`)',
      ].join('\n'),
    )
    expect([...locs].sort()).toEqual(['Activo', 'Categoría guardada', 'Recargar', 'Teléfono'])
  })

  it('cuánto atrapa un texto nuevo a un localizador', () => {
    expect(atrapa('Recargar la página', 'Recargar')).toBe('inicio')
    expect(atrapa('Enlace copiado.', 'Copiado')).toBe('palabra')
    expect(atrapa('Selecciónalo y cópialo', 'Selección')).toBe('parte')
    expect(atrapa('Recargar', 'recargar')).toBeNull()
    expect(atrapa('Guardar', 'Recargar')).toBeNull()
  })
})

describe('e2e-afectados › el diff y la base', () => {
  it('lee las líneas de cada archivo; un `--- x` dentro de un hunk es una línea que se fue', () => {
    const diff = [
      'diff --git a/src/a.tsx b/src/a.tsx',
      'index 1..2 100644',
      '--- a/src/a.tsx',
      '+++ b/src/a.tsx',
      '@@ -1 +1 @@',
      '-<p>Viejo</p>',
      '+<p>Nuevo</p>',
      'diff --git a/src/b.sql b/src/b.sql',
      'deleted file mode 100644',
      '--- a/src/b.sql',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '--- un comentario',
    ].join('\n')
    expect(cambiosDelDiff(diff)).toEqual({
      'src/a.tsx': { agregadas: ['<p>Nuevo</p>'], quitadas: ['<p>Viejo</p>'] },
      'src/b.sql': { agregadas: [], quitadas: ['-- un comentario'] },
    })
  })

  it('compara contra la base del merge con origin/main, o con main si no hay origin', () => {
    const git = (...args: string[]) => {
      if (args.includes('origin/main')) throw new Error('sin origin')
      return `base-con-${args.at(-1) ?? ''}\n`
    }
    expect(baseDeComparacion(git)).toBe('base-con-main')
    expect(baseDeComparacion(git, 'abc123')).toBe('abc123')
  })

  it('el CLI sobre el repo real devuelve la elección en JSON', () => {
    const salida = execFileSync('node', ['scripts/e2e-afectados.mjs', '--base', 'HEAD', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    expect(JSON.parse(salida)).toMatchObject({ base: 'HEAD', specs: expect.any(Array) })
  })
})
