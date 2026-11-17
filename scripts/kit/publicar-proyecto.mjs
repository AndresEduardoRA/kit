#!/usr/bin/env node
// Publica en GitHub los repos de un proyecto ya creados por nuevo-proyecto.mjs y carga su cola (la parte de GitHub de la skill
// semilla-a-repo). Cada orden es idempotente: volver a correrla no repite lo hecho.
//
//   node scripts/kit/publicar-proyecto.mjs <slug> secretos|crear|cola|proteger [--rol <rol>] [--actualizar <rol>] [--privado]
//                                          [--aunque-rojo] [--raiz <dir>] [--en-seco]
//
// - secretos: lo versionado de cada repo con forma de secreto (secretos.mjs); con hallazgos sale con 1.
// - crear:    el repo en GitHub (público; --privado sólo con plan de pago), los ajustes de calesa-app, `origin` y las etiquetas de la
//             cola. Antes, los secretos. El primer push de main lo hace la skill con git (la excepción acotada del hook).
// - cola:     un issue por paso del plan, en el orden de todo el proyecto, y el cierre (cola.mjs). --en-seco los imprime sin crearlos.
//             --actualizar <rol>: los pasos nuevos de una versión nueva de la semilla en ese repo (se niega si está en mantenimiento).
// - proteger: la protección de main, si su primer CI terminó en verde; sale con 75 si sigue corriendo. --aunque-rojo lo decide la
//             persona.
// Procesa los repos en construcción del manifiesto que ya tienen carpeta con `.kit/version`, o sólo --rol. Entre dos issues hay una
// pausa de 1 s (PUBLICAR_PAUSA_MS la cambia). Sale con 1 y el motivo, con 64 si el uso está mal.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { leerManifiesto, repoPropio } from '../proyecto/manifiesto.mjs'
import { cargarCola } from './cola.mjs'
import * as G from './github.mjs'
import { comoProblema, exigir, Problema } from './problema.mjs'
import { raizDelKit, rutasDelProyecto } from './rutas.mjs'
import * as S from './semilla.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ORDENES = ['secretos', 'crear', 'cola', 'proteger']

/** El proyecto: la semilla validada, el manifiesto y los repos a procesar, cada uno con su carpeta y su cliente de gh. */
function proyecto(slug, { raiz, rol, actualizar }) {
  const rutas = rutasDelProyecto(resolve(raizDelKit(KIT, raiz)), slug)
  exigir(existsSync(join(rutas.semilla, 'comun.md')), `no hay semilla en ${rutas.semilla}`)
  S.validarSemilla(rutas.semilla)
  const semilla = S.leerSemillaV2(rutas.semilla)
  exigir(
    existsSync(rutas.manifiesto),
    `no hay manifiesto en ${rutas.manifiesto}: corre antes nuevo-proyecto.mjs ${slug}`,
  )
  const m = comoProblema(() =>
    leerManifiesto(readFileSync(rutas.manifiesto, 'utf8'), rutas.manifiesto),
  )
  const clientes = new Map()
  const ghDe = (github) => {
    const cuenta = github.split('/')[0] ?? ''
    if (!clientes.has(cuenta)) clientes.set(cuenta, G.clienteGh(cuenta))
    return clientes.get(cuenta)
  }
  const enConstruccion = m.repos.filter((r) => r.etapa === 'construccion' && semilla.repos[r.rol])
  const listos = enConstruccion.filter((r) => existsSync(join(rutas.repo(r.rol), '.kit/version')))
  const pedido = actualizar ?? rol
  if (pedido) {
    exigir(
      listos.some((r) => r.rol === pedido),
      `${slug}-${pedido} no es un repo en construcción con carpeta creada (${rutas.repo(pedido)})`,
    )
  }
  if (actualizar) {
    const dir = rutas.repo(actualizar)
    const copia = comoProblema(() =>
      leerManifiesto(readFileSync(join(dir, '.proyecto/proyecto.yaml'), 'utf8')),
    )
    exigir(
      repoPropio(copia, `${slug}-${actualizar}`).etapa === 'construccion',
      `${slug}-${actualizar} está en mantenimiento (.proyecto/proyecto.yaml): sus pasos nuevos van como pedidos, no desde la semilla`,
    )
  }
  const procesar = listos.filter((r) => !pedido || r.rol === pedido)
  exigir(
    procesar.length,
    `no hay repos creados de ${slug} en ${rutas.carpeta}: corre antes nuevo-proyecto.mjs ${slug}`,
  )
  return { rutas, semilla, m, enConstruccion, procesar, ghDe }
}

function secretos(p) {
  let hay = false
  for (const r of p.procesar) {
    const hallazgos = G.secretosVersionados(p.rutas.repo(r.rol))
    for (const h of hallazgos) console.log(`${r.nombre}/${h}: no se publica`)
    if (!hallazgos.length) console.log(`✓ ${r.nombre}: nada versionado con forma de secreto`)
    hay ||= hallazgos.length > 0
  }
  exigir(!hay, 'hay secretos versionados: sácalos de la historia antes de publicar')
}

