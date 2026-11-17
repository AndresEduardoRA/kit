// Un pedido desde el celular (scripts/orquestador/README.md › «Un pedido desde el celular»): un issue con la etiqueta `pedido` lo
// redacta como spec una sesión en modo plan (pedidos.sh). Aquí, lo puro de eso: leer el hilo del issue (en qué ronda va, si llegó la
// respuesta, la conversación que recibe la sesión), leer lo que la sesión devolvió (`SPEC:` o `PREGUNTAS:`) y armar el comentario de
// preguntas. Nada guarda estado: las rondas las cuenta el hilo, por la marca oculta de cada comentario de preguntas, así que sobrevive a
// un reinicio o a otra máquina. Todo es puro salvo la CLI de abajo. Se prueba en redaccion.test.mjs.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const MARCA_PREGUNTAS = '<!-- redaccion: preguntas -->'
// GitHub corta un comentario o un cuerpo en 65.536 caracteres.
export const TOPE = 60_000
export const RONDAS_MAX = 2

/**
 * @typedef {{ login?: string, type?: string }} Usuario
 * @typedef {{ id?: number, body?: string | null, created_at?: string, author_association?: string, user?: Usuario | null }} Comentario
 * @typedef {{ number: number, title?: string, body?: string | null }} Issue
 */

/**
 * Un texto con tope: si pasa, quedan el principio y el final, y en el medio cuánto se cortó. Puro.
 * @param {string} texto  @param {number} [tope]
 */
export function recortar(texto, tope = TOPE) {
  if (texto.length <= tope) return texto
  const mitad = Math.floor((tope - 120) / 2)
  const cortado = texto.length - 2 * mitad
  return `${texto.slice(0, mitad)}\n\n… (recortado: ${cortado} caracteres; el texto entero está en el issue) …\n\n${texto.slice(-mitad)}`
}

/**
 * Lo que devolvió la sesión de redacción: la última línea `SPEC:` o `PREGUNTAS:` y todo lo que sigue (sin la valla ```markdown que a
 * veces lo envuelve). Sin ninguna de las dos, o con nada después, `nada`. Puro.
 * @param {string} texto
 * @returns {{ tipo: 'spec' | 'preguntas' | 'nada', texto: string }}
 */
export function salidaDeRedaccion(texto) {
  const lineas = texto.replace(/\r\n/g, '\n').split('\n')
  const cabeza = /^\s*(?:\*\*)?(SPEC|PREGUNTAS):(?:\*\*)?[ \t]*(.*)$/
  let i = lineas.length - 1
  while (i >= 0 && !cabeza.test(lineas[i] ?? '')) i--
  const m = cabeza.exec(lineas[i] ?? '')
  if (!m) return { tipo: 'nada', texto: '' }
  let resto = [m[2] ?? '', ...lineas.slice(i + 1)].join('\n').trim()
  const valla = /^```(?:markdown|md)[ \t]*\n([\s\S]*)\n```\s*$/.exec(resto)
  if (valla) resto = (valla[1] ?? '').trim()
  if (!resto) return { tipo: 'nada', texto: '' }
  return { tipo: m[1] === 'SPEC' ? 'spec' : 'preguntas', texto: resto }
}

/** @param {Comentario} c  @param {string} bot */
const esDelBot = (c, bot) => (c.body ?? '').startsWith(bot)
/** @param {Comentario} c  @param {string} bot */
const esDePreguntas = (c, bot) => esDelBot(c, bot) && (c.body ?? '').includes(MARCA_PREGUNTAS)
/** De una persona con permiso de escritura: ni del orquestador ni de un usuario bot. @param {Comentario} c  @param {string} bot  @param {string[]} conPermiso */
const cuenta = (c, bot, conPermiso) =>
  !esDelBot(c, bot) &&
  (c.user?.type ?? 'User') !== 'Bot' &&
  conPermiso.includes(c.author_association ?? '')

