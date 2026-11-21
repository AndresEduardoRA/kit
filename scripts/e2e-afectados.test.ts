import { describe, expect, it } from 'vitest'

import { COMUN_AL_NOMBRAR, e2eAfectados } from './e2e-afectados/eleccion.mjs'

// Los e2e que un cambio puede romper fuera de su módulo, para correrlos en local antes de publicar. Los dos casos de los que sale, que
// cayeron en el CI y no en local: un botón «Recargar la página» nuevo en el marco chocó con un `getByRole('button', { name: 'Recargar' })`
// de otra pantalla (strict mode), y un cambio en la ficha de un módulo, que además tocaba `src/shared/lib`, rompió un spec de esa
// ficha con otro nombre.

type Archivos = Record<string, string>
type Cambios = Record<string, { agregadas: string[]; quitadas: string[] }>

function elegir(opciones: {
  archivos: string[]
  cambios?: Cambios
  specs: Archivos
  soportes?: Archivos
  fuentes?: Archivos
  tope?: number
}) {
  const todo: Archivos = { ...opciones.specs, ...opciones.soportes, ...opciones.fuentes }
  return e2eAfectados({
    archivos: opciones.archivos,
    cambios: opciones.cambios ?? {},
    specs: Object.keys(opciones.specs),
    soportes: Object.keys(opciones.soportes ?? {}),
    fuentes: Object.keys(opciones.fuentes ?? {}),
    leer: (a: string) => todo[a] ?? null,
    ...(opciones.tope === undefined ? {} : { tope: opciones.tope }),
  })
}

const MARCO = {
  'src/app/(app)/layout.tsx':
    "import { Marco } from './_shell/marco'\nexport default function L() { return <Marco /> }",
  'src/app/(app)/_shell/marco.tsx':
    "import { RecargarLaPagina } from '@/shared/ui/recargar-la-pagina'\nexport function Marco() {}",
  'src/shared/ui/recargar-la-pagina.tsx': 'export function RecargarLaPagina() {}',
  'src/app/(app)/configuracion/categorias/page.tsx': 'export default function P() {}',
}

describe('e2e-afectados › el «Recargar» nuevo del marco', () => {
  const resultado = elegir({
    archivos: ['src/shared/ui/recargar-la-pagina.tsx', 'src/app/(app)/_shell/marco.tsx'],
    cambios: {
      'src/shared/ui/recargar-la-pagina.tsx': {
        agregadas: [
          '    <Button',
          '      variant="ghost"',
          '      aria-label="Recargar la página"',
          '      onClick={() => location.reload()}',
        ],
        quitadas: [],
      },
      'src/app/(app)/_shell/marco.tsx': {
        agregadas: [
          "import { RecargarLaPagina } from '@/shared/ui/recargar-la-pagina'",
          '          <RecargarLaPagina />',
        ],
        quitadas: [],
      },
    },
    specs: {
      'e2e/categorias.spec.ts': [
        "await page.goto('/configuracion/categorias')",
        "await expect(page.getByRole('button', { name: 'Recargar' })).toBeVisible()",
      ].join('\n'),
      'e2e/empresa.spec.ts':
        "await modal.getByRole('button', { name: 'Recargar', exact: true }).click()",
      'e2e/presupuesto-js.spec.ts': "import { PRESUPUESTO } from './soporte/presupuestos'",
      'e2e/agenda.spec.ts': "await page.goto('/agenda')",
    },
    soportes: { 'e2e/soporte/presupuestos.ts': 'export const PRESUPUESTO = {}' },
    fuentes: MARCO,
  })

  it('trae categorias.spec.ts: su localizador no exacto también encuentra el botón nuevo', () => {
    expect(resultado.specs).toContain('e2e/categorias.spec.ts')
    expect(resultado.textos).toContainEqual({
      texto: 'Recargar la página ⊇ Recargar',
      como: 'inicio',
      specs: ['e2e/categorias.spec.ts'],
    })
  })

  it('el localizador exacto no se confunde; el marco trae los de presupuestos, no cualquier pantalla', () => {
    expect(resultado.specs).not.toContain('e2e/empresa.spec.ts')
    expect(resultado.specs).toContain('e2e/presupuesto-js.spec.ts')
    expect(resultado.specs).not.toContain('e2e/agenda.spec.ts')
    expect(resultado.pantallas).toContainEqual(
      expect.objectContaining({
        archivo: 'src/shared/ui/recargar-la-pagina.tsx',
        todaPantalla: true,
      }),
    )
  })

  it('dice que el CI correrá el completo y que toca interfaz', () => {
    expect(resultado.ci.modo).toBe('completo')
    expect(resultado.interfaz).toBe(true)
  })
})

