// @vitest-environment node
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import type { Contrato } from './esquemas'
import { AGENDA_1 } from './fixtures/agenda'
import { nombreDelTipo, tiposDeTs } from './tipos'

// `pnpm contrato:tipos`: el archivo TS de la copia fijada, con la forma de `Database` de Supabase. Se fija el texto, se comprueba que
// es TS válido y que tipa de verdad un cliente de supabase-js como `Database & ContratoAgenda` (parámetros y vistas incluidos).
const ESPERADO = `// Generado por \`pnpm contrato:tipos\` desde .proyecto/contratos/agenda@1.json. No se edita.
// Tipa el cliente con \`Database & ContratoAgenda\` (.claude/rules/contratos.md).

export type ContratoAgenda = {
  agenda_publica: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      turnos: {
        Row: {
          estado: ContratoAgenda["agenda_publica"]["Enums"]["estado"] | null
          id: string | null
          inicio: string | null
          nota: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      franja_de: {
        Args: {
          p_turno: string
        }
        Returns: ContratoAgenda["agenda_publica"]["CompositeTypes"]["franja"]
      }
      reservar: {
        Args: {
          p_nota?: string
          p_turno: string
        }
        Returns: string
      }
      turnos_del_dia: {
        Args: {
          p_dia: string
        }
        Returns: {
          id: string
          inicio: string
        }[]
      }
    }
    Enums: {
      estado: "libre" | "tomado"
    }
    CompositeTypes: {
      franja: {
        estado: ContratoAgenda["agenda_publica"]["Enums"]["estado"] | null
        inicio: string | null
      }
    }
  }
}
`

const ORIGEN = '.proyecto/contratos/agenda@1.json'

describe('tiposDeTs › el texto', () => {
  it('da el archivo fijado, y es TS sin errores de sintaxis', () => {
    const texto = tiposDeTs(AGENDA_1, ORIGEN)
    expect(texto).toBe(ESPERADO)
    const r = ts.transpileModule(texto, { reportDiagnostics: true })
    expect(r.diagnostics).toEqual([])
  })

  it('declara Json sólo si lo usa (el typecheck del proyecto corre con noUnusedLocals)', () => {
    const conJson: Contrato = {
      ...AGENDA_1,
      vistas: [],
      rpc: [],
      tipos: [{ nombre: 'f', clase: 'compuesto', campos: [{ nombre: 'datos', tipo: 'jsonb' }] }],
    }
    expect(tiposDeTs(conJson, ORIGEN)).toContain('type Json = string | number')
    expect(tiposDeTs(conJson, ORIGEN)).toContain('datos: Json | null')
  })

  it('el nombre del tipo sale del id; sin parámetros, Args es never; arreglos, dominios y lo desconocido', () => {
    expect(nombreDelTipo('agenda-publica')).toBe('ContratoAgendaPublica')
    const c: Contrato = {
      ...AGENDA_1,
      vistas: [],
      rpc: [
        {
          nombre: 'estados',
          parametros: [],
          retorno: { conjunto: false, tipo: 'agenda_publica.estado[]' },
          permisos: { anon: [], authenticated: ['execute'], service_role: [] },
        },
        {
          nombre: 'raro',
          parametros: [{ nombre: 'p_d', tipo: 'agenda_publica.positivo', conDefault: false }],
          retorno: { conjunto: true, tipo: 'interval' },
          permisos: { anon: [], authenticated: ['execute'], service_role: [] },
        },
      ],
      tipos: [...AGENDA_1.tipos, { nombre: 'positivo', clase: 'dominio', base: 'integer' }],
    }
    const texto = tiposDeTs(c, ORIGEN)
    expect(texto).not.toContain('type Json')
    expect(texto).toContain(
      'Args: never\n        Returns: (ContratoAgenda["agenda_publica"]["Enums"]["estado"])[]',
    )
    expect(texto).toContain('p_d: number\n        }\n        Returns: unknown[]')
    expect(texto).toContain('Views: {\n      [_ in never]: never\n    }')
  })
})

// Las opciones del tsconfig.json del proyecto (`noUnusedLocals` incluido): las de `pnpm typecheck` sobre el archivo generado. Sin
// leer la lista de archivos del proyecto (`readDirectory` vacío): el programa son los dos virtuales.
function opcionesDelProyecto(): ts.CompilerOptions {
  const { config } = ts.readConfigFile('tsconfig.json', (f) => ts.sys.readFile(f))
  const sinArchivos = { ...ts.sys, readDirectory: () => [] }
  const { options } = ts.parseJsonConfigFileContent(config, sinArchivos, process.cwd())
  return { ...options, noEmit: true, incremental: false, plugins: [] }
}

// Un programa de TS con dos archivos virtuales (el generado y un uso) junto a los reales: supabase-js y database.types.ts.
function diagnosticos(archivos: Record<string, string>): string[] {
  const opciones = opcionesDelProyecto()
  const virtuales = new Map(Object.entries(archivos).map(([ruta, texto]) => [resolve(ruta), texto]))
  const host = ts.createCompilerHost(opciones)
  const real = { ...host }
  host.fileExists = (f) => virtuales.has(resolve(f)) || real.fileExists(f)
  host.readFile = (f) => virtuales.get(resolve(f)) ?? real.readFile(f)
  // La resolución de módulos pregunta primero por la carpeta: la virtual no existe en el disco.
  host.directoryExists = (d) =>
    [...virtuales.keys()].some((ruta) => ruta.startsWith(`${resolve(d)}/`)) ||
    (real.directoryExists?.(d) ?? false)
  host.getSourceFile = (f, idioma, ...resto) => {
    const texto = virtuales.get(resolve(f))
    return texto === undefined
      ? real.getSourceFile(f, idioma, ...resto)
      : ts.createSourceFile(f, texto, idioma)
  }
  const programa = ts.createProgram([...virtuales.keys()], opciones, host)
  return ts
    .getPreEmitDiagnostics(programa)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))
}

const USO = `import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/shared/types/database.types'
import type { ContratoAgenda } from './agenda'

const cliente = createClient<Database & ContratoAgenda>('http://127.0.0.1', 'clave')

export async function usar() {
  const reserva = await cliente.schema('agenda_publica').rpc('reservar', { p_turno: 'x' })
  const id: string | null = reserva.data
  const turnos = await cliente.schema('agenda_publica').from('turnos').select('id, estado').limit(1)
  const estado: 'libre' | 'tomado' | null | undefined = turnos.data?.[0]?.estado
  // @ts-expect-error un parámetro que no está en el contrato
  await cliente.schema('agenda_publica').rpc('reservar', { p_otro: 'x' })
  // @ts-expect-error una vista que no está en el contrato
  await cliente.schema('agenda_publica').from('no_esta').select('id')
  return [id, estado]
}
`

describe('tiposDeTs › tipa un cliente de supabase-js', () => {
  it('Database & ContratoAgenda: la rpc con sus parámetros y la vista con sus columnas', () => {
    const errores = diagnosticos({
      'scripts/contratos/__virtual__/agenda.ts': tiposDeTs(AGENDA_1, ORIGEN),
      'scripts/contratos/__virtual__/uso.ts': USO,
    })
    expect(errores).toEqual([])
  }, 30_000)
})
