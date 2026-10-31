import { z } from 'zod'

// Las variables de entorno, en un solo lugar: qué pide cada entorno y qué falta. Puro (sin `process.env` ni `server-only`): lo usan
// la app al arrancar y al compilar, y `pnpm env:check` (scripts/env-check.ts). Una variable nueva se agrega aquí, en `.env.example`
// y, si es pública, en `leerEntornoPublico()` de `entorno.ts`.

const texto = z.string().trim().min(1, { error: 'falta' })
const url = z.url({ error: 'no es una URL' })
const opcional = <T extends z.ZodType>(esquema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), esquema.optional())

export const PROVEEDORES_DE_EMAIL = ['ninguno', 'mailpit', 'resend', 'cloudflare'] as const
export type ProveedorDeEmail = (typeof PROVEEDORES_DE_EMAIL)[number]

// Los proveedores con adaptador en `src/shared/lib/email/adaptadores/`. Los demás se nombran para decirlo antes del primer correo.
export const PROVEEDORES_CON_ADAPTADOR: readonly ProveedorDeEmail[] = ['ninguno', 'mailpit']

// Viajan al navegador: el nombre literal `NEXT_PUBLIC_*` (Next sólo incrusta las que se escriben así).
export const esquemaPublico = z.object({
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: texto,
})

// Sólo servidor.
export const esquemaDelServidor = z
  .object({
    SUPABASE_SECRET_KEY: texto,
    EMAIL_PROVEEDOR: z
      .enum(PROVEEDORES_DE_EMAIL, { error: `es uno de ${PROVEEDORES_DE_EMAIL.join(', ')}` })
      .default('ninguno'),
    EMAIL_REMITENTE: opcional(z.email({ error: 'no es un correo' })),
    EMAIL_REMITENTE_NOMBRE: opcional(texto),
    MAILPIT_URL: opcional(url),
  })
  .superRefine((e, ctx) => {
    if (e.EMAIL_PROVEEDOR === 'ninguno') return
    for (const clave of ['EMAIL_REMITENTE', 'EMAIL_REMITENTE_NOMBRE'] as const) {
      if (!e[clave])
        ctx.addIssue({
          code: 'custom',
          path: [clave],
          message: `falta (EMAIL_PROVEEDOR=${e.EMAIL_PROVEEDOR})`,
        })
    }
    if (e.EMAIL_PROVEEDOR === 'mailpit' && !e.MAILPIT_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAILPIT_URL'],
        message: 'falta (EMAIL_PROVEEDOR=mailpit)',
      })
    }
    if (!PROVEEDORES_CON_ADAPTADOR.includes(e.EMAIL_PROVEEDOR)) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_PROVEEDOR'],
        message: `${e.EMAIL_PROVEEDOR} todavía no tiene adaptador (src/shared/lib/email/adaptadores/); hoy: ${PROVEEDORES_CON_ADAPTADOR.join(' o ')}`,
      })
    }
  })

// `.env.demo`: lo que leen los scripts de la demo (un proyecto de Supabase en la nube, sin datos reales). Nunca lo lee la app.
export const esquemaDeLaDemo = z.object({
  DEMO_SUPABASE_URL: url,
  DEMO_CLAVE_PUBLICA: texto,
  DEMO_CLAVE_SECRETA: texto,
  DEMO_SITE_URL: url,
  // El equipo de Vercel, para el comodín de los previews (`https://*-<equipo>.vercel.app/**`, sólo demo).
  DEMO_VERCEL_EQUIPO: opcional(
    z
      .string()
      .regex(/^[a-z0-9-]+$/, { error: 'es el slug del equipo (minúsculas, números y guiones)' }),
  ),
  // El SMTP de los correos de Auth. Sin él, Supabase manda con su SMTP de prueba (pocos correos por hora).
  SMTP_HOST: opcional(texto),
  SMTP_USUARIO: opcional(texto),
  SMTP_CLAVE: opcional(texto),
  EMAIL_REMITENTE: opcional(z.email({ error: 'no es un correo' })),
  EMAIL_REMITENTE_NOMBRE: opcional(texto),
})

export type Problema = { variable: string; motivo: string }

// Lo que falta o está mal en `entorno` según `esquema`, sin los valores (nunca se imprime un valor).
export function problemasDe(
  esquema: z.ZodType,
  entorno: Record<string, string | undefined>,
): Problema[] {
  const r = esquema.safeParse(entorno)
  if (r.success) return []
  return r.error.issues.map((i) => ({
    variable: i.path.map(String).join('.') || '(entorno)',
    motivo: i.code === 'invalid_type' && i.input === undefined ? 'falta' : i.message,
  }))
}

// Si `next.config.ts` valida las públicas: sólo en `next build`. `next typegen` (el `pnpm typecheck`) carga la configuración con la
// misma fase y no las necesita; se reconoce por su subcomando.
export function validaLaCompilacion(fase: string, argv: readonly string[]): boolean {
  return fase === 'phase-production-build' && !argv.includes('typegen')
}

// Un mensaje para cortar el arranque o el build, con cada variable y su motivo.
export function mensajeDeProblemas(donde: string, problemas: readonly Problema[]): string {
  return [
    `El entorno de ${donde} está incompleto (.env.example y pnpm env:check):`,
    ...problemas.map((p) => `  - ${p.variable}: ${p.motivo}`),
  ].join('\n')
}
