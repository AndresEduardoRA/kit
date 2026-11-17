#!/usr/bin/env node
// Crea los repos de un proyecto desde su semilla v2 (la parte determinista de la skill semilla-a-repo). No llama a ningún modelo ni a
// la red: valida la semilla, escribe el manifiesto y, por cada repo en construcción que falta, copia el kit, reemplaza, escribe lo que
// nace de la semilla, verifica que no quedó un marcador y hace el primer commit. Publicar en GitHub y cargar la cola es de
// publicar-proyecto.mjs.
//
//   node scripts/kit/nuevo-proyecto.mjs <slug> [--sumar <rol>] [--en-seco] [--raiz <dir>] [--bloque N]
//
// - La semilla es <raíz>/z_<slug>/semilla/; el manifiesto, <raíz>/z_<slug>/proyecto.yaml; cada repo, <raíz>/z_<slug>/<rol>/. La raíz
//   es dos arriba de la principal del kit (rutas.mjs); --raiz la mueve entera, sólo para pruebas y el CI.
// - Sin manifiesto crea todos los repos de la semilla; con él, los que están en construcción y no tienen carpeta. Un repo de la
//   semilla que falta en el manifiesto se suma con --sumar <rol> (uno por vez). Una carpeta ocupada se salta y se dice.
// - --bloque N: el bloque de puertos, sólo si se suma un solo repo al manifiesto. --en-seco: todo en memoria, nada escrito.
// Sale con 1 y el motivo si algo no cuadra, con 64 si el uso está mal. Se prueba en `nuevo-proyecto.test.mjs`.
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { manifiestosDeLaRaiz } from '../proyecto/manifiesto.mjs'
import { manifiestoDelProyecto } from './manifiesto-nuevo.mjs'
import { comoProblema, exigir, Problema } from './problema.mjs'
import {
  archivosDelKit,
  escribirRepo,
  limpiarCreando,
  planDelRepo,
  resumenDelRepo,
} from './repo-nuevo.mjs'
import { carpetaOcupada, raizDelKit, rutasDelProyecto } from './rutas.mjs'
import * as S from './semilla.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export { Problema }

