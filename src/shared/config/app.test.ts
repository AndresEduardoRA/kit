import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COLOR_FONDO_CLARO, COLOR_FONDO_OSCURO, COLOR_TEMA } from './app'

const tokens = readFileSync(path.join(process.cwd(), 'design', 'tokens.css'), 'utf8')
const [claro = '', oscuro = ''] = tokens.split(/^\.dark \{/m)

function valorDe(bloque: string, variable: string): string | undefined {
  return new RegExp(`${variable}:\\s*([^;]+);`).exec(bloque)?.[1]?.trim()
}

// El manifest y la barra del navegador no leen variables CSS: usan copias. Si alguien cambia un token y no la copia, este test lo dice.
describe('las copias de design/tokens.css', () => {
  it('coinciden con el tema claro', () => {
    expect(valorDe(claro, '--color-primario')).toBe(COLOR_TEMA)
    expect(valorDe(claro, '--color-paper')).toBe(COLOR_FONDO_CLARO)
  })

  it('coinciden con el tema oscuro', () => {
    expect(valorDe(oscuro, '--color-paper')).toBe(COLOR_FONDO_OSCURO)
  })
})
