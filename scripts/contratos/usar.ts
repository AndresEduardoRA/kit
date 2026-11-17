// `pnpm contrato:usar`: con el compilador de TypeScript, cada llamada de `src/**/infra/**` a un esquema de una copia fijada
// (`.schema('<esquema>').rpc('<rpc>', { … })` o `.schema('<esquema>').from('<vista>')`) está en la copia, con los mismos nombres de
// parámetros y los obligatorios presentes. Las llamadas van encadenadas y con literales: lo dinámico no se puede revisar y es error.
// Un `.rpc('x')` suelto (o con `.schema('public')`) es de la base propia: lo cubre `typecheck` contra `database.types.ts`; sólo se le
// exige el nombre literal. No revisa las columnas de un `.select('…')`. Puro, salvo `archivosDeInfra`.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import type { Contrato, Rpc } from './esquemas'

type Revision = {
  archivo: string
  sf: ts.SourceFile
  copias: ReadonlyMap<string, Contrato>
  problemas: string[]
}

const literalDe = (n: ts.Node | undefined): string | null =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null

const llamadaA = (
  n: ts.Node,
  metodo: string,
): n is ts.CallExpression & { expression: ts.PropertyAccessExpression } =>
  ts.isCallExpression(n) &&
  ts.isPropertyAccessExpression(n.expression) &&
  n.expression.name.text === metodo

function decir(r: Revision, n: ts.Node, texto: string): void {
  const linea = r.sf.getLineAndCharacterOfPosition(n.getStart(r.sf)).line + 1
  r.problemas.push(`${r.archivo}:${String(linea)}: ${texto}`)
}

// El esquema al que apunta el receptor de un `.rpc`/`.from`: el literal de un `.schema('x')` encadenado, o null (la base propia).
function esquemaDelReceptor(
  llamada: ts.CallExpression & { expression: ts.PropertyAccessExpression },
): string | null {
  const receptor = llamada.expression.expression
  return llamadaA(receptor, 'schema') ? literalDe(receptor.arguments[0]) : null
}

// Las claves de un objeto literal de parámetros, o null si no se pueden leer (una variable, un spread, una clave calculada).
function clavesDe(n: ts.Expression | undefined): string[] | null {
  if (!n) return []
  if (!ts.isObjectLiteralExpression(n)) return null
  const claves: string[] = []
  for (const p of n.properties) {
    if (!(ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p))) return null
    const nombre = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null
    if (nombre === null) return null
    claves.push(nombre)
  }
  return claves
}

function revisarParametros(r: Revision, n: ts.CallExpression, rpc: Rpc, en: string): void {
  const claves = clavesDe(n.arguments[1])
  if (claves === null)
    return decir(
      r,
      n,
      `los parámetros de \`${en}\` no van como objeto literal con claves escritas: \`contrato:usar\` no puede revisarlos.`,
    )
  const tiene = rpc.parametros.map((p) => p.nombre)
  for (const k of claves.filter((k) => !tiene.includes(k)))
    decir(
      r,
      n,
      `\`${en}\` no tiene el parámetro \`${k}\` (tiene: ${tiene.join(', ') || 'ninguno'})`,
    )
  for (const p of rpc.parametros.filter((p) => !p.conDefault && !claves.includes(p.nombre)))
    decir(r, n, `\`${en}\`: falta el parámetro obligatorio \`${p.nombre}\``)
}

function revisarRpc(
  r: Revision,
  n: ts.CallExpression & { expression: ts.PropertyAccessExpression },
): void {
  const nombre = literalDe(n.arguments[0])
  if (nombre === null)
    return decir(
      r,
      n,
      '`.rpc(…)` con un nombre que no es literal: escríbelo entre comillas para que `contrato:usar` pueda revisarlo.',
    )
  const esquema = esquemaDelReceptor(n)
  const copia = esquema === null ? undefined : r.copias.get(esquema)
  if (!copia) return
  const en = `${copia.esquema}.${nombre}`
  const rpc = copia.rpc.find((x) => x.nombre === nombre)
  if (!rpc) return decir(r, n, `\`${en}\` no está en ${copia.contrato}@${String(copia.version)}`)
  revisarParametros(r, n, rpc, en)
}

function revisarFrom(
  r: Revision,
  n: ts.CallExpression & { expression: ts.PropertyAccessExpression },
): void {
  const esquema = esquemaDelReceptor(n)
  const copia = esquema === null ? undefined : r.copias.get(esquema)
  if (!copia) return
  const nombre = literalDe(n.arguments[0])
  if (nombre === null)
    return decir(
      r,
      n,
      '`.from(…)` con un nombre que no es literal: escríbelo entre comillas para que `contrato:usar` pueda revisarlo.',
    )
  if (!copia.vistas.some((v) => v.nombre === nombre))
    decir(
      r,
      n,
      `\`${copia.esquema}.${nombre}\` no está en ${copia.contrato}@${String(copia.version)}`,
    )
}

function revisarSchema(r: Revision, n: ts.CallExpression): void {
  const esquema = literalDe(n.arguments[0])
  if (esquema === null)
    return decir(
      r,
      n,
      '`.schema(…)` con un nombre que no es literal: escríbelo entre comillas para que `contrato:usar` pueda revisarlo.',
    )
  if (esquema === 'public') return
  if (!r.copias.has(esquema))
    return decir(
      r,
      n,
      `\`.schema('${esquema}')\` no es de ninguna copia fijada (esquemas fijados: ${[...r.copias.keys()].join(', ')}).`,
    )
  const acceso = n.parent
  const encadenado =
    ts.isPropertyAccessExpression(acceso) &&
    ['rpc', 'from'].includes(acceso.name.text) &&
    ts.isCallExpression(acceso.parent) &&
    acceso.parent.expression === acceso
  if (!encadenado)
    decir(
      r,
      n,
      `\`.schema('${esquema}')\` va encadenado a \`.rpc(…)\` o \`.from(…)\` en la misma expresión, para que \`contrato:usar\` pueda revisarlo.`,
    )
}

function visitar(r: Revision, n: ts.Node): void {
  if (llamadaA(n, 'rpc')) revisarRpc(r, n)
  else if (llamadaA(n, 'from')) revisarFrom(r, n)
  else if (llamadaA(n, 'schema')) revisarSchema(r, n)
  ts.forEachChild(n, (hijo) => visitar(r, hijo))
}

/** Lo que una fuente de `infra/` usa de las copias fijadas y no está en ellas, `archivo:línea: …`. Puro. */
export function problemasDeUso(
  archivo: string,
  texto: string,
  copias: readonly Contrato[],
): string[] {
  const sf = ts.createSourceFile(
    archivo,
    texto,
    ts.ScriptTarget.Latest,
    true,
    archivo.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const r: Revision = {
    archivo,
    sf,
    copias: new Map(copias.map((c) => [c.esquema, c])),
    problemas: [],
  }
  visitar(r, sf)
  return r.problemas
}

/** Las fuentes de `src/**\/infra/**` (sin pruebas), relativas a `raiz` y en orden. */
export function archivosDeInfra(raiz: string): string[] {
  const src = join(raiz, 'src')
  if (!existsSync(src)) return []
  return readdirSync(src, { recursive: true, encoding: 'utf8' })
    .map((a) => `src/${a.split('\\').join('/')}`)
    .filter((a) => /^src\/(?:.+\/)?infra\/.+\.tsx?$/.test(a) && !/\.(test|spec)\.tsx?$/.test(a))
    .sort()
}
