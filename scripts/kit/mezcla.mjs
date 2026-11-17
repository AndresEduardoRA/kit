// La mezcla de tres vías del flujo (docs/KIT.md › «El flujo entre el kit y los proyectos»): qué pasa con cada archivo de flujo cuando
// un proyecto trae la versión nueva del kit. base = el kit en `.kit/version`, nuevo = el kit en main, los dos personalizados para el
// repo (personalizar.mjs); propio = el del repo. `decidir` es pura; `mezclar3` corre `git merge-file -p` sobre copias temporales.
// Viaja a cada proyecto. Se prueba en `mezcla.test.ts` y `actualizar.test.ts`.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { coincide } from './flujo.mjs'
import { MARCADORES, personalizar, seRevisa, SinBloque } from './personalizar.mjs'

// Las dos partes suman viñetas al final de la misma sección: sin union, cada actualización chocaría.
const CON_UNION = 'docs/LECCIONES.md'

/**
 * La mezcla de tres vías de git, sin tocar ningún archivo del repo. `choques` es el número de choques (uno si git falló).
 * @param {{ propio: string | Buffer, base: string | Buffer, nuevo: string | Buffer, union?: boolean }} e
 * @returns {{ texto: string, choques: number }}
 */
export function mezclar3({ propio, base, nuevo, union = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'mezcla-'))
  try {
    const [o, b, n] = /** @type {const} */ ([
      ['propio', propio],
      ['base', base],
      ['kit', nuevo],
    ]).map(([nombre, contenido]) => {
      const f = join(dir, nombre)
      writeFileSync(f, contenido)
      return f
    })
    const r = spawnSync(
      'git',
      [
        'merge-file',
        '-p',
        ...(union ? ['--union'] : []),
        '-L',
        'propio',
        '-L',
        'base',
        '-L',
        'kit',
      ].concat([o ?? '', b ?? '', n ?? '']),
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    // El código de salida es el número de choques (hasta 127); negativo (≥ 128 visto desde aquí) si git falló.
    const choques = r.status !== null && r.status >= 0 && r.status < 128 ? r.status : 1
    return { texto: r.stdout ?? '', choques }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Sin las lecciones `… (kit)` del proyecto que el kit ya absorbió: la misma línea, hasta el paréntesis final, con otro sufijo
 * (`(<repo>, PR #<n>)`). Puro.
 * @param {string} md
 */
export function quitarRepetidas(md) {
  const deKit = (l) => /^\s*- .*\(kit\)\s*$/.test(l)
  const clave = (l) => l.replace(/\s*\([^()]*\)\s*$/, '').trim()
  const lineas = md.split('\n')
  const otras = new Set(lineas.filter((l) => /^\s*- .*\)\s*$/.test(l) && !deKit(l)).map(clave))
  return lineas.filter((l) => !(deKit(l) && otras.has(clave(l)))).join('\n')
}

/** @typedef {{ contenido: Buffer, modo: number }} Archivo */
/**
 * @typedef {{ accion: 'nada' | 'escribir' | 'borrar' | 'choque', como: string, contenido?: Buffer, modo?: number,
 *   motivo?: string }} Decision
 */

const esBinario = (/** @type {Buffer} */ b) => b.includes(0)

/**
 * Un archivo del kit personalizado para el repo (lo binario, igual). Lanza `SinBloque` si lleva puertos y el repo no tiene bloque.
 * @param {string} ruta  @param {Archivo | null} a  @param {Parameters<typeof personalizar>[2]} valores
 * @returns {Archivo | null}
 */
function personalizado(ruta, a, valores) {
  if (!a || esBinario(a.contenido)) return a
  return {
    contenido: Buffer.from(personalizar(ruta, a.contenido.toString('utf8'), valores)),
    modo: a.modo,
  }
}

/** @param {Archivo | null} x  @param {Archivo | null} y */
const igual = (x, y) => !!x && !!y && x.contenido.equals(y.contenido)
/** @param {Archivo} n  @param {string} como  @returns {Decision} */
const escribir = (n, como) => ({ accion: 'escribir', como, contenido: n.contenido, modo: n.modo })
/** @param {string} motivo  @returns {Decision} */
const choque = (motivo) => ({ accion: 'choque', como: 'choque', motivo })
/** @param {string} como  @returns {Decision} */
const nada = (como) => ({ accion: 'nada', como })

/**
 * Lo que pasa con un archivo de flujo (docs/KIT.md › «El flujo entre el kit y los proyectos», la tabla de `decidir`). Pura salvo
 * `mezclar3`, que corre git sobre copias temporales.
 * @param {{ ruta: string, base: Archivo | null, nuevo: Archivo | null, propio: Archivo | null,
 *   valores: Parameters<typeof personalizar>[2], omitir?: string[], tomarKit?: string[], dejar?: string[] }} e
 * @returns {Decision}
 */
export function decidir({
  ruta,
  base,
  nuevo,
  propio,
  valores,
  omitir = [],
  tomarKit = [],
  dejar = [],
}) {
  if (omitir.some((p) => coincide(ruta, p))) return nada('omitido')
  // «La del repo, esta vez» responde cualquier choque, también los de abajo.
  if (dejar.includes(ruta)) return nada('dejado')
  const sinSalida = ' (--tomar-kit no sirve aquí: --dejar o .kit/omitir)'
  let b, n
  try {
    b = personalizado(ruta, base, valores)
    n = personalizado(ruta, nuevo, valores)
  } catch (e) {
    if (e instanceof SinBloque) return choque(`${e.message}${sinSalida}`)
    throw e
  }
  if (n && seRevisa(ruta) && !esBinario(n.contenido)) {
    const texto = n.contenido.toString('utf8')
    const suelto = MARCADORES.find((m) => texto.includes(m))
    if (suelto) return choque(`quedaría el marcador ${suelto} en ${ruta}${sinSalida}`)
  }
  if (tomarKit.includes(ruta))
    return n
      ? escribir(n, 'tomado')
      : propio
        ? { accion: 'borrar', como: 'tomado' }
        : nada('tomado')
  return decidirSinRespuesta(ruta, b, n, propio)
}

/**
 * La tabla de `decidir` cuando la persona no respondió nada por esa ruta.
 * @param {string} ruta  @param {Archivo | null} b  @param {Archivo | null} n  @param {Archivo | null} o
 * @returns {Decision}
 */
function decidirSinRespuesta(ruta, b, n, o) {
  if (!n) {
    // El kit lo borró (o nunca lo tuvo).
    if (!o || !b) return nada('igual')
    if (igual(o, b)) return { accion: 'borrar', como: 'borrado' }
    return choque('el kit lo borró y aquí cambió')
  }
  if (!o) return escribir(n, b ? 'restaurado' : 'nuevo')
  if (igual(o, n)) return nada('igual')
  if (!b) return choque('el kit lo creó y aquí ya existe distinto')
  if (igual(b, n)) return nada('igual')
  if (igual(o, b)) return escribir(n, 'traido')
  if (esBinario(o.contenido) || esBinario(b.contenido) || esBinario(n.contenido))
    return choque('es binario y cambió en las dos partes')
  const union = ruta === CON_UNION
  const m = mezclar3({ propio: o.contenido, base: b.contenido, nuevo: n.contenido, union })
  if (m.choques > 0)
    return choque(`${m.choques} ${m.choques === 1 ? 'choque' : 'choques'} al mezclar`)
  const texto = union ? quitarRepetidas(m.texto) : m.texto
  return escribir({ contenido: Buffer.from(texto), modo: n.modo }, 'mezclado')
}
