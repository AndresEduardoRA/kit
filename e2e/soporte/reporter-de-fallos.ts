import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import type { FullConfig, FullResult, Reporter, Suite } from '@playwright/test/reporter'
import {
  CAIDOS,
  CARPETA_DE_FALLOS,
  FALLOS_GUARDADOS,
  lineasDeCaidos,
  marcaDeFecha,
  sobrantes,
} from '../../scripts/e2e-fallos'

// Conserva lo de una corrida que falló (traza, video, captura, reporte) en `e2e-fallos/<fecha>/`, ignorada por git, antes de
// que la corrida siguiente vacíe `test-results/`. Va en TODA corrida —`pnpm test:e2e <spec>` también—, no sólo en la completa:
// un fallo de una corrida dirigida también se investiga. Quedan los cinco últimos. Las pruebas que cayeron (ni al reintentar
// pasaron) quedan nombradas en `caidos.txt`: el aviso de la noche las lee de los artefactos (`scripts/flujo/noche.mjs`).
const CARPETAS = ['test-results', 'playwright-report']

export default class ReporterDeFallos implements Reporter {
  private suite: Suite | undefined

  onBegin(_config: FullConfig, suite: Suite): void {
    this.suite = suite
  }

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
    const caidos = lineasDeCaidos(
      (this.suite?.allTests() ?? [])
        .filter((t) => t.outcome() === 'unexpected')
        .map((t) => ({
          archivo: relative(process.cwd(), t.location.file),
          linea: t.location.line,
          titulo: t.title,
          proyecto: t.parent.project()?.name ?? '',
        })),
    )
    if (caidos) writeFileSync(`${destino}/${CAIDOS}`, caidos)
    for (const viejo of sobrantes(readdirSync(CARPETA_DE_FALLOS), FALLOS_GUARDADOS)) {
      rmSync(`${CARPETA_DE_FALLOS}/${viejo}`, { recursive: true, force: true })
    }
    console.error(`\n[e2e] Falló: los artefactos quedaron en ${destino}/.\n`)
  }
}
