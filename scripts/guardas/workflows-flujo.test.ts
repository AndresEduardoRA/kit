import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { jobsDe } from './workflows'

// Lo que el flujo de un PR necesita del CI (docs/FLUJO.md): el Nivel 1 valida el título (el commit que queda en main con el squash) y
// que las migraciones del PR vayan después de las de main, y `listo` resume a todos los jobs en el único check que main exige: con él
// en verde GitHub integra el PR solo. Si cae: el auto-merge dejaría de ser de fiar.
const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
const job = (nombre: string) => jobsDe(ci).find((j) => j.nombre === nombre)?.bloque ?? ''

// La lista de `needs:` de un job, escrita en línea (`[a, b]`) o en bloque (un `- a` por línea).
function needsDe(bloque: string): string[] {
  const enLinea = /^ {4}needs:\s*\[([^\]]*)\]/m.exec(bloque)?.[1]
  const enBloque = /^ {4}needs:\s*\n((?: {6}- .+(?:\n|$))+)/m.exec(bloque)?.[1]
  return (enLinea ?? enBloque ?? '')
    .split(enLinea === undefined ? '\n' : ',')
    .map((x) => x.replace(/^\s*- /, '').trim())
    .filter(Boolean)
}

describe('ci.yml › lo que pide el flujo de un PR', () => {
  it('lee los needs de un job en línea o en bloque', () => {
    expect(needsDe('    needs: [a, b-c]\n')).toEqual(['a', 'b-c'])
    expect(needsDe('    needs:\n      - a\n      - b-c\n    runs-on: x\n')).toEqual(['a', 'b-c'])
    expect(needsDe('    needs: cambios\n')).toEqual([])
  })

  it('el Nivel 1 de un PR revisa su título (el commit que queda en main) y que sus migraciones vayan después de las de main', () => {
    const nivel1 = job('nivel-1')
    expect(nivel1).toContain('printf \'%s\\n\' "$TITULO" | pnpm exec commitlint')
    expect(nivel1).toContain('TITULO: ${{ github.event.pull_request.title }}')
    expect(nivel1).toContain(
      'MIGRACIONES_BASE=FETCH_HEAD pnpm exec vitest run scripts/guardas/orden-de-migraciones.test.ts',
    )
    expect(nivel1.match(/if: github\.event_name == 'pull_request'/g)).toHaveLength(2)
  })

  it('el Nivel 1 corre shellcheck sobre todo guion de bash, con el del apt del runner y sin acciones de terceros', () => {
    const nivel1 = job('nivel-1')
    expect(nivel1).toContain('- name: shellcheck')
    expect(nivel1).toContain('sudo apt-get install -y -q shellcheck')
    expect(nivel1).toContain('shopt -s globstar')
    expect(nivel1).toContain('shellcheck scripts/**/*.sh .claude/hooks/*.sh')
  })

  it('`listo` espera a todos los demás, corre siempre y cae si alguno cayó o se canceló', () => {
    const listo = job('listo')
    const otros = jobsDe(ci)
      .map((j) => j.nombre)
      .filter((n) => n !== 'listo')
    expect(needsDe(listo)).toEqual(otros)
    expect(listo).toMatch(/^ {4}if: always\(\)$/m)
    expect(listo).toContain("RESULTADOS: ${{ join(needs.*.result, ' ') }}")
    expect(listo).toContain('*" failure "* | *" cancelled "*)')
  })
})
