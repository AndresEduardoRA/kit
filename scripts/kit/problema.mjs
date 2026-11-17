// Un motivo para negarse: las CLI del kit (nuevo-proyecto.mjs, publicar-proyecto.mjs) lo imprimen tal cual y salen con 1. Lo que
// no es un Problema es un defecto del kit y sale con su traza.
export class Problema extends Error {}

/** Lanza `Problema(msg)` si no se cumple `cond`. @param {unknown} cond  @param {string} msg  @returns {asserts cond} */
export function exigir(cond, msg) {
  if (!cond) throw new Problema(msg)
}

/** Corre `fn` y convierte en Problema el error que lance (un ManifiestoInvalido, un SpecRota): su texto ya dice qué arreglar. */
export function comoProblema(fn) {
  try {
    return fn()
  } catch (e) {
    if (e instanceof Problema) throw e
    throw new Problema(e instanceof Error ? e.message : String(e))
  }
}
