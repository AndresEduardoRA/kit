// Lo puro del reporter que conserva los artefactos de un e2e que falló (`e2e/soporte/reporter-de-fallos.ts`).

export const CARPETA_DE_FALLOS = 'e2e-fallos'
export const FALLOS_GUARDADOS = 5

// El nombre de la carpeta de una corrida: la fecha y la hora, que ordenan como texto.
export function marcaDeFecha(ahora: Date): string {
  return ahora.toISOString().slice(0, 16).replace('T', '_').replace(':', '-')
}

// Las carpetas que sobran para que queden las `guardados` más nuevas.
export function sobrantes(existentes: readonly string[], guardados: number): string[] {
  return [...existentes].sort().slice(0, Math.max(0, existentes.length - guardados))
}

export interface Inestable {
  archivo: string
  linea: number
  titulo: string
  proyecto: string
}

// Lo que se avisa de las pruebas que pasaron recién al reintentar (`retries: 1` sólo en CI, FLUJO-1): una anotación de GitHub por prueba,
// que se ve en el PR, y un resumen en Markdown para la página de la corrida. Sin inestables, nada.
export function avisoDeInestables(inestables: readonly Inestable[]): {
  anotaciones: string[]
  resumen: string
} {
  if (inestables.length === 0) return { anotaciones: [], resumen: '' }
  const anotaciones = inestables.map(
    (i) =>
      `::warning file=${i.archivo},line=${String(i.linea)},title=e2e inestable::${i.titulo} (${i.proyecto}) pasó recién al reintentar: tiene una causa que buscar`,
  )
  const resumen = [
    `### e2e inestables (${String(inestables.length)})`,
    '',
    'Pasaron recién al reintentar. No ponen el PR en rojo, pero cada una tiene una causa que buscar (`.claude/rules/e2e.md`).',
    '',
    ...inestables.map((i) => `- \`${i.archivo}:${String(i.linea)}\` ${i.titulo} (${i.proyecto})`),
    '',
  ].join('\n')
  return { anotaciones, resumen }
}

// El archivo, dentro de la carpeta de una corrida que falló, con las pruebas que cayeron (las que no pasaron ni al reintentar): lo lee el
// aviso de la noche (`scripts/flujo/noche.mjs`, con el mismo nombre) para nombrar los specs caídos sin abrir el reporte de Playwright.
export const CAIDOS = 'caidos.txt'

// Una línea por prueba caída, `archivo:línea › título (proyecto)`, sin repetidas y ordenadas. Sin caídas, nada.
export function lineasDeCaidos(caidas: readonly Inestable[]): string {
  const lineas = [
    ...new Set(caidas.map((c) => `${c.archivo}:${String(c.linea)} › ${c.titulo} (${c.proyecto})`)),
  ].sort()
  return lineas.length === 0 ? '' : `${lineas.join('\n')}\n`
}
