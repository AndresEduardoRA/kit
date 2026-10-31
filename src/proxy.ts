import type { NextRequest } from 'next/server'
import { actualizarSesion } from '@/shared/lib/supabase/proxy'

// Next 16: `proxy.ts` (antes `middleware.ts`) va al nivel de `app/`, no adentro.
// En cada request refresca la sesión de Supabase y deja las cookies nuevas en la respuesta. Decidir quién pasa (sin sesión, lo
// protegido va a la pantalla de ingreso con `returnTo`) es del paso que crea el acceso: usa `usuarioId` de `actualizarSesion()`.
// Es la primera barrera; las pantallas vuelven a pedir la sesión y la base decide con RLS.
export async function proxy(request: NextRequest) {
  const { respuesta } = await actualizarSesion(request)
  return respuesta
}

export const config = {
  // Todo menos lo que siempre es público: los estáticos de Next, el manifest y los íconos.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|apple-touch-icon.png|manifest.webmanifest|iconos/).*)',
  ],
}
