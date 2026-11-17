// La semilla v2 de idea-a-semilla vista desde el kit: leerla, validarla con el validador de verdad y sacar lo que el generador y la
// cola necesitan (secciones, registro, pantallas, CSS). El formato y sus reglas son los de scripts/semilla/validar_semilla.py:
//
//   comun.md                  lo común (frontmatter semilla-proyecto/v2: slug, nombre, repos, contratos)
//   repos/<rol>/semilla.md    cada repo en construcción (frontmatter semilla-repo/v2)
//   repos/<rol>/plan.yaml     sus pasos (plan/v2)
//   registro.md               las decisiones (ID | tema | decisión | estado | fuente)
//   ESTADO.md                 lo lleva idea-a-semilla (la auditoría independiente)
//
// Todo es puro salvo `leerSemillaV2` y `validarSemilla`, que leen archivos y corren python3. Se prueba en `semilla.test.mjs`.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
import { exigir, Problema } from './problema.mjs'

export const VALIDADOR = resolve(import.meta.dirname, '../semilla/validar_semilla.py')

/** El frontmatter YAML de un .md. Puro. */
export function frontmatter(texto, donde) {
  const m = /^---\n([\s\S]*?)\n---/.exec(texto)
  exigir(m, `${donde} no empieza con frontmatter YAML`)
  return parse(m[1] ?? '') ?? {}
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** El cuerpo de la sección `## [n.] <titulo>` (título exacto, como el validador) hasta la siguiente `## `, o null. Puro. */
export function seccion(texto, titulo) {
  const lineas = texto.split('\n')
  const re = new RegExp(`^##\\s+(\\d+\\.\\s*)?${escapar(titulo)}\\s*$`)
  const i = lineas.findIndex((l) => re.test(l))
  if (i < 0) return null
  const j = lineas.findIndex((l, k) => k > i && l.startsWith('## '))
  return lineas
    .slice(i + 1, j < 0 ? undefined : j)
    .join('\n')
    .trim()
}

/** El registro: id → { tema, decision, estado }. Puro. */
export function leerRegistro(texto) {
  const registro = new Map()
  for (const linea of texto.split('\n')) {
    const celdas = linea
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim())
    if (celdas.length >= 4 && /^[A-Z]{1,3}\d+(?:\.\d+)?$/.test(celdas[0] ?? ''))
      registro.set(celdas[0], { tema: celdas[1], decision: celdas[2], estado: celdas[3] })
  }
  return registro
}

/** Las filas de la primera tabla markdown de un texto, como objetos por el nombre de cada columna (en minúscula). Puro. */
function tabla(texto) {
  const filas = texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'))
  const celdas = (l) =>
    l
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim())
  const [cabecera, separador, ...resto] = filas
  if (!cabecera || !separador || !/^\|[\s:|-]+\|$/.test(separador)) return []
  const nombres = celdas(cabecera).map((c) => c.toLowerCase())
  return resto.map((l) => Object.fromEntries(celdas(l).map((c, i) => [nombres[i] ?? `${i}`, c])))
}

/**
 * Las pantallas de «Experiencia»: { pantalla, ruta, rol, estados }. La ruta va sin comillas invertidas; «igual» en los estados copia
 * los de la fila anterior. La columna Rol es opcional (la web pública no la tiene). Puro.
 */
