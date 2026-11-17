// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  baseDePublicados,
  explicarModificada,
  leerDelArbol,
  leerPublicados,
  versionesModificadas,
} from '../contratos/publicados'

// Una versión publicada de un contrato no cambia nunca (.claude/rules/contratos.md): ni `contratos/<id>@<n>.json` del proveedor ni la
// copia fijada `.proyecto/contratos/<id>@<n>.json` del consumidor. Borrarla sí se puede (el último paso de un cambio; si sigue en
// `vigentes` la tumba `contrato:probar`). Contra `CONTRATOS_BASE` (en el CI del PR, `FETCH_HEAD`: el main recién bajado) o, en
// local, `origin/main`; sin esa referencia no hay contra qué comparar.
let repo = ''

function git(...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=ci', '-c', 'user.email=ci@ejemplo.test', ...args], {
    cwd: repo,
    encoding: 'utf8',
  }).trim()
}

function escribir(archivo: string, texto: string) {
  mkdirSync(dirname(join(repo, archivo)), { recursive: true })
  writeFileSync(join(repo, archivo), texto)
}

const modificadas = () =>
  versionesModificadas(leerPublicados('HEAD', repo) ?? new Map(), leerDelArbol(repo))

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'contratos-publicados-'))
  git('init', '-q', '-b', 'main')
  escribir('contratos/agenda@1.json', '{ "version": 1 }\n')
  escribir('contratos/agenda.config.json', '{ "esquema": "agenda_publica" }\n')
  escribir('.proyecto/contratos/pagos@3.json', '{ "version": 3 }\n')
  git('add', '.')
  git('commit', '-q', '-m', 'publicar')
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('las versiones publicadas: la regla', () => {
  it('sin cambios, nada', () => {
    expect(modificadas()).toEqual([])
  })

  it('modificar una versión publicada cae, la del proveedor y la copia del consumidor', () => {
    escribir('contratos/agenda@1.json', '{ "version": 1, "otra": true }\n')
    escribir('.proyecto/contratos/pagos@3.json', '{ "version": 3 }')
    expect(modificadas()).toEqual(['.proyecto/contratos/pagos@3.json', 'contratos/agenda@1.json'])
    git('checkout', '-q', '--', '.')
  })

  it('borrar una versión o sumar una nueva pasa; la configuración no es una versión', () => {
    unlinkSync(join(repo, 'contratos/agenda@1.json'))
    escribir('contratos/agenda@2.json', '{ "version": 2 }\n')
    escribir('contratos/agenda.config.json', '{ "esquema": "otro" }\n')
    expect(modificadas()).toEqual([])
    git('checkout', '-q', '--', '.')
  })

  it('sin la referencia de comparación no compara', () => {
    expect(leerPublicados('origin/main', repo)).toBeNull()
    expect(baseDePublicados({})).toBe('origin/main')
    expect(baseDePublicados({ CONTRATOS_BASE: 'FETCH_HEAD' })).toBe('FETCH_HEAD')
  })

  it('dice qué hacer en su lugar', () => {
    expect(explicarModificada('contratos/agenda@1.json', 'FETCH_HEAD')).toBe(
      'contratos/agenda@1.json cambió respecto de FETCH_HEAD: una versión publicada no cambia nunca. Lo nuevo va en agenda@2 (`provee`).',
    )
    expect(explicarModificada('.proyecto/contratos/pagos@3.json', 'origin/main')).toMatch(
      /tal cual sale de main del proveedor: para otra versión se cambia `consume`\.$/,
    )
  })
})

describe('las versiones publicadas: el repo', () => {
  it('ninguna versión publicada cambió respecto de lo integrado', () => {
    const base = baseDePublicados()
    const publicados = leerPublicados(base, process.cwd())
    // Sin la referencia (un clon sin main, un árbol exportado): no hay contra qué comparar.
    if (!publicados) return
    expect(
      versionesModificadas(publicados, leerDelArbol(process.cwd())).map((ruta) =>
        explicarModificada(ruta, base),
      ),
    ).toEqual([])
  })
})
