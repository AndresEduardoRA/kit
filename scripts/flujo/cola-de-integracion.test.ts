import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// Lo que se le pregunta a GitHub sobre la cola de integración (scripts/flujo/cola-de-integracion.sh), con `gh` falso como función de
// bash: responde lo que se le da por argumento (la respuesta de GitHub) y registra con qué lo llamaron.
const BIBLIOTECA = resolve('scripts/flujo/cola-de-integracion.sh')
const raiz = mkdtempSync(join(tmpdir(), 'cola-de-integracion-'))
afterAll(() => rmSync(raiz, { recursive: true, force: true }))

function correr(llamada: string, respuesta: string, rc = 0) {
  const archivo = join(raiz, 'respuesta.json')
  writeFileSync(archivo, respuesta)
  const guion = `source ${JSON.stringify(BIBLIOTECA)}
gh() { printf '%s\\n' "$*" >> ${JSON.stringify(join(raiz, 'llamadas.txt'))}; cat ${JSON.stringify(archivo)}; return ${String(rc)}; }
${llamada}`
  const r = spawnSync('bash', ['-c', guion], { encoding: 'utf8' })
  return { salida: r.stdout.trim(), estado: r.status }
}

const pr = (campos: object) => JSON.stringify({ data: { repository: { pullRequest: campos } } })
const entro = (id: string, createdAt: string) => ({
  __typename: 'AddedToMergeQueueEvent',
  id,
  createdAt,
})
const salio = (id: string, createdAt: string, reason: string) => ({
  __typename: 'RemovedFromMergeQueueEvent',
  id,
  createdAt,
  reason,
})

describe('estado_en_la_cola', () => {
  it('en la cola: el puesto, el auto-merge, la punta y la entrada; sin salida', () => {
    const r = correr(
      'estado_en_la_cola 7',
      pr({
        headRefOid: 'abc',
        isInMergeQueue: true,
        mergeQueueEntry: { position: 2, state: 'QUEUED' },
        autoMergeRequest: { enabledAt: '2026-11-20T10:00:00Z' },
        timelineItems: { nodes: [entro('E1', '2026-11-20T10:05:00Z')] },
      }),
    )
    expect(r.estado).toBe(0)
    expect(JSON.parse(r.salida)).toEqual({
      enCola: true,
      puesto: 2,
      autoMerge: true,
      sha: 'abc',
      entrada: '2026-11-20T10:05:00Z',
      salida: null,
    })
  })

  it('fuera de la cola: la última salida con su id, cuándo y el motivo de GitHub', () => {
    const r = correr(
      'estado_en_la_cola 7',
      pr({
        headRefOid: 'abc',
        isInMergeQueue: false,
        mergeQueueEntry: null,
        autoMergeRequest: null,
        timelineItems: {
          nodes: [
            entro('E1', '2026-11-20T10:05:00Z'),
            salio('S1', '2026-11-20T10:20:00Z', 'CI_FAILURE'),
            entro('E2', '2026-11-20T11:00:00Z'),
            salio('S2', '2026-11-20T11:30:00Z', 'CI_TIMEOUT'),
          ],
        },
      }),
    )
    expect(JSON.parse(r.salida)).toEqual({
      enCola: false,
      puesto: null,
      autoMerge: false,
      sha: 'abc',
      entrada: '2026-11-20T11:00:00Z',
      salida: { id: 'S2', cuando: '2026-11-20T11:30:00Z', motivo: 'CI_TIMEOUT' },
    })
  })

  it('una salida más vieja que la última entrada queda a la vista para que quien llama la descarte', () => {
    const r = correr(
      'estado_en_la_cola 7',
      pr({
        headRefOid: 'abc',
        isInMergeQueue: true,
        mergeQueueEntry: { position: 1, state: 'AWAITING_CHECKS' },
        autoMergeRequest: { enabledAt: 'x' },
        timelineItems: {
          nodes: [salio('S1', '2026-11-20T10:20:00Z', 'x'), entro('E2', '2026-11-20T11:00:00Z')],
        },
      }),
    )
    const c = JSON.parse(r.salida) as { entrada: string; salida: { cuando: string } }
    expect(c.salida.cuando < c.entrada).toBe(true)
  })

  it('pregunta por GraphQL con el dueño y el repo de la carpeta y el número del PR', () => {
    correr('estado_en_la_cola 41', pr({ headRefOid: 'a', timelineItems: { nodes: [] } }))
    const llamadas = readFileSync(join(raiz, 'llamadas.txt'), 'utf8')
    expect(llamadas).toContain('api graphql -F owner={owner} -F name={repo} -F n=41')
    expect(llamadas).toContain('isInMergeQueue')
  })

  it('si gh falla o no responde, nada y 1', () => {
    expect(correr('estado_en_la_cola 7', 'boom', 1)).toEqual({ salida: '', estado: 1 })
    expect(correr('estado_en_la_cola 7', '')).toEqual({ salida: '', estado: 1 })
  })
})

describe('corrida_del_grupo y caidos_del_grupo', () => {
  it('elige la corrida más nueva del grupo de ese PR, no la de otro', () => {
    const corridas = [
      {
        databaseId: 9,
        headBranch: 'gh-readonly-queue/main/pr-70-ccc',
        createdAt: '2026-11-20T12:00:00Z',
      },
      {
        databaseId: 8,
        headBranch: 'gh-readonly-queue/main/pr-7-bbb',
        createdAt: '2026-11-20T11:00:00Z',
      },
      {
        databaseId: 5,
        headBranch: 'gh-readonly-queue/main/pr-7-aaa',
        createdAt: '2026-11-20T10:00:00Z',
      },
    ]
    expect(correr('corrida_del_grupo 7', JSON.stringify(corridas)).salida).toBe('8')
    expect(correr('corrida_del_grupo 3', JSON.stringify(corridas)).salida).toBe('')
  })

  it('da los jobs caídos como jobs_caidos (nombre, job, corrida), sin «Listo»; sin failure, los cancelados', () => {
    const jobs = (lista: object[]) => JSON.stringify({ jobs: lista })
    expect(
      correr(
        'caidos_del_grupo 8',
        jobs([
          { name: 'Base · reset', conclusion: 'failure', databaseId: 81 },
          { name: 'e2e · bloque 2 de 8', conclusion: 'cancelled', databaseId: 82 },
          { name: 'Listo · todo en verde', conclusion: 'failure', databaseId: 83 },
          { name: 'Nivel 1', conclusion: 'success', databaseId: 84 },
        ]),
      ).salida,
    ).toBe('Base · reset\t81\t8')
    expect(
      correr(
        'caidos_del_grupo 8',
        jobs([
          { name: 'e2e · bloque 2 de 8', conclusion: 'cancelled', databaseId: 82 },
          { name: 'Listo · todo en verde', conclusion: 'failure', databaseId: 83 },
        ]),
      ).salida,
    ).toBe('e2e · bloque 2 de 8\t82\t8')
  })
})

describe('cola_activa', () => {
  it('true si un ruleset de main exige la cola; false si no, o si GitHub no responde', () => {
    expect(
      correr('cola_activa', JSON.stringify([{ type: 'pull_request' }, { type: 'merge_queue' }]))
        .salida,
    ).toBe('true')
    expect(correr('cola_activa', JSON.stringify([{ type: 'pull_request' }])).salida).toBe('false')
    expect(correr('cola_activa', JSON.stringify({ message: 'Not Found' }), 1).salida).toBe('false')
    expect(correr('cola_activa', '').salida).toBe('false')
  })
})
