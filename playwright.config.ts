import { defineConfig, devices } from '@playwright/test'
import { archivosSinCelular, patronesDePruebasSinCelular } from './e2e/soporte/sin-celular'

// Corre contra la app COMPILADA (NEXT_DIST_DIR=.next-e2e) y Supabase local (supabase start).
// El e2e completo parte de un `db:reset`: `pnpm test:e2e:completo`. Un spec suelto: `pnpm test:e2e <spec>`.
// El puerto sale del bloque del proyecto (`E2E_PORT`, scripts/lib/stack-local.mjs; en un carril, de `.env.carril`).
const puerto = Number(process.env['E2E_PORT'] ?? 8210)

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // En CI, un reintento: una prueba inestable no pone el PR en rojo, pero el reporter de inestables la anota en el PR (en calesa-app,
  // cada rojo así devolvía el PR sin código roto). En local, ninguno: la causa se busca (`.claude/rules/e2e.md`).
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  // El último guarda los artefactos de toda corrida que falla (`e2e/soporte/reporter-de-fallos.ts`).
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['./e2e/soporte/reporter-de-inestables.ts'],
    ['./e2e/soporte/reporter-de-fallos.ts'],
  ],
  // La guardia: falla en segundos si las funciones edge de PILOTO_FUNCIONES no están servidas (e2e/soporte/guardia.ts).
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${puerto}`,
    // Lo de un fallo queda para diagnosticarlo; el reporter de fallos lo copia a `e2e-fallos/` antes de la
    // corrida siguiente, que vacía `test-results/`.
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // semilla-a-repo los cambia por el idioma y la zona horaria de la semilla.
    locale: 'es-BO',
    timezoneId: 'America/La_Paz',
  },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'movil',
      use: { ...devices['Pixel 7'] },
      // Todo spec corre en los dos proyectos, salvo lo que se marca en el propio spec con un comentario y su motivo
      // (`// @sin-celular-archivo:` y `// @sin-celular:`; `e2e/soporte/sin-celular.ts`).
      testIgnore: archivosSinCelular('./e2e'),
      grepInvert: patronesDePruebasSinCelular('./e2e'),
    },
  ],
  webServer: {
    command: process.env['E2E_PROD']
      ? `NEXT_DIST_DIR=.next-e2e pnpm next start -p ${String(puerto)}`
      : `pnpm next dev -p ${String(puerto)}`,
    url: `http://localhost:${String(puerto)}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