function crear(p, { privado }) {
  secretos(p)
  for (const r of p.procesar) {
    const dir = p.rutas.repo(r.rol)
    const gh = p.ghDe(r.github)
    const descripcion = String(p.semilla.repos[r.rol].fm.descripcion ?? r.nombre)
    const estado = G.crearRepoEnGithub(gh, { github: r.github, privado, descripcion })
    G.ajustar(gh, r.github)
    const remoto = G.ponerRemoto(dir, r.github)
    G.asegurarEtiquetas(gh, dir)
    console.log(
      `✓ ${r.github}: ${estado === 'creado' ? `creado ${privado ? 'privado' : 'público'}` : 'ya existía: sólo ajustes y etiquetas'} · ` +
        `origin ${remoto} · ajustes y etiquetas de la cola`,
    )
  }
}

function cola(p, { enSeco }) {
  const { semilla, m } = p
  const roles = p.enConstruccion.map((r) => r.rol)
  const repos = Object.fromEntries(
    p.enConstruccion.map((r) => [
      r.rol,
      {
        github: r.github,
        gh: p.ghDe(r.github),
        version: semilla.repos[r.rol].fm.version ?? 1,
        pantallas: S.pantallasDe(S.seccion(semilla.repos[r.rol].texto, 'Experiencia')),
      },
    ]),
  )
  const r = cargarCola({
    slug: m.proyecto,
    roles,
    planes: Object.fromEntries(roles.map((rol) => [rol, semilla.repos[rol].plan])),
    repos,
    registro: semilla.registro,
    proveedorDe: (id) =>
      (semilla.comun.fm.contratos ?? []).find((c) => c.id === id)?.proveedor ?? '?',
    procesar: p.procesar.map((x) => x.rol),
    plantillaCierre: readFileSync(
      join(KIT, 'scripts/orquestador/plantillas/cerrar-construccion.md'),
      'utf8',
    ),
    enSeco,
    pausaMs: Number(process.env.PUBLICAR_PAUSA_MS ?? 1000),
  })
  for (const s of r.specs)
    console.log(`--- ${m.proyecto}-${s.rol} · ${s.que} · ${s.issue.titulo}\n${s.issue.cuerpo}`)
  for (const c of r.creados)
    if (!enSeco) console.log(`✓ ${m.proyecto}-${c.rol} #${c.numero}: ${c.paso}`)
  for (const a of r.avisos) console.log(`aviso: ${a}`)
  console.log(
    `${enSeco ? 'se crearían' : 'creados'}: ${r.creados.length} issues · ya estaban: ${r.yaEstaban}`,
  )
}

function proteger(p, { aunqueRojo }) {
  let corriendo = 0
  for (const r of p.procesar) {
    const estado = G.proteger(p.ghDe(r.github), r.github, { aunqueRojo })
    if (estado === 'corriendo') {
      corriendo++
      console.log(
        `… ${r.github}: el CI de main sigue corriendo (o no arrancó); vuelve a correr cuando termine`,
      )
    } else console.log(`✓ ${r.github}: main protegido («${G.CHECK}», strict)`)
  }
  return corriendo ? 75 : 0
}

function principal(argv) {
  const conValor = ['--rol', '--actualizar', '--raiz']
  const pos = argv.filter((a, i) => !a.startsWith('--') && !conValor.includes(argv[i - 1] ?? ''))
  const opcion = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined)
  const conocidas = [...conValor, '--privado', '--aunque-rojo', '--en-seco']
  const [slug, orden] = pos
  if (
    pos.length !== 2 ||
    !ORDENES.includes(orden ?? '') ||
    argv.some((a) => a.startsWith('--') && !conocidas.includes(a)) ||
    (opcion('--actualizar') && orden !== 'cola')
  ) {
    console.error(
      'uso: node scripts/kit/publicar-proyecto.mjs <slug> secretos|crear|cola|proteger [--rol <rol>] [--actualizar <rol>] ' +
        '[--privado] [--aunque-rojo] [--raiz <dir>] [--en-seco]',
    )
    process.exit(64)
  }
  try {
    const p = proyecto(slug ?? '', {
      raiz: opcion('--raiz'),
      rol: opcion('--rol'),
      actualizar: opcion('--actualizar'),
    })
    if (orden === 'secretos') secretos(p)
    else if (orden === 'crear') crear(p, { privado: argv.includes('--privado') })
    else if (orden === 'cola') cola(p, { enSeco: argv.includes('--en-seco') })
    else process.exit(proteger(p, { aunqueRojo: argv.includes('--aunque-rojo') }))
  } catch (e) {
    if (!(e instanceof Problema)) throw e
    console.error(`publicar-proyecto: ${e.message}`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  principal(process.argv.slice(2))