describe('e2e-afectados › el cambio en la ficha del cliente', () => {
  const DESPLAZAMIENTO = 'e2e/clientes-ficha-desplazamiento-interno.spec.ts'
  // Muchos specs de clientes y de otro módulo: el tope deja los más ligados.
  const relleno = Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => [
      `e2e/clientes-listado-${String(i)}.spec.ts`,
      "await page.goto('/clientes')",
    ]),
  )
  const specs = {
    ...relleno,
    [DESPLAZAMIENTO]: [
      "import { alaFicha, columnaLateral } from './soporte/ficha-con-desplazamiento-interno'",
      "await page.getByRole('link', { name: datos.cliente.nombre, exact: true }).click()",
    ].join('\n'),
    'e2e/agenda.spec.ts': "await page.goto('/agenda')",
  }
  const fuentes = {
    'src/shared/ui/ficha-en-bloques/use-ir-al-llegar.ts': 'export function useIrAlLlegar() {}',
    'src/app/(app)/clientes/[id]/llegar-al-bloque.tsx':
      "import { useIrAlLlegar } from '@/shared/ui/ficha-en-bloques/use-ir-al-llegar'",
    'src/app/(app)/agenda/page.tsx': 'export default function P() {}',
  }

  it('con src/shared/lib de por medio (el CI va al completo) igual trae el spec, entre los más ligados', () => {
    const resultado = elegir({
      archivos: [
        'src/app/(app)/clientes/[id]/lateral-de-la-ficha.tsx',
        'src/modules/clientes/features/ficha/components/datos-de-contacto.tsx',
        'src/shared/lib/paginacion.ts',
      ],
      cambios: {
        'src/modules/clientes/features/ficha/components/datos-de-contacto.tsx': {
          agregadas: ['      <h3>Datos de contacto</h3>'],
          quitadas: ['      <h3>Contacto</h3>'],
        },
      },
      specs,
      fuentes,
    })
    expect(resultado.ci).toMatchObject({ modo: 'completo', motivo: 'Nivel 2: shared' })
    expect(resultado.specs).toHaveLength(40)
    expect(resultado.specs).toContain(DESPLAZAMIENTO)
    expect(resultado.fuera).toHaveLength(11)
    expect(resultado.specs).not.toContain('e2e/agenda.spec.ts')
  })

  it('un compartido de la ficha: los specs de las pantallas que lo usan', () => {
    const resultado = elegir({
      archivos: ['src/shared/ui/ficha-en-bloques/use-ir-al-llegar.ts'],
      specs: {
        [DESPLAZAMIENTO]: specs[DESPLAZAMIENTO],
        'e2e/agenda.spec.ts': "page.goto('/agenda')",
      },
      fuentes,
    })
    expect(resultado.specs).toEqual([DESPLAZAMIENTO])
    expect(resultado.pantallas).toEqual([
      {
        archivo: 'src/shared/ui/ficha-en-bloques/use-ir-al-llegar.ts',
        rutas: ['clientes'],
        todaPantalla: false,
        specs: 1,
      },
    ])
  })
})

