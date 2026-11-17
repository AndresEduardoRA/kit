import { readFileSync } from 'node:fs'
import { format } from 'prettier'
import { describe, expect, it } from 'vitest'
import {
  decisionesDePrs,
  idsDe,
  leccionesConSemillas,
  riesgosDeLaSemilla,
  seccion,
  textoDecisiones,
  textoEstado,
  textoPendientes,
} from './cierre-docs.mjs'
import {
  borradorRetro,
  datosDeIssue,
  pasosSinTerminar,
  problemasDelCierre,
} from './cierre-retro.mjs'
import { manifiestoEnMantenimiento } from './cierre.mjs'

// Lo puro del cierre de la construcción (cierre-docs.mjs, cierre-retro.mjs y el manifiesto de cierre.mjs). De punta a punta, sobre el
// proyecto de ejemplo: scripts/kit/cierre-ensayo.test.mjs.

const REGISTRO = `# Registro · turnero

| ID | Tema | Decisión | Estado | Fuente |
|---|---|---|---|---|
| A1 | Qué es | Turnos de una barbería | cerrada | dueño |
| C1 | Datos en la web | Todo por el contrato | recomendado aceptado | dueño |
| A2 | Primera versión | Reservar y cancelar | cerrada | dueño |
| Z9 | Algo raro | Va a otras | cerrada | dueño |
`
const COMUN = `# Turnero\n\n## 8. Riesgos y supuestos\n\n- Supuesto: Resend en su plan gratis (G1). Si se pasa,\n  se avisa.\n- Riesgo: dos clientes a la vez (F1).\n\n## 9. Otra\n\n- no va\n`
const SEMILLA = `# turnero-app\n\n## 12. Riesgos y supuestos\n\nChoque de reservas resuelto en la RPC (F1).\n\nSupuesto: una sola zona horaria.\n`
const PR = {
  number: 10,
  title: 'feat(agenda): la agenda del día',
  body: '## Qué cambió\n\nAlgo.\n\n## Decisiones tomadas sin preguntar\n\n- La semana empieza el lunes.\n- Sin vista mensual.\n\n## Lo que quedó fuera\n\n- Nada.\n',
}

