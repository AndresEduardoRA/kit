// La elección de `scripts/e2e-afectados.mjs` (qué junta y por qué, arriba de ese guion). Pura; se prueba en `e2e-afectados.test.ts`.
import { basename } from 'node:path'

import {
  claveDe,
  dirigidosDe,
  e2eDelCambio,
  esSpec,
  patronDeSoporte,
  soporteAfectado,
  specsQueNombran,
} from '../e2e-dirigidos.mjs'
import { esDelMarco, grafoInverso, pantallasQueUsan } from './pantallas.mjs'
import { atrapa, localizadoresNoExactos, textosDeLasLineas } from './textos.mjs'

export const TOPE = 40
export const COMUN_AL_NOMBRAR = 12
export const COMUN_AL_ATRAPAR = 40
export const RUTAS_DE_TODA_PANTALLA = 6

// Los puntos de cada razón, por lo seguro de la evidencia: el orden en que entran al tope. Un texto cuenta entero en las pantallas que
// lo dibujan (las rutas a las que llega su archivo, o toda pantalla) y poco en las demás. Las palabras que el nombre del spec comparte
// con lo tocado (`clientes/[id]/` → clientes, ficha) suman y desempatan.
export const PUNTOS = {
  cambio: 1000, // cambió el spec o un ayudante suyo
  quitado: 80, // nombra un texto que se fue
  inicio: 70, // un localizador no exacto que el texto nuevo cumple desde su comienzo («Recargar» en «Recargar la página»)
  presupuestos: 70, // cambió el marco: los specs que miden presupuestos en toda pantalla (el JS del marco los mueve)…
  marco: 65, // … y los que prueban el marco
  palabra: 60, // un localizador no exacto que el texto nuevo cumple como palabra entera
  nombra: 50, // nombra un texto agregado
  parte: 40, // un localizador no exacto que el texto nuevo cumple a mitad de palabra
  dirigido: 30, // nombra el módulo, la ruta o la función tocada…
  dirigidoChico: 240, // … más esto repartido entre los specs que trae su archivo…
  dirigidoTope: 90, // … sin pasar de esto
  pantalla: 20, // pasa por una pantalla que usa el compartido tocado
  otraPantalla: 15, // un texto de otra pantalla
  palabraDelNombre: 10,
}
const FUERZA = ['inicio', 'palabra', 'parte']
// Los specs del marco: los que lo prueban (`shell-…`, `marco-…`) y los que miden presupuestos en toda pantalla (`presupuesto-…`).
const DEL_MARCO = /^(shell|marco|presupuesto)/
const GENERICAS = new Set(
  'src app modules features components hooks infra entities shared pantallas areas client index page layout lib tsx spec'.split(
    ' ',
  ),
)

export const esFuenteDeSrc = (a) =>
  /^src\/.+\.(tsx?|mjs|js)$/.test(a) &&
  !/\.(test|spec)\.[cm]?[jt]sx?$|\.d\.ts$|\.types\.ts$/.test(a)
const palabras = (ruta) =>
  ruta
    .replace(/\[[^\]]+\]/g, 'ficha')
    .split(/[/._\-()]+/)
    .filter((p) => p.length >= 4 && !GENERICAS.has(p))
const claveDeRuta = (ruta) => ({ prefijo: ruta, patron: new RegExp(`['"\`]/${ruta}\\b`) })
const sumarA = (mapa, clave, valor) => {
  if (!mapa.has(clave)) mapa.set(clave, new Set())
  mapa.get(clave).add(valor)
}

/** Los textos netos de cada archivo de `src/` del diff: una línea que sólo cambió su clase no cambia su texto. */
function textosDelDiff(cambios) {
  const agregados = new Map()
  const quitados = new Map()
  for (const [archivo, c] of Object.entries(cambios)) {
    if (!esFuenteDeSrc(archivo)) continue
    const ag = new Set(textosDeLasLineas(c.agregadas ?? []))
    const qu = new Set(textosDeLasLineas(c.quitadas ?? []))
    for (const t of ag) if (!qu.has(t)) sumarA(agregados, t, archivo)
    for (const t of qu) if (!ag.has(t)) sumarA(quitados, t, archivo)
  }
  return { agregados, quitados }
}