describe('e2e-afectados › estados no felices', () => {
  it('un diff sin src/: sólo los dirigidos', () => {
    const resultado = elegir({
      archivos: ['e2e/soporte/base.ts', 'docs/FLUJO.md'],
      specs: {
        'e2e/empresa.spec.ts': "import { base } from './soporte/base'",
        'e2e/notas.spec.ts': "await page.getByText('Notas')",
      },
      soportes: { 'e2e/soporte/base.ts': 'export const base = 1' },
    })
    expect(resultado.specs).toEqual(['e2e/empresa.spec.ts'])
    expect(resultado.textos).toEqual([])
    expect(resultado.pantallas).toEqual([])
  })

  it(`un texto común (en más de ${String(COMUN_AL_NOMBRAR)} specs) se ignora y se dice`, () => {
    const specs = Object.fromEntries(
      Array.from({ length: COMUN_AL_NOMBRAR + 1 }, (_, i) => [
        `e2e/s${String(i)}.spec.ts`,
        "await page.getByRole('button', { name: 'Guardar', exact: true }).click()",
      ]),
    )
    const resultado = elegir({
      archivos: ['src/modules/agenda/features/x/components/y.tsx'],
      cambios: {
        'src/modules/agenda/features/x/components/y.tsx': {
          agregadas: ['  <Button>Guardar</Button>'],
          quitadas: [],
        },
      },
      specs,
    })
    expect(resultado.ignorados).toEqual([
      { texto: 'Guardar', como: 'nombra', specs: COMUN_AL_NOMBRAR + 1 },
    ])
    expect(resultado.textos).toEqual([])
  })

  it('una línea que sólo cambió su clase no cambia su texto; un texto que se fue, sí', () => {
    const specs = {
      'e2e/agenda.spec.ts': "await page.getByText('Destacados')\nawait page.getByText('Mañana')",
    }
    const archivo = 'src/modules/clientes/features/destacados/components/bloque.tsx'
    const resultado = elegir({
      archivos: [archivo],
      cambios: {
        [archivo]: {
          agregadas: ['<h2 className="text-lg">Destacados</h2>'],
          quitadas: ['<h2 className="text-base">Destacados</h2>', '<p>Mañana</p>'],
        },
      },
      specs,
    })
    expect(resultado.textos).toEqual([
      { texto: 'Mañana', como: 'quitado', specs: ['e2e/agenda.spec.ts'] },
    ])
  })
})

describe('e2e-afectados › ayudantes y tope', () => {
  it('un texto nombrado en un ayudante llega a los specs que lo importan', () => {
    const resultado = elegir({
      archivos: ['src/modules/facturas/features/x/components/y.tsx'],
      cambios: {
        'src/modules/facturas/features/x/components/y.tsx': {
          agregadas: [],
          quitadas: ['  <p>Lista de precios publicada</p>'],
        },
      },
      specs: { 'e2e/precios.spec.ts': "import { publicar } from './soporte/precios-editor'" },
      soportes: {
        'e2e/soporte/precios-editor.ts':
          "await expect(page.getByText('Lista de precios publicada')).toBeVisible()",
      },
    })
    expect(resultado.specs).toEqual(['e2e/precios.spec.ts'])
  })

  it('pasado el tope corren los más ligados y se dice cuáles quedaron fuera', () => {
    const resultado = elegir({
      archivos: ['src/modules/notas/infra/lecturas.ts'],
      specs: {
        'e2e/notas-a.spec.ts': '',
        'e2e/notas-b.spec.ts': '',
        'e2e/notas-lecturas.spec.ts': '',
      },
      tope: 1,
    })
    expect(resultado.specs).toEqual(['e2e/notas-lecturas.spec.ts'])
    expect(resultado.fuera).toEqual(['e2e/notas-a.spec.ts', 'e2e/notas-b.spec.ts'])
  })
})
