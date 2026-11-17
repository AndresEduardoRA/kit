import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { coincide, esFlujo, leerPatrones, rutaProhibida, specAlKit, tocaFlujo } from './flujo.mjs'
import { KIT_POR_DEFECTO } from './kit-gh.mjs'
import { decidir, mezclar3, quitarRepetidas } from './mezcla.mjs'
import { MARCADORES } from './personalizar.mjs'

// Qué es flujo (flujo.mjs) y qué pasa con cada archivo de flujo al traer el kit (mezcla.mjs): la tabla de `decidir` fila por fila
// (docs/KIT.md › «El flujo entre el kit y los proyectos»). Las corridas enteras de actualizar.mjs, en actualizar.test.ts.

const valores = { nombre: 'tienda-app', slug: 'tienda', bloque: 6, funciones: '' }
const a = (t: string, modo = 0o644) => ({ contenido: Buffer.from(t), modo })
const texto = (d: { contenido?: Buffer }) => d.contenido?.toString('utf8')
const NOMBRE = MARCADORES[0] ?? ''
const LINEAS = 'uno\ndos\ntres\ncuatro\ncinco\nseis\nsiete\n'

describe('flujo.mjs', () => {
  it('coincide: ** cruza carpetas, * no; sin comodines, la ruta exacta', () => {
    expect(coincide('scripts/flujo/estado.sh', 'scripts/flujo/*')).toBe(true)
    expect(coincide('scripts/flujo/x/estado.sh', 'scripts/flujo/*')).toBe(false)
    expect(coincide('scripts/orquestador/prueba/gh-falso.mjs', 'scripts/orquestador/**')).toBe(true)
    expect(coincide('.claude/rules/e2e.md', '.claude/rules/*.md')).toBe(true)
    expect(coincide('.claude/rules/e2e.txt', '.claude/rules/*.md')).toBe(false)
    expect(coincide('lefthook.yml', 'lefthook.yml')).toBe(true)
    expect(coincide('lefthookXyml', 'lefthook.yml')).toBe(false)
    expect(leerPatrones('# comentario\n\n a/b \n#otro\nc/*\n')).toEqual(['a/b', 'c/*'])
  })

  it('rutaProhibida: el producto nunca es flujo, y el flujo.txt del kit no nombra nada del producto', () => {
    for (const r of [
      'src/app/page.tsx',
      'supabase/migrations/x.sql',
      'design/tokens.css',
      'docs/UX.md',
    ])
      expect(rutaProhibida(r)).toBe(true)
    for (const r of [
      'docs/FLUJO.md',
      'docs/LECCIONES.md',
      'docs/KIT.md',
      'scripts/flujo/estado.sh',
    ])
      expect(rutaProhibida(r)).toBe(false)
    expect(esFlujo('src/x.ts', ['**'])).toBe(false)
    const patrones = leerPatrones(readFileSync('scripts/kit/flujo.txt', 'utf8'))
    expect(patrones.length).toBeGreaterThan(10)
    for (const p of patrones) {
      expect(p.startsWith('*'), p).toBe(false)
      expect(rutaProhibida(p.replaceAll('*', 'x')), p).toBe(false)
    }
  })

  it('tocaFlujo: src/ nunca cuenta; LECCIONES sólo por sus líneas (kit)/(semilla), o entera sin patch; un renombre cuenta', () => {
    const patrones = ['scripts/flujo/*', 'docs/LECCIONES.md', 'scripts/viejo.sh']
    expect(tocaFlujo([{ filename: 'src/app/page.tsx' }], patrones)).toBeNull()
    expect(
      tocaFlujo(
        [{ filename: 'docs/LECCIONES.md', patch: '@@ -1 +1,2 @@\n+- Una propia.\n-- Otra (kit)' }],
        patrones,
      ),
    ).toBeNull()
    expect(
      tocaFlujo(
        [
          { filename: 'scripts/flujo/estado.sh', patch: '+x' },
          { filename: 'src/x.ts' },
          {
            filename: 'docs/LECCIONES.md',
            patch: '+- Haz X: porque Y. (kit)\n+- Pide Z: porque W. (semilla) \n+- Mía.',
          },
        ],
        patrones,
      ),
    ).toEqual({
      rutas: ['scripts/flujo/estado.sh'],
      kit: ['- Haz X: porque Y. (kit)'],
      semilla: ['- Pide Z: porque W. (semilla)'],
    })
    expect(tocaFlujo([{ filename: 'docs/LECCIONES.md' }], patrones)?.rutas).toEqual([
      'docs/LECCIONES.md',
    ])
    expect(
      tocaFlujo([{ filename: 'scripts/nuevo.sh', previous_filename: 'scripts/viejo.sh' }], patrones)
        ?.rutas,
    ).toEqual(['scripts/nuevo.sh'])
  })
})

