import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

// `publicar.sh` con la cola de integración (docs/FLUJO.md › «GitHub»): si main la exige, nadie trae main a la rama; en verde dice el
// puesto, y si la cola lo saca después de empezar la corrida, el motivo, los jobs caídos del grupo y qué hacer. Mismo banco que
// publicar.test.ts (un repo temporal con su `origin` bare y un `gh` falso), con el GitHub de cada vuelta en archivos: `vueltas` cuenta
// las lecturas del PR; las primeras `abiertas` lo dan abierto y en verde, después integrado.
const FLUJO = resolve('scripts/flujo')
const raices: string[] = []
let raiz = ''
let repo = ''

const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@ejemplo.test', ...args], {
    cwd: repo,
    encoding: 'utf8',
  }).trim()
const archivo = (n: string) => join(raiz, n)
const llamadas = () =>
  existsSync(archivo('llamadas.txt')) ? readFileSync(archivo('llamadas.txt'), 'utf8') : ''

function falso(nombre: string, cuerpo: string) {
  writeFileSync(
    join(raiz, 'bin', nombre),
    `#!/usr/bin/env bash\necho "${nombre} $*" >> "${archivo('llamadas.txt')}"\n${cuerpo}\n`,
  )
  chmodSync(join(raiz, 'bin', nombre), 0o755)
}

/** El `gh` falso: la cola activa (o no), el PR abierto `abiertas` vueltas con `mergeStateStatus`, y la cola de cola.json. */
function github({ cola = true, abiertas = 2, estado = 'BEHIND' } = {}) {
  const verde = JSON.stringify({
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    mergeStateStatus: estado,
    statusCheckRollup: [
      { __typename: 'CheckRun', name: 'Listo · todo en verde', conclusion: 'SUCCESS' },
    ],
  })
  falso(
    'gh',
    `case "$*" in
  "auth token"*) exit 1 ;;
  "pr create"*) touch "${archivo('pr-creado')}" ;;
  "api repos/{owner}/{repo}/rules/branches/main"*) ${cola ? `echo '[{"type":"merge_queue"}]'` : `echo '[]'`} ;;
  "api graphql"*) cat "${archivo('cola.json')}" ;;
  "run list"*) cat "${archivo('corridas.json')}" 2>/dev/null ;;
  "run view"*) cat "${archivo('jobs.json')}" 2>/dev/null ;;
  "pr view"*statusCheckRollup*)
    echo x >> "${archivo('vueltas')}"
    if [ "$(wc -l < "${archivo('vueltas')}")" -le ${String(abiertas)} ]; then
      echo '${verde}'
    else
      echo '{"state":"MERGED","mergeable":"UNKNOWN","mergeStateStatus":"UNKNOWN","statusCheckRollup":[]}'
    fi ;;
  "pr view"*) [ -f "${archivo('pr-creado')}" ] || exit 1; echo 7 ;;
esac
exit 0`,
  )
}

/** Lo que GitHub responde por GraphQL sobre el PR en la cola. */
function enLaCola(c: {
  enCola: boolean
  puesto?: number
  entrada?: string
  salida?: { id: string; cuando: string; motivo: string }
}) {
  const nodos = [
    ...(c.entrada
      ? [{ __typename: 'AddedToMergeQueueEvent', id: 'E1', createdAt: c.entrada }]
      : []),
    ...(c.salida
      ? [
          {
            __typename: 'RemovedFromMergeQueueEvent',
            id: c.salida.id,
            createdAt: c.salida.cuando,
            reason: c.salida.motivo,
          },
        ]
      : []),
  ]
  writeFileSync(
    archivo('cola.json'),
    JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            headRefOid: 'abc',
            isInMergeQueue: c.enCola,
            mergeQueueEntry: c.enCola ? { position: c.puesto ?? 1, state: 'QUEUED' } : null,
            autoMergeRequest: c.enCola ? { enabledAt: '2026-01-01T00:00:00Z' } : null,
            timelineItems: { nodes: nodos },
          },
        },
      },
    }),
  )
}

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'publicar-cola-'))
  raices.push(raiz)
  repo = join(raiz, 'repo')
  mkdirSync(join(raiz, 'bin'))
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', join(raiz, 'origin.git')])
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  git('remote', 'add', 'origin', join(raiz, 'origin.git'))
  mkdirSync(join(repo, 'scripts/flujo'), { recursive: true })
  writeFileSync(join(repo, 'scripts/flujo/limpiar-ramas.mjs'), 'console.log("limpiar")\n')
  for (const g of ['publicar.sh', 'cola-de-integracion.sh'])
    copyFileSync(join(FLUJO, g), join(repo, 'scripts/flujo', g))
  git('add', '.')
  git('commit', '-q', '-m', 'chore: inicio')
  git('push', '-q', '-u', 'origin', 'main')
  falso('pnpm', 'exit 0')
  git('switch', '-q', '-c', 'feat/algo')
  writeFileSync(join(repo, 'b.txt'), 'b\n')
  git('add', '.')
  git('commit', '-q', '-m', 'feat(leads): algo nuevo')
})
afterAll(() => {
  for (const r of raices) rmSync(r, { recursive: true, force: true })
})

