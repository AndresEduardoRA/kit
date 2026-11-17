// El contrato que da la base de ejemplo (`base-de-ejemplo.sql`) con la configuración de abajo, en su orden canónico: lo fijan las
// pruebas del proveedor (byte a byte) y lo usan como copia fijada las del consumidor.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { ConfigDeContrato, Contrato } from '../esquemas'
import type { Consultar } from '../introspeccion'

export const CONFIG_AGENDA: ConfigDeContrato = {
  esquema: 'agenda_publica',
  objetos: ['turnos', 'reservar', 'turnos_del_dia', 'franja_de'],
}

export const AGENDA_1: Contrato = {
  contrato: 'agenda',
  version: 1,
  tipo: 'base',
  esquema: 'agenda_publica',
  usoDelEsquema: ['anon', 'authenticated'],
  vistas: [
    {
      nombre: 'turnos',
      columnas: [
        { nombre: 'estado', tipo: 'agenda_publica.estado' },
        { nombre: 'id', tipo: 'uuid' },
        { nombre: 'inicio', tipo: 'timestamp with time zone' },
        { nombre: 'nota', tipo: 'text' },
      ],
      permisos: { anon: ['select'], authenticated: ['select'], service_role: [] },
    },
  ],
  rpc: [
    {
      nombre: 'franja_de',
      parametros: [{ nombre: 'p_turno', tipo: 'uuid', conDefault: false }],
      retorno: { conjunto: false, tipo: 'agenda_publica.franja' },
      permisos: { anon: [], authenticated: ['execute'], service_role: ['execute'] },
    },
    {
      nombre: 'reservar',
      parametros: [
        { nombre: 'p_turno', tipo: 'uuid', conDefault: false },
        { nombre: 'p_nota', tipo: 'text', conDefault: true },
      ],
      retorno: { conjunto: false, tipo: 'uuid' },
      permisos: { anon: [], authenticated: ['execute'], service_role: ['execute'] },
    },
    {
      nombre: 'turnos_del_dia',
      parametros: [{ nombre: 'p_dia', tipo: 'date', conDefault: false }],
      retorno: {
        conjunto: true,
        tipo: 'record',
        columnas: [
          { nombre: 'id', tipo: 'uuid' },
          { nombre: 'inicio', tipo: 'timestamp with time zone' },
        ],
      },
      permisos: { anon: ['execute'], authenticated: ['execute'], service_role: ['execute'] },
    },
  ],
  tipos: [
    { nombre: 'estado', clase: 'enum', valores: ['libre', 'tomado'] },
    {
      nombre: 'franja',
      clase: 'compuesto',
      campos: [
        { nombre: 'estado', tipo: 'agenda_publica.estado' },
        { nombre: 'inicio', tipo: 'timestamp with time zone' },
      ],
    },
  ],
}

export type BaseDeEjemplo = {
  consultar: Consultar
  /** Corre `sql` (DDL incluido) en una transacción, después `prueba`, y revierte todo. */
  conCambio: <T>(sql: string, prueba: () => Promise<T>) => Promise<T>
}

/** Una PGlite con la base de ejemplo. Arrancarla pasa los 5 s del tope local de una prueba: va en un `beforeAll` con su tope. */
export async function baseDeEjemplo(): Promise<BaseDeEjemplo> {
  const db = new PGlite()
  await db.exec(readFileSync(join(import.meta.dirname, 'base-de-ejemplo.sql'), 'utf8'))
  return {
    consultar: async (sql) => (await db.query<{ r: unknown }>(sql)).rows[0]?.r,
    conCambio: async (sql, prueba) => {
      await db.exec('begin')
      try {
        await db.exec(sql)
        return await prueba()
      } finally {
        await db.exec('rollback')
      }
    },
  }
}