/** El texto de un comentario de preguntas, sin el prefijo del orquestador ni la marca. @param {string} body  @param {string} bot */
const preguntasDe = (body, bot) => body.slice(bot.length).replace(MARCA_PREGUNTAS, '').trim()

/**
 * El hilo de un pedido: cuántas rondas de preguntas lleva (los comentarios del orquestador con la marca), si ya hay respuesta a la
 * última (un comentario posterior de alguien con permiso que no es el orquestador ni un bot) y la conversación en markdown que recibe la
 * sesión. Los demás comentarios del orquestador no entran. Puro.
 * @param {Issue} issue  @param {Comentario[]} comentarios  @param {string} bot  @param {string[]} conPermiso
 */
export function hiloDePedido(issue, comentarios, bot, conPermiso) {
  const orden = [...comentarios].sort(
    (a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || (a.id ?? 0) - (b.id ?? 0),
  )
  const partes = [
    `### El pedido (#${issue.number}): ${issue.title ?? ''}\n\n${(issue.body ?? '').trim()}`,
  ]
  let rondas = 0
  let respondida = false
  for (const c of orden) {
    if (esDePreguntas(c, bot)) {
      rondas++
      respondida = false
      partes.push(
        `### Preguntas de la redacción (ronda ${rondas})\n\n${preguntasDe(c.body ?? '', bot)}`,
      )
    } else if (cuenta(c, bot, conPermiso)) {
      if (rondas > 0) respondida = true
      const quien = rondas > 0 ? 'Respuesta' : 'Comentario'
      partes.push(
        `### ${quien} de la persona (${(c.created_at ?? '').slice(0, 10)})\n\n${(c.body ?? '').trim()}`,
      )
    }
  }
  return { rondas, respondida, conversacion: recortar(partes.join('\n\n')) }
}

/**
 * El comentario de una ronda de preguntas (sin el prefijo «🤖 orquestador:», que pone `comentar`), con la marca que la cuenta. Puro.
 * @param {string} preguntas  @param {number} ronda  @param {number} [max]
 */
export function comentarioDePreguntas(preguntas, ronda, max = RONDAS_MAX) {
  return [
    `antes de escribir la spec necesito saber (ronda ${ronda} de ${max}):`,
    '',
    recortar(preguntas.trim(), TOPE - 1000),
    '',
    'Responde en un comentario de este issue (todas juntas o en varios): tu respuesta vuelve a lanzar la redacción.',
    '',
    MARCA_PREGUNTAS,
  ].join('\n')
}

// ---------- la CLI, para pedidos.sh ----------
//
//   node redaccion.mjs salida < resultado                          JSON {tipo, texto}
//   node redaccion.mjs hilo <issue.json> <comentarios.json> <bot> <con_permiso_json>   JSON {rondas, respondida, conversacion}
//   node redaccion.mjs preguntas <ronda> < preguntas               el comentario de esa ronda
//   node redaccion.mjs recortar [tope] < texto
function principal([orden, a, b, c, d]) {
  const stdin = () => readFileSync(0, 'utf8')
  const leer = (/** @type {string} */ f) => JSON.parse(readFileSync(f, 'utf8'))
  if (orden === 'salida') process.stdout.write(JSON.stringify(salidaDeRedaccion(stdin())))
  else if (orden === 'hilo' && a && b && c && d)
    process.stdout.write(JSON.stringify(hiloDePedido(leer(a), leer(b), c, JSON.parse(d))))
  else if (orden === 'preguntas' && a)
    process.stdout.write(comentarioDePreguntas(stdin(), Number(a)))
  else if (orden === 'recortar') process.stdout.write(recortar(stdin(), a ? Number(a) : TOPE))
  else {
    console.error('uso: node redaccion.mjs salida|hilo|preguntas|recortar …')
    process.exit(64)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  principal(process.argv.slice(2))
