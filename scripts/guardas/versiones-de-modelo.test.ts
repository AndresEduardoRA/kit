import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Una versión de modelo escrita en un archivo versionado envejece sin que nadie lo note: el orquestador nombra niveles (rapido,
// normal, capaz) y alias (`opus`, `sonnet`), y `orquestador.sh verificar` dice qué modelo es hoy cada uno
// (scripts/orquestador/README.md › «Una tarea»). Esta guarda falla si algún archivo versionado nombra una versión.
// Los casos de abajo se arman en tiempo de ejecución: escritos tal cual, la guarda se marcaría a sí misma.
const VERSION_DE_MODELO =
  /\b(?:Opus|Sonnet|Haiku|Fable|Mythos) \d|\bclaude-(?:\d|(?:opus|sonnet|haiku|fable|mythos)-\d)/

const armar = (partes: string[], sep: string) => partes.join(sep)

describe('versiones de modelo › el patrón', () => {
  it('atrapa una familia con su número y los ids con versión, viejos y nuevos', () => {
    const positivos = [
      armar(['Opus', '4'], ' '),
      armar(['modelo: Sonnet', '5.5'], ' '),
      armar(['Haiku', '3'], ' '),
      armar(['Fable', '5'], ' '),
      armar(['Mythos', '1'], ' '),
      armar(['claude', 'opus', '4', '1'], '-'),
      armar(['claude', 'haiku', '5', '5'], '-'),
      armar(['claude', '3', '5', 'sonnet'], '-'),
    ]
    for (const p of positivos) expect(VERSION_DE_MODELO.test(p), p).toBe(true)
  })

  it('deja pasar los alias, los niveles y las palabras sueltas', () => {
    const negativos = [
      'opus',
      'sonnet[1m]',
      'NIVEL_CAPAZ="opus"',
      'sesión de Opus en modo plan',
      'claude-sesion-nueva',
      'claude -p --model haiku',
    ]
    for (const n of negativos) expect(VERSION_DE_MODELO.test(n), n).toBe(false)
  })
})

describe('versiones de modelo › los archivos versionados', () => {
  it('ninguno nombra una versión de modelo (va el alias o el nivel)', () => {
    const archivos = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
    const hallazgos: string[] = []
    for (const archivo of archivos) {
      let texto: string
      try {
        if (!lstatSync(archivo).isFile()) continue
        texto = readFileSync(archivo, 'utf8')
      } catch {
        continue // borrado en el árbol y todavía en el índice
      }
      if (texto.includes('\0')) continue // binario
      texto.split('\n').forEach((linea, i) => {
        if (VERSION_DE_MODELO.test(linea)) hallazgos.push(`${archivo}:${i + 1}: ${linea.trim()}`)
      })
    }
    expect(hallazgos).toEqual([])
  })
})
