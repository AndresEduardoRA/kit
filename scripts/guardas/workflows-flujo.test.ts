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
      'MIGRACIONES_BASE=$base pnpm exec vitest run scripts/guardas/orden-de-migraciones.test.ts',
    )
    expect(nivel1).toContain('base=FETCH_HEAD')
    // El título, sólo en el PR (el grupo no tiene título); las migraciones y los contratos, también en la cola de integración.
    expect(nivel1.match(/if: github\.event_name == 'pull_request'$/gm)).toHaveLength(1)
    expect(nivel1).toContain(
      "if: github.event_name == 'pull_request' || github.event_name == 'merge_group'",
    )
  })

  it('la cola de integración corre el CI sobre el commit del grupo (merge_group) y `listo` es su check', () => {
    expect(ci).toMatch(/^ {2}merge_group:\n {4}types: \[checks_requested\]$/m)
    expect(job('listo')).toMatch(/^ {4}if: always\(\)$/m)
    expect(readFileSync('scripts/ci-cambios.sh', 'utf8')).toMatch(/merge_group\) desde=/)
  })

  it('en la cola de integración lo que trae el PR es HEAD^1...HEAD: migraciones, contratos y e2e dirigidos contra HEAD^1', () => {
    const nivel1 = job('nivel-1')
    expect(nivel1).toMatch(/if \[ "\$EVENTO" = merge_group \]; then\n\s+base=HEAD\^1\n/)
    expect(nivel1).toContain('CONTRATOS_BASE=$base pnpm exec vitest run')
    // HEAD^1 tiene que estar en el clon: sin él, `git ls-tree` falla y la guarda de migraciones no compara nada.
    expect(nivel1).toMatch(
      /actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\n(?:\s*#.*\n)*\s+fetch-depth: 2\n/,
    )
    const cambios = job('cambios')
    expect(cambios).toContain(
      '[ "$EVENTO" = merge_group ] && ! desde=$(git rev-parse -q --verify \'HEAD^1\')',
    )
    expect(cambios).toContain('::error::el commit del grupo no tiene padre')
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
