import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  agregarDecision,
  archivoDeIssue,
  canonDeArchivo,
  issueDeArchivo,
  PERMISOS,
  SpecRota,
  temaDeRama,
} from './spec-issue.mjs'

// Una spec como las de ../tareas: con `id: K06` (que no es un id de la cola) y una dependencia por rama del kit.
const K06 = `---
id: K06
titulo: repartir el límite entre orquestadores y rutear por nivel de modelo
rama: feat/turnos-y-niveles
depende: kit:feat/cola-en-issues
conflicto: orquestador
planificar: si
modelo: opus
effort: high
---

## Pedido de la persona

«Dos orquestadores se reparten el límite del plan a mano.»

## Decisiones ya tomadas

- **Turnos por máquina:** con flock.

## Verificación

pnpm test.
`

test('una spec de ../tareas va al issue sin id, con su origen, y vuelve igual con el número del issue', () => {
  const i = issueDeArchivo(K06)
  assert.equal(i.titulo, 'repartir el límite entre orquestadores y rutear por nivel de modelo')
  assert.equal(i.rama, 'feat/turnos-y-niveles')
  assert.equal(i.borrador, false)
  assert.match(i.cuerpo, /^```yaml\ntitulo: repartir/)
  assert.match(i.cuerpo, /\ndepende: kit:feat\/cola-en-issues\n/)
  assert.match(i.cuerpo, /\norigen: K06\n```\n\n## Pedido de la persona\n/)
  assert.doesNotMatch(i.cuerpo, /\nid:/)
  const archivo = archivoDeIssue({ number: 6, title: i.titulo, body: i.cuerpo, labels: [] })
  assert.equal(archivo, canonDeArchivo(K06, 'T6'))
  assert.match(archivo, /^---\nid: T6\ntitulo: repartir/)
  assert.match(archivo, /\norigen: K06\n---\n\n## Pedido de la persona\n/)
})

test('borrador y urgente son etiquetas en el issue y líneas del frontmatter en el archivo', () => {
  const conBanderas = K06.replace('effort: high\n', 'effort: high\nborrador: si\nurgente: si\n')
  const i = issueDeArchivo(conBanderas)
  assert.equal(i.borrador, true)
  assert.equal(i.urgente, true)
  assert.doesNotMatch(i.cuerpo, /borrador|urgente/)
  const sinEtiquetas = archivoDeIssue({ number: 6, body: i.cuerpo, labels: [] })
  assert.doesNotMatch(sinEtiquetas, /borrador/)
  const conEtiquetas = archivoDeIssue({
    number: 6,
    body: i.cuerpo,
    labels: [{ name: 'cola' }, { name: 'cola:borrador' }, { name: 'cola:urgente' }],
  })
  assert.equal(conEtiquetas, canonDeArchivo(conBanderas, 'T6'))
})

test('el canónico no cambia con espacios ni con campos vacíos, y conserva un id T<n>', () => {
  const desprolijo = `---\nid: T9\n# un comentario\ntitulo:  algo  \nrama: fix/algo\ndepende:\n---\n\n\n## Objetivo\n\nx\n\n\n`
  assert.equal(
    canonDeArchivo(desprolijo),
    '---\nid: T9\ntitulo: algo\nrama: fix/algo\n---\n\n## Objetivo\n\nx\n',
  )
})

test('un issue cargado desde el celular: título del issue, valores que no son texto y comillas', () => {
  const body =
    '```yaml\nrama: feat/desde-el-celular\nplanificar: true\ndepende: [T3, T5]\nnota: "a: b"\n```\n## Objetivo\n\nque ande\n'
  const a = archivoDeIssue({ number: 12, title: ' Cargar desde el celular ', body, labels: [] })
  assert.equal(
    a,
    '---\nid: T12\ntitulo: Cargar desde el celular\nrama: feat/desde-el-celular\nplanificar: si\ndepende: T3 T5\nnota: a: b\n---\n\n## Objetivo\n\nque ande\n',
  )
  // Un valor con «: » vuelve al issue entre comillas: el yaml sigue siendo válido.
  assert.match(issueDeArchivo(a).cuerpo, /\nnota: "?a: b"?\n/)
  assert.equal(archivoDeIssue({ number: 12, body: issueDeArchivo(a).cuerpo }), a)
})

test('un bloque yaml roto dice qué está mal', () => {
  const roto =
    (body, title = '') =>
    () =>
      archivoDeIssue({ number: 1, title, body })
  assert.throws(roto('## Objetivo\n'), /no empieza con un bloque ```yaml/)
  assert.throws(roto('```yaml\nrama: [feat/x\n```\n'), /el yaml no se puede leer/)
  assert.throws(roto('```yaml\n- uno\n```\n'), /no es una lista de «clave: valor»/)
  assert.throws(roto('```yaml\ntitulo: x\n```\n'), /falta «rama»/)
  assert.throws(roto('```yaml\nrama: feat/x\n```\n'), /falta «titulo»/)
  assert.throws(roto('```yaml\ntitulo: x\nrama: Feat X\n```\n'), /no es <tipo>\/<tema>/)
  assert.throws(roto('```yaml\ntitulo: x\nrama: feat/x\nmas: {a: 1}\n```\n'), /no es un texto/)
  assert.throws(roto('```yaml\nrama: feat/x\n```\n'), SpecRota)
  assert.doesNotThrow(roto('```yaml\nrama: feat/x\n```\n', 'con título del issue'))
})

test('la respuesta de la persona va al final de «Decisiones ya tomadas», o a una sección nueva', () => {
  const cuerpo = issueDeArchivo(K06).cuerpo
  const con = agregarDecision(cuerpo, '2026-11-16', 'Usa tres turnos.\nY nada más.')
  assert.match(
    con,
    /- \*\*Turnos por máquina:\*\* con flock\.\n- Respuesta de la persona \(2026-11-16\): Usa tres turnos\. Y nada más\.\n\n## Verificación/,
  )
  const sin = agregarDecision(
    '```yaml\ntitulo: x\nrama: feat/x\n```\n\n## Objetivo\n\ny\n',
    '2026-11-16',
    'sí',
  )
  assert.match(
    sin,
    /## Objetivo\n\ny\n\n## Decisiones ya tomadas\n\n- Respuesta de la persona \(2026-11-16\): sí\n$/,
  )
})

test('el tema sale de la rama sin el tipo', () => {
  assert.equal(temaDeRama('feat/cola-en-issues'), 'cola-en-issues')
  assert.equal(temaDeRama('fix/a/b_c'), 'a-b-c')
})

test('los campos de modelo: un nivel o un alias pasan; una versión fija o un nivel desconocido dejan la spec rota', () => {
  // Armada en tiempo de ejecución: escrita tal cual, la guarda de versiones (scripts/guardas) marcaría este archivo.
  const version = ['claude', 'opus', '4', '1'].join('-')
  const archivo = (extra) => `---\ntitulo: x\nrama: feat/x\n${extra}\n---\n`
  const issue = (extra) => () =>
    archivoDeIssue({ number: 3, body: `\`\`\`yaml\ntitulo: x\nrama: feat/x\n${extra}\n\`\`\`\n` })
  assert.throws(
    () => canonDeArchivo(archivo(`modelo: ${version}`)),
    /es una versión fija de modelo/,
  )
  assert.throws(issue(`modelo: ${version}`), /es una versión fija de modelo/)
  assert.throws(issue('nivel: turbo'), /«nivel: turbo» no es rapido, normal ni capaz/)
  assert.throws(
    () => canonDeArchivo(archivo('modelo_plan: Opus')),
    /«modelo_plan: Opus» no es un alias/,
  )
  // Una versión fija es error aunque venga un nivel que la pisaría.
  assert.throws(issue(`nivel: capaz\nmodelo: ${version}`), SpecRota)
  assert.doesNotThrow(issue('nivel: capaz'))
  assert.doesNotThrow(issue('modelo: opus'))
  assert.doesNotThrow(() => canonDeArchivo(archivo('modelo: sonnet[1m]\nnivel_plan: rapido')))
})

test('«permite»: sólo los permisos conocidos (dependencias); otra palabra deja la spec rota', () => {
  const issue = (extra) => () =>
    archivoDeIssue({ number: 3, body: `\`\`\`yaml\ntitulo: x\nrama: feat/x\n${extra}\n\`\`\`\n` })
  assert.deepEqual(PERMISOS, ['dependencias'])
  assert.match(issue('permite: dependencias')(), /\npermite: dependencias\n/)
  assert.match(issue('permite: [dependencias]')(), /\npermite: dependencias\n/)
  assert.throws(
    issue('permite: todo'),
    /«permite: todo» no es un permiso conocido \(dependencias\)/,
  )
  assert.throws(issue('permite: dependencias red'), /«permite: red» no es un permiso conocido/)
  assert.throws(
    () => canonDeArchivo('---\ntitulo: x\nrama: feat/x\npermite: sudo\n---\n'),
    SpecRota,
  )
})