function publicar() {
  const r = spawnSync('bash', [join(repo, 'scripts/flujo/publicar.sh')], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      HOME: raiz,
      PATH: `${join(raiz, 'bin')}:${process.env['PATH'] ?? ''}`,
      ESPERA_PASO: '0',
    },
  })
  return { estado: r.status, stderr: r.stderr, stdout: r.stdout }
}

describe('publicar.sh › la cola de integración', () => {
  it('con la cola: la rama atrasada no se pone al día, en verde dice el puesto una vez y espera a verlo integrado', () => {
    github({ abiertas: 3 })
    enLaCola({ enCola: true, puesto: 2, entrada: '2026-01-01T00:00:00Z' })
    const r = publicar()
    expect(r.estado, r.stderr).toBe(0)
    expect(r.stdout).toContain('en verde entra a la cola de integración')
    expect(r.stdout.match(/en la cola de integración \(puesto 2\)/g)).toHaveLength(1)
    expect(llamadas()).not.toContain('update-branch')
    expect(r.stdout).toContain('PR #7 integrado en main')
  })

  it('la cola lo saca después de empezar: el motivo, cada job caído del grupo con su comando y sale con 1', () => {
    github()
    enLaCola({
      enCola: false,
      entrada: '2099-01-01T00:00:00Z',
      salida: { id: 'S1', cuando: '2099-01-01T00:10:00Z', motivo: 'CI_FAILED' },
    })
    writeFileSync(
      archivo('corridas.json'),
      JSON.stringify([
        {
          databaseId: 41,
          headBranch: 'gh-readonly-queue/main/pr-7-abc',
          createdAt: '2099-01-01T00:01:00Z',
        },
      ]),
    )
    writeFileSync(
      archivo('jobs.json'),
      JSON.stringify({
        jobs: [
          {
            name: 'Nivel 1 · lint, tipos, test:kit y mapa',
            conclusion: 'failure',
            databaseId: 901,
          },
          { name: 'Listo · todo en verde', conclusion: 'failure', databaseId: 902 },
        ],
      }),
    )
    const r = publicar()
    expect(r.estado).toBe(1)
    expect(r.stderr).toContain('la cola de integración sacó el PR #7: CI_FAILED')
    expect(r.stderr).toContain(
      '· Nivel 1 · lint, tipos, test:kit y mapa  gh run view --job 901 --log-failed',
    )
    expect(r.stderr).not.toContain('902')
    expect(r.stderr).toContain('pnpm exec supabase migration new')
  })

  it('una salida de antes de esta corrida no cuenta: sigue esperando', () => {
    github()
    enLaCola({
      enCola: false,
      entrada: '2020-01-01T00:00:00Z',
      salida: { id: 'S0', cuando: '2020-01-01T00:10:00Z', motivo: 'CI_FAILED' },
    })
    const r = publicar()
    expect(r.estado, r.stderr).toBe(0)
    expect(r.stderr).not.toContain('sacó')
    expect(r.stdout).toContain('PR #7 integrado en main')
  })

  it('sin la cola: la rama atrasada se pone al día por la API, como siempre, y no pregunta por la cola', () => {
    github({ cola: false, abiertas: 1 })
    const r = publicar()
    expect(r.estado, r.stderr).toBe(0)
    expect(r.stdout).toContain('GitHub lo integra con «Listo · todo en verde»')
    expect(llamadas()).toContain('gh api -X PUT repos/{owner}/{repo}/pulls/7/update-branch')
    expect(llamadas()).not.toContain('graphql')
  })
})
