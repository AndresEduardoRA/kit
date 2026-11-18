import { describe, expect, it } from 'vitest'
import { tocaFlujo } from './flujo.mjs'
import { quitarRepetidas } from './mezcla.mjs'
import { conOrigen, leccionesNuevas, sumarLeccion } from './traer-lecciones.mjs'

// Una lección `(kit)` o `(semilla)` partida en dos líneas (la viñeta y su continuación sangrada) hace el viaje entero: el aviso del
// orquestador la lista completa (flujo.mjs), traer-de-proyecto.mjs la sube (traer-lecciones.mjs) y, al bajar, la del proyecto se
// quita (mezcla.mjs). Las de una línea, en mezcla.test.ts y traer-de-proyecto.test.ts.

const PARTIDA = '- Haz X:\n  porque Y. (kit)'

describe('lecciones de varias líneas', () => {
  it('tocaFlujo lista la viñeta agregada entera, en una línea', () => {
    const patch = '@@ -1,2 +1,4 @@\n - Vieja.\n+- Haz X:\n+  porque Y. (kit)\n+- Pide Z. (semilla)'
    expect(tocaFlujo([{ filename: 'docs/LECCIONES.md', patch }], ['docs/LECCIONES.md'])).toEqual({
      rutas: [],
      kit: ['- Haz X: porque Y. (kit)'],
      semilla: ['- Pide Z. (semilla)'],
    })
    // Una continuación agregada a una viñeta que ya estaba: sólo esa línea (no hay de dónde sacar el resto).
    expect(
      tocaFlujo(
        [{ filename: 'docs/LECCIONES.md', patch: ' - Vieja:\n+  ahora sí. (kit)' }],
        ['docs/LECCIONES.md'],
      )?.kit,
    ).toEqual(['ahora sí. (kit)'])
  })

  it('leccionesNuevas la da entera y sumarLeccion la suma entera, sin duplicarla aunque esté partida de otra forma', () => {
    const antes = '# L\n\n## CI\n\n- Vieja:\n  sigue. (kit)\n'
    const despues = `${antes}${PARTIDA}\n- Mía\n  sin marca.\n`
    expect(leccionesNuevas(antes, despues)).toEqual([
      { seccion: 'CI', linea: PARTIDA, tipo: 'kit' },
    ])
    const linea = conOrigen(PARTIDA, 'tienda-app', '40')
    expect(linea).toBe('- Haz X:\n  porque Y. (tienda-app, PR #40)')
    const kit = '# Lecciones\n\n## CI\n\n- Una.\n\n## Otra\n\n- Dos.\n'
    const con = sumarLeccion(kit, 'CI', linea)
    expect(con).toBe(
      '# Lecciones\n\n## CI\n\n- Una.\n- Haz X:\n  porque Y. (tienda-app, PR #40)\n\n## Otra\n\n- Dos.\n',
    )
    expect(sumarLeccion(con, 'CI', '- Haz X: porque Y. (otro, PR #1)')).toBe(con)
  })

  it('quitarRepetidas quita la (kit) del proyecto entera, con su continuación, y deja las demás', () => {
    const md = `${PARTIDA}\n- Haz X: porque Y. (tienda-app, PR #4)\n- C:\n  porque D. (kit)\n\n  Un párrafo.\n`
    expect(quitarRepetidas(md)).toBe(
      '- Haz X: porque Y. (tienda-app, PR #4)\n- C:\n  porque D. (kit)\n\n  Un párrafo.\n',
    )
  })
})