/** El commit del kit que se copia (va a `.kit/version`). La skill exige el kit en main y limpio: así dice la verdad. */
function versionDelKit(kit) {
  const r = spawnSync('git', ['-C', kit, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  exigir(r.status === 0, `el kit (${kit}) no es un repo de git: .kit/version no tendría qué decir`)
  return r.stdout.trim()
}

/** El CSS del contrato de tokens del kit: lo que hay entre las marcas semilla:inicio y semilla:fin de design/tokens.css. */
function cssDelKit(kit) {
  const t = readFileSync(join(kit, 'design/tokens.css'), 'utf8')
  return t.slice(t.indexOf('semilla:inicio'), t.indexOf('semilla:fin'))
}

/** El manifiesto pasa también el validador de Python (`--manifiesto`), antes de escribir nada. */
function validarManifiesto(texto) {
  const archivo = join(mkdtempSync(join(tmpdir(), 'manifiesto-')), 'proyecto.yaml')
  writeFileSync(archivo, texto)
  const v = spawnSync('python3', [S.VALIDADOR, '--manifiesto', archivo], { encoding: 'utf8' })
  rmSync(dirname(archivo), { recursive: true, force: true })
  exigir(
    v.status === 0,
    `el manifiesto no pasaría el validador:\n${`${v.stdout}${v.stderr}`.trim()}`,
  )
}

/** Crea (o ensaya, con `enSeco`) los repos del proyecto `slug`. Devuelve qué hizo, para el resumen. */
export function crear(slug, { raiz, sumar, enSeco = false, bloque, kit = KIT } = {}) {
  exigir(/^[a-z][a-z0-9-]{1,30}$/.test(slug ?? ''), `«${slug}» no sirve como slug`)
  const base = resolve(raizDelKit(kit, raiz))
  const rutas = rutasDelProyecto(base, slug)
  exigir(existsSync(join(rutas.semilla, 'comun.md')), `no hay semilla en ${rutas.semilla}`)
  S.validarSemilla(rutas.semilla)
  const semilla = S.leerSemillaV2(rutas.semilla)
  const { fm } = semilla.comun
  exigir(fm.slug === slug, `la semilla de ${rutas.semilla} es del proyecto «${fm.slug}»`)
  const tamanos = Object.values(semilla.repos).map((r) => String(r.fm.tamano))
  const falta = S.faltaAuditoria(semilla.estado, tamanos)
  exigir(!falta, `falta la auditoría independiente (tamaño ${falta}): Fase 5 de idea-a-semilla`)
  const cssSemilla = S.cssDeLaSemilla(semilla.comun.texto)
  const delCss = S.problemasDelCss(cssSemilla, cssDelKit(kit))
  exigir(
    !delCss.length,
    `el sistema de diseño no cumple el contrato del kit:\n- ${delCss.join('\n- ')}`,
  )

  const previo = existsSync(rutas.manifiesto) ? readFileSync(rutas.manifiesto, 'utf8') : null
  const otros = comoProblema(() => manifiestosDeLaRaiz(base)).filter(
    (m) => resolve(m.archivo) !== rutas.manifiesto,
  )
  const ocupadas = new Set(
    fm.repos.map((r) => r.rol).filter((rol) => carpetaOcupada(rutas.repo(rol))),
  )
  const m = manifiestoDelProyecto({
    comun: fm,
    previo,
    archivo: rutas.manifiesto,
    otros,
    ocupadas,
    sumar,
    bloque,
  })
  validarManifiesto(m.texto)

  const version = versionDelKit(kit)
  const delKit = new Map(
    archivosDelKit(kit).map((f) => {
      const buf = readFileSync(join(kit, f))
      const contenido = buf.includes(0) ? buf : buf.toString('utf8')
      return [f, { contenido, modo: statSync(join(kit, f)).mode & 0o777 }]
    }),
  )
  const planes = m.crear.map((c) =>
    planDelRepo({ semilla, crear: c, slug, manifiesto: m.texto, cssSemilla, delKit, version }),
  )
  for (const p of planes)
    exigir(
      !p.marcadores.length,
      `${p.nombre}: quedarían marcadores sin reemplazar:\n- ${p.marcadores.join('\n- ')}`,
    )
  const resultado = {
    raiz: base,
    manifiesto: {
      archivo: relative(base, rutas.manifiesto),
      estado:
        previo === null ? 'nuevo' : m.cambio ? `se suma ${m.agregados.join(', ')}` : 'sin cambios',
    },
    repos: planes,
    saltados: m.saltados.map((s) => ({ ...s, nombre: `${slug}-${s.rol}` })),
  }
  if (enSeco) return resultado

  mkdirSync(rutas.carpeta, { recursive: true })
  if (m.cambio) writeFileSync(rutas.manifiesto, m.texto) // antes de los repos: un corte deja los bloques reservados
  limpiarCreando(rutas.carpeta)
  for (const p of planes) p.commit = escribirRepo(p, rutas.repo(p.rol), slug)
  return resultado
}

/** El resumen humano de `crear`. Puro. */
export function resumen(r, enSeco) {
  return [
    `manifiesto: ${r.manifiesto.archivo} · ${r.manifiesto.estado}${enSeco ? ' (ensayo: nada escrito)' : ''}`,
    ...r.repos.map((p) => resumenDelRepo(p)),
    ...r.saltados.map((s) => resumenDelRepo({ ...s, motivo: s.motivo })),
  ].join('\n')
}

function principal(argv) {
  const conValor = ['--sumar', '--raiz', '--bloque']
  const pos = argv.filter((a, i) => !a.startsWith('--') && !conValor.includes(argv[i - 1] ?? ''))
  const opcion = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined)
  const conocidas = [...conValor, '--en-seco']
  if (pos.length !== 1 || argv.some((a) => a.startsWith('--') && !conocidas.includes(a))) {
    console.error(
      'uso: node scripts/kit/nuevo-proyecto.mjs <slug> [--sumar <rol>] [--en-seco] [--raiz <dir>] [--bloque N]',
    )
    process.exit(64)
  }
  const enSeco = argv.includes('--en-seco')
  try {
    const r = crear(pos[0], {
      sumar: opcion('--sumar'),
      raiz: opcion('--raiz'),
      bloque: opcion('--bloque'),
      enSeco,
    })
    console.log(resumen(r, enSeco))
  } catch (e) {
    if (!(e instanceof Problema)) throw e
    console.error(`nuevo-proyecto: ${e.message}`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  principal(process.argv.slice(2))
