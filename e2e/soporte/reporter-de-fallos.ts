import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import type { FullResult, Reporter } from '@playwright/test/reporter'

// Conserva lo de una corrida que falló (traza, video, captura, reporte) en `e2e-fallos/<fecha>/`, ignorada por git, antes de que la
// corrida siguiente vacíe `test-results/`. Va en TODA corrida —`pnpm test:e2e <spec>` también—, no sólo en la completa: un fallo de
// una corrida dirigida también se investiga. Quedan los cinco últimos.
export const CARPETA_DE_FALLOS = 'e2e-fallos'
export const FALLOS_GUARDADOS = 5
const CARPETAS = ['test-results', 'playwright-report']

// `2026-10-30T14-05-09`: ordena por fecha y sirve de nombre de carpeta en cualquier sistema.
export function marcaDeFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 19).replaceAll(':', '-')
}

// Las carpetas que sobran: todas menos las `cuantas` más nuevas (por su nombre, que es la fecha).
export function sobrantes(nombres: readonly string[], cuantas: number): string[] {
  return [...nombres].sort().reverse().slice(cuantas)
}

export default class ReporterDeFallos implements Reporter {
  // El reporte HTML se escribe en su propio `onEnd`: este reporter va último en la configuración y espera su turno.
  onEnd(resultado: FullResult): void {
    if (resultado.status === 'passed') {
      return
    }
    const destino = `${CARPETA_DE_FALLOS}/${marcaDeFecha(new Date())}`
    mkdirSync(destino, { recursive: true })
    for (const carpeta of CARPETAS) {
      if (existsSync(carpeta)) {
        cpSync(carpeta, `${destino}/${carpeta}`, { recursive: true })
      }
    }
    for (const viejo of sobrantes(readdirSync(CARPETA_DE_FALLOS), FALLOS_GUARDADOS)) {
      rmSync(`${CARPETA_DE_FALLOS}/${viejo}`, { recursive: true, force: true })
    }
    console.error(`\n[e2e] Falló: los artefactos quedaron en ${destino}/.\n`)
  }
}
