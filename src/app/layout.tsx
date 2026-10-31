import type { Metadata, Viewport } from 'next'
import { ThemeProvider } from 'next-themes'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { Toaster } from 'sonner'
import {
  COLOR_FONDO_CLARO,
  COLOR_FONDO_OSCURO,
  DESCRIPCION_APP,
  NOMBRE_APP,
} from '@/shared/config/app'
import './globals.css'

// Las fuentes son del sistema de diseño de la semilla: el esqueleto usa las del sistema operativo (`--font-sans` y `--font-mono` de
// design/tokens.css) y no pide nada a la red al compilar. Una fuente propia va con `next/font/local` (o `next/font/google`, que baja
// la fuente en `next build`) y su variable se agrega a `className` de <html> y a `--font-sans` en los tokens.

export const metadata: Metadata = {
  title: { default: NOMBRE_APP, template: `%s · ${NOMBRE_APP}` },
  description: DESCRIPCION_APP,
  applicationName: NOMBRE_APP,
  // Mientras la semilla no diga lo contrario, nada de esto se indexa.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: COLOR_FONDO_CLARO },
    { media: '(prefers-color-scheme: dark)', color: COLOR_FONDO_OSCURO },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // next-themes pone la clase `.dark` en <html> antes de hidratar: de ahí el suppressHydrationWarning.
    <html lang="es" className="h-full antialiased" suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* Filtros, panel abierto y registro elegido viven en la URL (nuqs). */}
          <NuqsAdapter>{children}</NuqsAdapter>
          <Toaster position="bottom-right" closeButton />
        </ThemeProvider>
      </body>
    </html>
  )
}