const d = (base: string | null, nuevo: string | null, propio: string | null, extra = {}) =>
  decidir({
    ruta: 'scripts/flujo/x.sh',
    base: base === null ? null : a(base),
    nuevo: nuevo === null ? null : a(nuevo, 0o755),
    propio: propio === null ? null : a(propio),
    valores,
    ...extra,
  })

describe('flujo.mjs › specAlKit', () => {
  it('lista hasta 50 rutas y «y N más», y reemplaza en una sola pasada', () => {
    const rutas = Array.from({ length: 52 }, (_, i) => `scripts/flujo/{{REPO}}${i}.sh`)
    const spec = specAlKit('{{REPO}} #{{PR}} {{REPO_GH}}\n{{RUTAS}}\n{{LECCIONES}}', {
      repoGh: 'Cuenta/tienda-app',
      nombre: 'tienda-app',
      pr: '40',
      toca: { rutas, kit: ['- Haz X. (kit)'], semilla: [] },
    })
    expect(spec.split('\n').slice(0, 2)).toEqual([
      'tienda-app #40 Cuenta/tienda-app',
      '- `scripts/flujo/{{REPO}}0.sh`',
    ])
    expect(spec).toContain(
      '- `scripts/flujo/{{REPO}}49.sh`\n- y 2 más\nPara `docs/LECCIONES.md` del kit:\n\n- Haz X. (kit)',
    )
    expect(spec).not.toContain('{{REPO}}50')
  })
})

describe('mezcla.mjs › decidir', () => {
  it('omitido, --tomar-kit y --dejar mandan sobre lo demás', () => {
    expect(d('b', 'n', 'o', { omitir: ['scripts/flujo/*'] })).toEqual({
      accion: 'nada',
      como: 'omitido',
    })
    expect(d('b', 'n', 'o', { tomarKit: ['scripts/flujo/x.sh'] })).toMatchObject({
      accion: 'escribir',
      como: 'tomado',
      modo: 0o755,
    })
    expect(d('b', null, 'o', { tomarKit: ['scripts/flujo/x.sh'] }).accion).toBe('borrar')
    expect(d('b', 'n', 'o', { dejar: ['scripts/flujo/x.sh'] })).toEqual({
      accion: 'nada',
      como: 'dejado',
    })
  })

  it('el kit no cambió: nada si está; si se borró aquí sin omitirlo, se restaura', () => {
    expect(d('x', 'x', 'propio')).toEqual({ accion: 'nada', como: 'igual' })
    expect(d('x', 'x', null)).toMatchObject({ accion: 'escribir', como: 'restaurado' })
  })

  it('el kit lo borró: nada si tampoco está, se borra si no cambió aquí, choque si cambió', () => {
    expect(d('x', null, null).accion).toBe('nada')
    expect(d('x', null, 'x')).toEqual({ accion: 'borrar', como: 'borrado' })
    expect(d('x', null, 'otro')).toEqual({
      accion: 'choque',
      como: 'choque',
      motivo: 'el kit lo borró y aquí cambió',
    })
  })

  it('el kit lo creó: llega si no está, nada si ya es igual, choque si existe distinto', () => {
    expect(texto(d(null, 'n', null))).toBe('n')
    expect(d(null, 'n', null).como).toBe('nuevo')
    expect(d(null, 'n', 'n').accion).toBe('nada')
    expect(d(null, 'n', 'otro').motivo).toBe('el kit lo creó y aquí ya existe distinto')
  })

  it('los tres existen: sin cambio aquí llega el del kit; los dos cambios lejos se mezclan; cerca, choque', () => {
    expect(d('b', 'n', 'b')).toMatchObject({ accion: 'escribir', como: 'traido' })
    expect(d('b', 'n', 'n').accion).toBe('nada')
    const kit = LINEAS.replace('uno', 'UNO')
    const propio = LINEAS.replace('siete', 'SIETE')
    const m = d(LINEAS, kit, propio)
    expect(m.como).toBe('mezclado')
    expect(texto(m)).toBe(LINEAS.replace('uno', 'UNO').replace('siete', 'SIETE'))
    expect(m.modo).toBe(0o755)
    expect(d(LINEAS, LINEAS.replace('dos', 'DOS'), LINEAS.replace('dos', 'Dos')).motivo).toBe(
      '1 choque al mezclar',
    )
  })
})

