// Lo que las guardas de escala (`escala.test.ts`) dejan pasar, **cada cosa con su motivo y su tope**. Una excepción que ya no coincide
// con nada falla (se saca), y una nueva se discute: el motivo es lo que permite revisarla. `.claude/rules/escala.md` es la regla;
// `docs/RENDIMIENTO.md`, el inventario.
import type { TablaAcotada } from './escala'

// Tablas que no crecen con el uso (configuración, catálogos, lo propio de una persona con un tope en la base): se leen enteras sin
// `.limit(`. Cada una dice por qué y hasta cuánto, p. ej. `ajustes: { motivo: 'Una sola fila (id = 1).', tope: '1 fila' }`. Hoy ninguna.
export const TABLAS_ACOTADAS: Readonly<Record<string, TablaAcotada>> = {}

export type Excepcion = {
  archivo: string
  regla: string
  motivo: string
  tope: string
}

// Hallazgos puntuales: el archivo, la regla rota y por qué se deja. Hoy ninguno; uno nuevo se discute.
export const EXCEPCIONES: readonly Excepcion[] = []