describe('cierre › docs de mantenimiento', () => {
  it('DECISIONES: el registro por área con su ID, una letra desconocida a «Otras» y lo que ya había debajo sin su título', () => {
    const t = textoDecisiones({
      registro: REGISTRO,
      etiqueta: 'semilla-v1',
      existente: '# Decisiones\n\nIntro vieja.\n\n## Stack\n\n- **Sin Biome.** Por algo.\n',
    })
    expect(t).toContain(
      '## Producto (A)\n\n- **A1 · Qué es.** Turnos de una barbería.\n- **A2 · Primera versión.** Reservar y cancelar.',
    )
    expect(t).toContain(
      '## Datos sensibles (C)\n\n- **C1 · Datos en la web.** Todo por el contrato.',
    )
    expect(t).toContain('## Otras\n\n- **Z9 · Algo raro.** Va a otras.')
    expect(t.indexOf('## Producto')).toBeLessThan(t.indexOf('## Datos sensibles'))
    expect(t).toContain('`semilla-v1` › `docs/semilla/registro.md`')
    expect(t).toMatch(/## Stack\n\n- \*\*Sin Biome\.\*\* Por algo\.\n$/)
    expect(t).not.toContain('Intro vieja')
    expect(t.match(/^# /gm)).toHaveLength(1)
  })

  it('PENDIENTES: los riesgos con sus IDs (o [—]), las decisiones de los PR con [#n] y las secciones previas', () => {
    expect(seccion(COMUN, 'riesgos y SUPUESTOS')).not.toContain('no va')
    expect(idsDe('algo (C2, C3) y (F1.2) pero no G1')).toEqual(['C2', 'C3', 'F1.2'])
    const riesgos = riesgosDeLaSemilla(COMUN, SEMILLA)
    expect(riesgos).toEqual([
      { ids: ['G1'], texto: 'Supuesto: Resend en su plan gratis (G1). Si se pasa, se avisa.' },
      { ids: ['F1'], texto: 'Riesgo: dos clientes a la vez (F1).' },
      { ids: ['F1'], texto: 'Choque de reservas resuelto en la RPC (F1).' },
      { ids: [], texto: 'Supuesto: una sola zona horaria.' },
    ])
    const decisiones = decisionesDePrs([PR, { number: 11, title: 'x', body: 'sin la sección' }])
    expect(decisiones.map((d) => d.texto)).toEqual([
      'La semana empieza el lunes.',
      'Sin vista mensual.',
    ])
    const t = textoPendientes({
      riesgos,
      decisiones,
      existente: '# Pendientes\n\nIntro.\n\n## Pulido de interfaz\n\n- **[—]** El foco.\n',
    })
    expect(t).toContain('- **[G1]** Supuesto: Resend')
    expect(t).toContain('- **[—]** Supuesto: una sola zona horaria.')
    expect(t).toContain('- **[#10]** La semana empieza el lunes. — feat(agenda): la agenda del día')
    expect(t).toMatch(/## Pulido de interfaz\n\n- \*\*\[—\]\*\* El foco\.\n$/)
    expect(textoPendientes({ riesgos: [], decisiones: [] })).toContain(
      '- Ningún PR integrado trae decisiones tomadas sin preguntar.',
    )
  })

  it('lo que escriben los docs no cambia al pasar por Prettier (lefthook los formatea al commitear)', async () => {
    const { plugins: _plugins, ...config } = JSON.parse(
      readFileSync('.prettierrc', 'utf8'),
    ) as Record<string, unknown>
    const docs = [
      textoDecisiones({ registro: REGISTRO, etiqueta: 'semilla-v1' }),
      textoPendientes({
        riesgos: riesgosDeLaSemilla(COMUN, SEMILLA),
        decisiones: decisionesDePrs([PR]),
      }),
      textoEstado({ fecha: '2026-11-17', etiqueta: 'semilla-v1', modulos: ['agenda', 'equipo'] }),
      leccionesConSemillas('# Lecciones\n\nIntro.\n\n## Vitest\n\n- Haz algo.\n'),
    ]
    for (const d of docs) expect(await format(d, { ...config, parser: 'markdown' })).toBe(d)
    expect(leccionesConSemillas(docs[3]!)).toBe(docs[3])
  })
})

const issue = (n: number, yaml: string, labels: string[], body = '') => ({
  number: n,
  title: `issue ${n}`,
  body: `\`\`\`yaml\ntitulo: tarea ${n}\nrama: feat/t${n}\n${yaml}\`\`\`\n\n## Decisiones ya tomadas\n\n- Algo.\n${body}`,
  labels: labels.map((name) => ({ name })),
})
const bot = (texto: string) => ({ body: `🤖 orquestador: ${texto}` })

const tareas = [
  datosDeIssue(issue(1, 'paso: P01\n', ['cola', 'cola:integrada']), []),
  datosDeIssue(
    issue(
      2,
      'paso: P02\n',
      ['cola', 'cola:integrada'],
      '- Respuesta de la persona (2026-11-10): usa 30 min.\n',
    ),
    [
      bot('empiezo la tarea'),
      bot('me trabé: falta la duración del turno\n\nResponde en un comentario…'),
      bot('retomo la tarea: x'),
      bot('retomo la tarea: y'),
    ],
  ),
  datosDeIssue(issue(3, 'paso: P03\n', ['cola', 'cola:omitida']), []),
  datosDeIssue(issue(4, '', ['cola', 'cola:integrada']), []),
  datosDeIssue(issue(5, '', ['cola', 'deps', 'cola:integrada']), []),
  datosDeIssue(issue(6, 'paso: cierre\n', ['cola']), []),
]
describe('cierre › retro y comprobar', () => {
  it('la retro con datos trae las tres secciones por clasificar; la vacía, las tres líneas «Ningun…»', () => {
    const r = borradorRetro({ tareas, decisiones: decisionesDePrs([PR]) })
    expect(r).toContain(
      '- T2 (P02) «tarea 2»: falta la duración del turno · respuesta: usa 30 min. → «clasificar',
    )
    expect(r).toContain('- #10 La semana empieza el lunes. → «clasificar')
    expect(r).toContain('- T3 (P03) «tarea 3»: se omitió → «clasificar')
    expect(r).toContain('- T2 (P02) «tarea 2»: 2 retomas → «clasificar')
    expect(r).toContain('- T4 «tarea 4»: no estaba en el plan → «clasificar')
    expect(r).not.toContain('T5')
    expect(r).not.toContain('T6')
    const vacia = borradorRetro({ tareas: [], decisiones: [] })
    for (const l of [
      'Ninguna tarea se trabó.',
      'Ningún PR integrado trae',
      'Ninguno: cada paso se hizo una vez',
    ])
      expect(vacia).toContain(l)
    expect(pasosSinTerminar(tareas)).toEqual([])
    expect(
      pasosSinTerminar([datosDeIssue(issue(7, 'paso: P04\n', ['cola', 'cola:trabada']), [])]),
    ).toHaveLength(1)
  })

  it('problemasDelCierre nombra cada problema y da [] cuando todo está', () => {
    const bien = {
      archivos: Object.fromEntries(
        ['ESTADO', 'PENDIENTES', 'DECISIONES', 'LECCIONES', 'FLUJO'].map((d) => [
          `docs/${d}.md`,
          `# ${d}\n`,
        ]),
      ) as Record<string, string | null>,
      semillaPresente: false,
      repo: { etapa: 'mantenimiento', semilla: 'semilla-v1' },
      etiqueta: 'semilla-v1',
      cuerpo: borradorRetro({ tareas, decisiones: [] }).replace(
        /«clasificar[^»]*»/g,
        'hueco de la semilla',
      ),
    }
    expect(problemasDelCierre(bien)).toEqual([])
    const mal = problemasDelCierre({
      ...bien,
      archivos: {
        ...bien.archivos,
        'docs/FLUJO.md': null,
        'docs/ESTADO.md': `${'x\n'.repeat(60)}«completar: algo»\n`,
      },
      semillaPresente: true,
      repo: { etapa: 'construccion', semilla: null },
      cuerpo: borradorRetro({ tareas, decisiones: [] }).replace(
        '«clasificar: hueco de la semilla / defecto del kit / otro»',
        'otro',
      ),
    })
    expect(mal).toEqual([
      'queda «completar» en docs/ESTADO.md',
      'falta docs/FLUJO.md',
      'docs/ESTADO.md tiene 61 líneas (máximo 60)',
      'docs/semilla/ sigue en el repo (cierre.mjs aplicar la saca)',
      'el repo no está en «etapa: mantenimiento» con «semilla: semilla-v1» en .proyecto/proyecto.yaml',
      'queda «clasificar» en la retro',
      'la retro tiene 3 líneas sin clase (hueco de la semilla / defecto del kit / otro)',
    ])
    expect(problemasDelCierre({ ...bien, cuerpo: 'sin retro' })).toEqual([
      'el cuerpo del PR no trae la sección «## Retro»',
    ])
  })
})

describe('cierre › manifiesto', () => {
  it('el manifiesto cambia sólo la etapa y la semilla del repo, y conserva lo demás byte a byte', () => {
    const m = `# comentario\nesquema: proyecto/v1\nproyecto: tienda\nnombre: Tienda\nsemilla: null\nrepos:\n  - rol: app # el panel\n    nombre: tienda-app\n    github: C/tienda-app\n    etapa: construccion\n    semilla: null\n    puertos: { bloque: 5 }\ncontratos: []\n`
    expect(manifiestoEnMantenimiento(m, 'app', 'semilla-v2')).toBe(
      m
        .replace('etapa: construccion', 'etapa: mantenimiento')
        .replace('    semilla: null', '    semilla: semilla-v2'),
    )
    expect(() => manifiestoEnMantenimiento(m, 'web', 'semilla-v2')).toThrow(/el repo «web» no está/)
  })
})