describe('mezcla.mjs › decidir: binarios, personalización y lecciones', () => {
  it('binario: sin cambio aquí llega el del kit; si cambió en las dos partes, choque', () => {
    const bin = (s: string) => Buffer.from(`\0${s}`)
    const db = (b: string, n: string, o: string) =>
      decidir({
        ruta: 'scripts/flujo/x.png',
        base: { contenido: bin(b), modo: 0o644 },
        nuevo: { contenido: bin(n), modo: 0o644 },
        propio: { contenido: bin(o), modo: 0o644 },
        valores,
      })
    expect(db('b', 'n', 'b').como).toBe('traido')
    expect(db('b', 'n', 'o').motivo).toBe('es binario y cambió en las dos partes')
  })

  it('personaliza los dos lados del kit: una línea con el nombre no choca y llega con el nombre del repo', () => {
    const ruta = '.claude/agents/revisor.md'
    const base = `Eres el revisor de ${NOMBRE}.\n\nuno\ndos\ntres\ncuatro\n`
    const nuevo = `${base}cinco: ${NOMBRE}\n`
    const propio = base.replace(NOMBRE, 'tienda-app').replace('uno', 'UNO')
    const r = decidir({ ruta, base: a(base), nuevo: a(nuevo), propio: a(propio), valores })
    expect(r.como).toBe('mezclado')
    expect(texto(r)).toBe(
      'Eres el revisor de tienda-app.\n\nUNO\ndos\ntres\ncuatro\ncinco: tienda-app\n',
    )
  })

  it('un marcador que quedaría suelto, o un archivo con puertos sin bloque, es un choque', () => {
    const suelto = d('x', `x ${NOMBRE}`, 'x')
    expect(suelto.motivo).toBe(`quedaría el marcador ${NOMBRE} en scripts/flujo/x.sh`)
    const sinBloque = decidir({
      ruta: '.github/workflows/ci.yml',
      base: a('a'),
      nuevo: a('b'),
      propio: a('a'),
      valores: { ...valores, bloque: null },
    })
    expect(sinBloque.accion).toBe('choque')
    expect(sinBloque.motivo).toMatch(/puertos heredados/)
  })

  it('docs/LECCIONES.md se mezcla por union y pierde la (kit) del proyecto que el kit ya absorbió', () => {
    const base = '# Lecciones\n\n## CI\n\n- Una vieja.\n'
    const propio = `${base}- Haz X: porque Y. (kit)\n- Sólo de aquí.\n`
    const nuevo = `${base}- Haz X: porque Y. (tienda-app, PR #40)\n- Del kit.\n`
    const r = decidir({
      ruta: 'docs/LECCIONES.md',
      base: a(base),
      nuevo: a(nuevo),
      propio: a(propio),
      valores,
    })
    expect(r.como).toBe('mezclado')
    expect(texto(r)).toBe(
      `${base}- Sólo de aquí.\n- Haz X: porque Y. (tienda-app, PR #40)\n- Del kit.\n`,
    )
  })
})

describe('mezcla.mjs › ayudantes', () => {
  it('mezclar3 cuenta los choques y no deja marcas fuera de su salida', () => {
    const m = mezclar3({ propio: 'a\nX\nc\n', base: 'a\nb\nc\n', nuevo: 'a\nY\nc\n' })
    expect(m.choques).toBe(1)
    expect(m.texto).toContain('<<<<<<< propio')
    expect(
      mezclar3({ propio: 'a\nX\nc\n', base: 'a\nb\nc\n', nuevo: 'a\nY\nc\n', union: true }),
    ).toEqual({
      texto: 'a\nX\nY\nc\n',
      choques: 0,
    })
  })

  it('el kit por defecto de kit-gh.mjs es el KIT_GITHUB de config.env del orquestador', () => {
    const config = readFileSync('scripts/orquestador/config.env', 'utf8')
    expect(/^KIT_GITHUB="(.*)"$/m.exec(config)?.[1]).toBe(KIT_POR_DEFECTO)
  })

  it('quitarRepetidas quita sólo la (kit) repetida', () => {
    const md =
      '- A: porque B. (kit)\n- A: porque B. (tienda-app, PR #4)\n- C: porque D. (kit)\n- E. (semilla)\n'
    expect(quitarRepetidas(md)).toBe(
      '- A: porque B. (tienda-app, PR #4)\n- C: porque D. (kit)\n- E. (semilla)\n',
    )
  })
})