export function pantallasDe(experiencia) {
  let anteriores = ''
  return tabla(experiencia ?? '').map((f) => {
    const estados = /^igual\.?$/i.test(f.estados ?? '') ? anteriores : (f.estados ?? '')
    anteriores = estados
    return {
      pantalla: f.pantalla ?? '',
      ruta: (f.ruta ?? '').replace(/`/g, ''),
      rol: f.rol ?? '',
      estados,
    }
  })
}

/** Los términos del glosario (`- **Término:** …`). Puro. */
export const terminosDe = (glosario) =>
  (glosario ?? '').split('\n').filter((l) => /^\s*[-*]\s+\*\*/.test(l)).length

/** El bloque ```css con `:root` de «Marca y sistema de diseño» de comun.md. Puro. */
export function cssDeLaSemilla(comun) {
  const sec = seccion(comun, 'Marca y sistema de diseño')
  exigir(sec, 'comun.md no tiene la sección «Marca y sistema de diseño»')
  const css = [...sec.matchAll(/```css\n([\s\S]*?)```/g)]
    .map((m) => m[1] ?? '')
    .find((b) => /:root\s*\{/.test(b))
  exigir(css, '«Marca y sistema de diseño» no trae un bloque ```css con `:root { … }`')
  return css.trim()
}

const nombresDe = (css) => new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
/** El bloque `selector { … }` de un CSS, o null. Puro. */
export function bloqueDe(css, selector) {
  const i = css.search(new RegExp(`^${escapar(selector)}\\s*\\{`, 'm'))
  if (i < 0) return null
  return css.slice(i, css.indexOf('}', i) + 1)
}
/** El valor de una variable CSS dentro de un bloque. Puro. */
export const valorDe = (bloque, nombre) =>
  new RegExp(`${escapar(nombre)}:\\s*([^;]+);`).exec(bloque ?? '')?.[1]?.trim()

/** Que el CSS de la semilla cumpla el contrato de nombres del kit (los de design/tokens.css) y tenga `.dark`. Puro. */
export function problemasDelCss(cssSemilla, cssKit) {
  const p = []
  const faltan = [...nombresDe(cssKit)].filter((n) => !nombresDe(cssSemilla).has(n))
  if (faltan.length)
    p.push(`al sistema de diseño le faltan tokens del contrato del kit: ${faltan.join(', ')}`)
  if (!bloqueDe(cssSemilla, '.dark'))
    p.push('el sistema de diseño no trae el tema oscuro como `.dark { … }`')
  for (const [sel, n] of [
    [':root', '--color-primario'],
    [':root', '--color-paper'],
    ['.dark', '--color-paper'],
  ])
    if (!valorDe(bloqueDe(cssSemilla, sel), n)) p.push(`falta ${n} en \`${sel}\``)
  return p
}

const TAMANOS_CON_AUDITORIA = ['mediano', 'grande', 'escala']

/**
 * El tamaño que pide la auditoría independiente y no la tiene (la tabla de idea-a-semilla: de mediano para arriba), o null. La
 * auditoría está hecha si `semilla/ESTADO.md` dice «auditoría independiente: hecha». Puro.
 * @param {string | null} estadoMd  @param {string[]} tamanos  los de los repos en construcción
 */
export function faltaAuditoria(estadoMd, tamanos) {
  const t = tamanos.find((x) => TAMANOS_CON_AUDITORIA.includes(x))
  if (!t) return null
  return /auditor[ií]a independiente:\s*hecha/i.test(estadoMd ?? '') ? null : t
}

/**
 * La semilla v2 de una carpeta: comun (texto y frontmatter), el registro, ESTADO.md y cada repo en construcción (texto, frontmatter
 * y plan). Lee archivos; no valida (eso es `validarSemilla`).
 */
export function leerSemillaV2(dir) {
  const leer = (f) => readFileSync(join(dir, f), 'utf8')
  const comunTexto = leer('comun.md')
  const comun = { texto: comunTexto, fm: frontmatter(comunTexto, 'comun.md') }
  const repos = {}
  for (const r of comun.fm.repos ?? []) {
    if (r.etapa !== 'construccion') continue
    const texto = leer(`repos/${r.rol}/semilla.md`)
    repos[r.rol] = {
      texto,
      fm: frontmatter(texto, `repos/${r.rol}/semilla.md`),
      plan: parse(leer(`repos/${r.rol}/plan.yaml`)) ?? {},
    }
  }
  return {
    dir,
    comun,
    registroTexto: leer('registro.md'),
    registro: leerRegistro(leer('registro.md')),
    estado: existsSync(join(dir, 'ESTADO.md')) ? leer('ESTADO.md') : null,
    repos,
  }
}

/**
 * Corre el validador de verdad sobre la carpeta. Si da errores, o deja marcas «verificar» (que el validador sólo avisa), lanza
 * `Problema` con su salida tal cual: el arreglo va en idea-a-semilla, nunca en la semilla a mano.
 */
export function validarSemilla(dir) {
  const v = spawnSync('python3', [VALIDADOR, dir], { encoding: 'utf8' })
  const salida = `${v.stdout ?? ''}${v.stderr ?? ''}`.trim()
  if (v.error)
    throw new Problema(`no pude correr python3 (${v.error.message}): hace falta con PyYAML`)
  if (v.status !== 0)
    throw new Problema(
      `la semilla no pasa el validador:\n${salida}\nEl arreglo va en idea-a-semilla, no en la semilla a mano.`,
    )
  const marcas = salida.split('\n').filter((l) => l.includes('marcas «verificar»'))
  if (marcas.length)
    throw new Problema(`cierra las marcas «verificar» en idea-a-semilla:\n${marcas.join('\n')}`)
  return salida
}
