// Generado por `pnpm db:types` (supabase gen types) a partir de las migraciones. No se edita: el primer `pnpm db:types` lo reescribe.
// Esta copia corresponde a la migración base del kit (`supabase/migrations/*_base.sql`), que sólo trae `_acotar_pagina`.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _acotar_pagina: {
        Args: { p_maximo: number; p_pedido: number; p_por_defecto: number }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