/**
 * La elección de los e2e afectados. `archivos`: los tocados; `cambios[archivo]`: `{ agregadas, quitadas }` (líneas del diff);
 * `specs`, `soportes`: los `e2e/<x>.spec.ts` y `e2e/soporte/<x>`; `fuentes`: los archivos de `src/` (para los imports); `leer(a)`:
 * el contenido de hoy, o null. Puro: sin I/O.
 *
 * @param {{ archivos: string[], cambios?: Record<string, { agregadas: string[], quitadas: string[] }>, specs: string[],
 *   soportes?: string[], fuentes?: string[], leer: (archivo: string) => string | null, tope?: number }} opciones
 */
export function e2eAfectados({
  archivos,
  cambios = {},
  specs,
  soportes = [],
  fuentes = [],
  leer,
  tope = TOPE,
}) {
  const razones = new Map()
  const sumar = (spec, puntos, razon) => {
    const r = razones.get(spec) ?? { puntos: 0, razones: [] }
    r.puntos += puntos
    r.razones.push(razon)
    razones.set(spec, r)
  }

  // Las pantallas de un archivo de src/: las rutas a las que llega por imports y los specs que las nombran.
  let inverso = null
  const alcances = new Map()
  const specsDeRutas = (rutas) =>
    specs.filter((s) =>
      rutas.some((r) => {
        const clave = claveDeRuta(r)
        return basename(s).startsWith(clave.prefijo) || clave.patron.test(leer(s) ?? '')
      }),
    )
  const alcanceDe = (archivo) => {
    if (!alcances.has(archivo)) {
      inverso ??= grafoInverso(fuentes, leer)
      const usa = pantallasQueUsan(archivo, inverso)
      const todaPantalla = usa.todaPantalla || usa.rutas.length > RUTAS_DE_TODA_PANTALLA
      const enPantalla = new Set(todaPantalla ? [] : specsDeRutas(usa.rutas))
      const clave = claveDe(archivo)
      if (clave) for (const s of specsQueNombran(clave, specs, leer)) enPantalla.add(s)
      alcances.set(archivo, { ...usa, marco: usa.todaPantalla, todaPantalla, enPantalla })
    }
    return alcances.get(archivo)
  }
  const enSuPantalla = (spec, archivosDelTexto) =>
    [...archivosDelTexto].some((a) => {
      const alcance = alcanceDe(a)
      return alcance.todaPantalla || alcance.enPantalla.has(spec)
    })

  // 1. Los dirigidos.
  const { elegidos, huerfanos } = dirigidosDe(archivos, specs, leer, soportes)
  // Un dirigido pesa más cuanto menos specs trae su archivo: los 4 de un módulo chico dicen más que los 120 de uno grande.
  const porClave = new Map()
  for (const archivo of archivos) {
    const clave = esSpec(archivo) ? null : claveDe(archivo)
    const llega = clave ? specsQueNombran(clave, specs, leer) : []
    const puntos = PUNTOS.dirigido + Math.round(PUNTOS.dirigidoChico / Math.max(1, llega.length))
    for (const spec of llega)
      porClave.set(spec, Math.min(PUNTOS.dirigidoTope, Math.max(porClave.get(spec) ?? 0, puntos)))
  }
  for (const spec of elegidos) {
    // Lo que no llega por una clave llega porque cambió él o un ayudante suyo.
    const puntos =
      archivos.includes(spec) || !porClave.has(spec) ? PUNTOS.cambio : porClave.get(spec)
    sumar(spec, puntos, puntos === PUNTOS.cambio ? 'cambió' : 'dirigido')
  }

  // 2. Los textos. Un texto en un ayudante llega a los specs que lo importan, también a través de otro ayudante.
  const delAyudante = new Map()
  const specsDelAyudante = (ayudante) => {
    if (!delAyudante.has(ayudante)) {
      const cadena = soporteAfectado([ayudante], leer, soportes)
      delAyudante.set(
        ayudante,
        specs.filter((spec) => cadena.some((a) => patronDeSoporte(a)?.test(leer(spec) ?? ''))),
      )
    }
    return delAyudante.get(ayudante)
  }
  const dondeBuscar = [...specs, ...soportes].map((a) => ({ a, texto: leer(a) ?? '' }))
  const llegaA = (archivosQueLoTienen) => [
    ...new Set(archivosQueLoTienen.flatMap((a) => (esSpec(a) ? [a] : specsDelAyudante(a)))),
  ]

  const { agregados, quitados } = textosDelDiff(cambios)
  const textos = []
  const ignorados = []
  for (const texto of new Set([...agregados.keys(), ...quitados.keys()])) {
    const llega = llegaA(dondeBuscar.filter((d) => d.texto.includes(texto)).map((d) => d.a))
    if (llega.length === 0) continue
    if (llega.length > COMUN_AL_NOMBRAR) {
      ignorados.push({ texto, como: 'nombra', specs: llega.length })
      continue
    }
    const se = agregados.has(texto) ? 'nombra' : 'quitado'
    const de = new Set([...(agregados.get(texto) ?? []), ...(quitados.get(texto) ?? [])])
    textos.push({ texto, como: se, specs: llega, archivos: de })
  }
  const porLocalizador = new Map()
  for (const { a, texto } of dondeBuscar)
    for (const loc of localizadoresNoExactos(texto)) sumarA(porLocalizador, loc, a)
  for (const [loc, donde] of porLocalizador) {
    const candidatos = [...agregados.keys()]
      .map((t) => ({ t, fuerza: atrapa(t, loc) }))
      .filter((c) => c.fuerza !== null)
      .sort((a, b) => FUERZA.indexOf(a.fuerza) - FUERZA.indexOf(b.fuerza))
    const mejor = candidatos[0]
    if (!mejor) continue
    const llega = llegaA([...donde])
    const texto = `${mejor.t} ⊇ ${loc}`
    if (llega.length > COMUN_AL_ATRAPAR)
      ignorados.push({ texto, como: 'atrapa', specs: llega.length })
    else textos.push({ texto, como: mejor.fuerza, specs: llega, archivos: agregados.get(mejor.t) })
  }
  for (const t of textos) {
    for (const spec of t.specs) {
      const aca = enSuPantalla(spec, t.archivos)
      sumar(spec, aca ? PUNTOS[t.como] : PUNTOS.otraPantalla, `${t.como} «${t.texto}»`)
    }
  }

  // 3. Las pantallas de un compartido o de lo que no nombra ningún spec.
  const pantallas = []
  const buscarPantallas = [
    ...new Set(
      archivos.filter(
        (a) =>
          esFuenteDeSrc(a) &&
          (a.startsWith('src/shared/') || esDelMarco(a) || huerfanos.includes(a)),
      ),
    ),
  ]
  // Una vez por spec, con la razón más fuerte: cinco archivos del marco no son cinco razones.
  const porPantalla = new Map()
  for (const archivo of buscarPantallas) {
    const { rutas, todaPantalla, marco, enPantalla } = alcanceDe(archivo)
    const mide = (s) => /soporte\/presupuestos\b/.test(leer(s) ?? '')
    const llega = todaPantalla
      ? specs.filter((s) => DEL_MARCO.test(basename(s)) || mide(s))
      : [...enPantalla]
    pantallas.push({ archivo, rutas, todaPantalla, specs: llega.length })
    const razon = todaPantalla ? 'toda pantalla' : `pantalla de ${archivo}`
    for (const spec of llega) {
      const puntos = !marco ? PUNTOS.pantalla : mide(spec) ? PUNTOS.presupuestos : PUNTOS.marco
      if ((porPantalla.get(spec)?.puntos ?? 0) < puntos) porPantalla.set(spec, { puntos, razon })
    }
  }
  for (const [spec, { puntos, razon }] of porPantalla) sumar(spec, puntos, razon)

  // El orden: puntos y las palabras que el nombre del spec comparte con lo tocado.
  const lugares = [
    ...archivos.filter((a) => a.startsWith('src/')),
    ...[...alcances.values()].flatMap((a) => (a.todaPantalla ? [] : a.app)),
  ]
  const tocadas = new Set(lugares.flatMap(palabras))
  for (const [spec, r] of razones) {
    const comunes = palabras(basename(spec, '.spec.ts')).filter((p) => tocadas.has(p)).length
    r.puntos += comunes * PUNTOS.palabraDelNombre
  }
  const ordenados = [...razones.entries()]
    .sort(([a, ra], [b, rb]) => rb.puntos - ra.puntos || a.localeCompare(b))
    .map(([spec]) => spec)
  const ci = e2eDelCambio(archivos, specs, leer, soportes)
  return {
    specs: ordenados.slice(0, tope).sort(),
    fuera: ordenados.slice(tope),
    razones: Object.fromEntries([...razones].map(([s, r]) => [s, r.razones])),
    dirigidos: [...elegidos].sort(),
    textos: textos.map(({ texto, como, specs: s }) => ({ texto, como, specs: s })),
    ignorados,
    pantallas,
    huerfanos,
    interfaz: ci.interfaz,
    ci: { modo: ci.modo, motivo: ci.motivo },
  }
}
