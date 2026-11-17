// Lo puro de `proyecto.sh` (texto adentro, texto afuera; sin red ni disco): las líneas de `estado` y `resumen`, qué campos manda el repo y
// cuáles el proyecto, cómo se pone al día el manifiesto suelto sin reescribirlo entero, el issue «sincronizar el manifiesto», la
// `## Retro` del PR de cierre y las unidades de systemd del resumen diario. Lo usa `proyecto.mjs`; se prueba en `proyecto.test.mjs`.
import { isMap, parseDocument, stringify } from 'yaml'

// ---------- estado: las líneas de un repo ----------

/** Cuántos días de un PR abierto son «nadie lo vio»: desde ahí el PR va en rojo aunque su CI esté verde. */
export const DIAS_DE_UN_PR = 2
/** Lo que se lista de cada cosa (PR, trabadas…): el resto va como «y más». */
export const TOPE_DE_LINEAS = 3
export const TOPE_DE_COLA = 100

/** «✓», «✗» o «·» (en curso o sin correr) de una conclusión de GitHub (el mismo criterio que `scripts/flujo/estado.sh`). Puro. */
export function marca(conclusion) {
  if (['success', 'SUCCESS'].includes(conclusion)) return '✓'
  if (
    ['failure', 'FAILURE', 'cancelled', 'CANCELLED', 'timed_out', 'TIMED_OUT'].includes(conclusion)
  )
    return '✗'
  return '·'
}

/** Días enteros entre dos instantes ISO (0 si no se pueden leer). Puro. @param {string} desde  @param {Date} ahora */
export function diasDesde(desde, ahora) {
  const t = Date.parse(desde)
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((ahora.getTime() - t) / 86_400_000))
}

const mas = (lista, que, comando) =>
  lista.length > TOPE_DE_LINEAS ? [{ marca: '·', texto: `… y más ${que}: ${comando}` }] : []

/**
 * Las líneas de un repo ya consultado: `{ marca, texto, incompleto? }`. `✗` es lo que está en rojo; `incompleto` es lo que no se pudo
 * mirar (el resumen no dice «todo en verde» si faltó algo). Puro.
 * @param {{ github: string, prs: { numero: number, titulo: string, rama: string, creado: string, listo: string }[], masPrs?: boolean,
 *   ci: { conclusion: string, cuando: string, id: number, sha: string } | null,
 *   noche: { conclusion: string, cuando: string, id: number, sha: string } | null,
 *   trabadas: { numero: number, titulo: string }[], preguntas: { numero: number, titulo: string }[],
 *   urgentes: { numero: number, titulo: string }[], enCola: number }} d
 * @param {Date} ahora
 */
export function lineasDelRepo(d, ahora) {
  /** @type {{ marca: string, texto: string, incompleto?: boolean }[]} */
  const l = []
  if (d.prs.length === 0) l.push({ marca: '✓', texto: 'sin PR abiertos' })
  for (const p of d.prs.slice(0, TOPE_DE_LINEAS)) {
    const dias = diasDesde(p.creado, ahora)
    const viejo = dias >= DIAS_DE_UN_PR
    const rojo = marca(p.listo) === '✗'
    const m = rojo || viejo ? '✗' : marca(p.listo)
    const notas = [rojo ? 'CI en rojo' : '', viejo ? `lleva ${dias} días abierto` : ''].filter(
      Boolean,
    )
    l.push({
      marca: m,
      texto: `PR #${p.numero} abierto desde ${p.creado.slice(0, 10)} (${p.rama}): ${p.titulo}${notas.length ? ` — ${notas.join(', ')}` : ''}`,
    })
  }
  if (d.prs.length > TOPE_DE_LINEAS || d.masPrs)
    l.push({ marca: '·', texto: `… y más PR abiertos: gh pr list -R ${d.github}` })
  if (d.ci) {
    const m = marca(d.ci.conclusion)
    l.push({
      marca: m,
      texto: `CI de main (${d.ci.sha.slice(0, 8)}, ${d.ci.cuando})${m === '✗' ? ` — rojo: gh run view ${d.ci.id} -R ${d.github} --log-failed` : ''}`,
    })
  } else l.push({ marca: '·', texto: 'CI de main: sin corridas todavía' })
  if (d.noche) {
    const m = marca(d.noche.conclusion)
    l.push({
      marca: m,
      texto: `e2e de la noche (${d.noche.sha.slice(0, 8)}, ${d.noche.cuando})${m === '✗' ? ` — rojo: gh run view ${d.noche.id} -R ${d.github} --log-failed` : ''}`,
    })
  }
  for (const [lista, que, etiqueta] of /** @type {const} */ ([
    [d.trabadas, 'trabada', 'cola:trabada'],
    [d.preguntas, 'con pregunta para ti', 'cola:pregunta'],
  ])) {
    for (const i of lista.slice(0, TOPE_DE_LINEAS))
      l.push({ marca: '✗', texto: `#${i.numero} ${que}: ${i.titulo}` })
    l.push(
      ...mas(
        lista,
        que === 'trabada' ? 'trabadas' : 'con pregunta',
        `gh issue list -R ${d.github} --label ${etiqueta}`,
      ),
    )
  }
  if (d.trabadas.length === 0 && d.preguntas.length === 0)
    l.push({ marca: '✓', texto: 'ninguna trabada ni con pregunta' })
  for (const i of d.urgentes.slice(0, TOPE_DE_LINEAS))
    l.push({ marca: '·', texto: `#${i.numero} urgente: ${i.titulo}` })
  l.push(...mas(d.urgentes, 'urgentes', `gh issue list -R ${d.github} --label cola:urgente`))
  // Nunca un total exacto: la página de GitHub tiene tope y, llena, se dice «más de».
  l.push({
    marca: '·',
    texto:
      d.enCola >= TOPE_DE_COLA ? `más de ${TOPE_DE_COLA - 1} en la cola` : `${d.enCola} en la cola`,
  })
  return l
}

/** Lo que va en la línea de un repo que no se pudo consultar. Puro. @param {'acceso' | 'red'} motivo */
export function lineaSinGithub(motivo, cuenta, detalle = '') {
  return motivo === 'acceso'
    ? { marca: '✗', texto: `sin acceso a ${cuenta}${detalle ? ` (${detalle})` : ''}` }
    : {
        marca: '·',
        texto: `GitHub no respondió: sólo lo local${detalle ? ` (${detalle})` : ''}`,
        incompleto: true,
      }
}

/**
 * El texto de `estado` de un proyecto. Puro.
 * @param {{ nombre: string, proyecto: string }} m
 * @param {{ nombre: string, etapa: string, lineas: { marca: string, texto: string }[] }[]} repos
 */
export function textoDeEstado(m, repos) {
  const etapa = (e) => (e === 'construccion' ? 'construcción' : e)
  return `${[
    `${m.nombre} (${m.proyecto}) — ${repos.length} repo${repos.length === 1 ? '' : 's'}`,
    ...repos.flatMap((r) => [
      `  ${r.nombre} · ${etapa(r.etapa)}`,
      ...r.lineas.map((x) => `    ${x.marca} ${x.texto}`),
    ]),
  ].join('\n')}\n`
}

const TOPE_DEL_AVISO = 20

/**
 * El aviso diario de un proyecto: lo que está en rojo (o lo que no se pudo mirar) o «todo en verde». Puro.
 * @param {{ nombre: string, proyecto: string }} m
 * @param {{ nombre: string, lineas: { marca: string, texto: string, incompleto?: boolean }[] }[]} repos
 * @returns {{ titulo: string, mensaje: string, rojo: boolean }}
 */
export function resumenDelProyecto(m, repos) {
  const malas = repos.flatMap((r) =>
    r.lineas
      .filter((x) => x.marca === '✗' || x.incompleto)
      .map((x) => `${x.marca === '✗' ? '✗' : '·'} ${r.nombre}: ${x.texto}`),
  )
  const titulo = `[${m.proyecto}] Resumen diario`
  if (malas.length === 0)
    return {
      titulo,
      mensaje: `Todo en verde en ${repos.length} repo${repos.length === 1 ? '' : 's'}.`,
      rojo: false,
    }
  const mostradas = malas.slice(0, TOPE_DEL_AVISO)
  if (malas.length > mostradas.length)
    mostradas.push(
      `… y más: bash _herramientas/kit/scripts/proyecto/proyecto.sh estado z_${m.proyecto}`,
    )
  return { titulo, mensaje: mostradas.join('\n'), rojo: true }
}

// ---------- el manifiesto: quién manda en cada campo ----------

/**
 * Lo que manda el repo, de su copia: `etapa`, `semilla` y `provee` de su entrada y `vigentes` de los contratos que provee. Puro.
 * @param {import('./manifiesto.mjs').Manifiesto} m  @param {string} rol
 */
export function loDelRepo(m, rol) {
  const r = m.repos.find((x) => x.rol === rol)
  if (!r) return null
  return {
    etapa: r.etapa,
    semilla: r.semilla ?? null,
    provee: [...(r.provee ?? [])],
    vigentes: Object.fromEntries(
      (m.contratos ?? [])
        .filter((c) => c.proveedor === rol && c.vigentes)
        .map((c) => [c.id, [...(c.vigentes ?? [])]]),
    ),
  }
}

/**
 * Lo que manda el proyecto: nombre, semilla, y de cada repo y contrato lo que no es del repo. `consume` no está en ninguna de las dos
 * listas del esquema (la copia fijada la escribe `contrato:usar`): ni se compara ni se trae. Puro.
 * @param {import('./manifiesto.mjs').Manifiesto} m
 */
export function loDelProyecto(m) {
  return {
    proyecto: m.proyecto,
    nombre: m.nombre,
    semilla: m.semilla ?? null,
    repos: m.repos
      .map((r) => ({ rol: r.rol, nombre: r.nombre, github: r.github, puertos: r.puertos }))
      .sort((a, b) => a.rol.localeCompare(b.rol)),
    contratos: (m.contratos ?? [])
      .map((c) => ({
        id: c.id,
        proveedor: c.proveedor,
        consumidores: [...(c.consumidores ?? [])].sort(),
        tipo: c.tipo ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  }
}

const canon = (v) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  )

/** Qué campos del proyecto difieren entre dos manifiestos (`esperado` es el suelto; `copia`, la del repo), uno por línea. Puro. */
export function difierenLosCamposDelProyecto(esperado, copia) {
  const a = loDelProyecto(esperado)
  const b = loDelProyecto(copia)
  /** @type {string[]} */
  const d = []
  for (const k of ['proyecto', 'nombre', 'semilla'])
    if (canon(a[k]) !== canon(b[k]))
      d.push(`${k}: el proyecto dice ${canon(a[k])} y la copia ${canon(b[k])}`)
  for (const rol of new Set([...a.repos, ...b.repos].map((r) => r.rol))) {
    const x = a.repos.find((r) => r.rol === rol)
    const y = b.repos.find((r) => r.rol === rol)
    if (canon(x) !== canon(y))
      d.push(`repos[${rol}]: el proyecto dice ${canon(x ?? null)} y la copia ${canon(y ?? null)}`)
  }
  for (const id of new Set([...a.contratos, ...b.contratos].map((c) => c.id))) {
    const x = a.contratos.find((c) => c.id === id)
    const y = b.contratos.find((c) => c.id === id)
    if (canon(x) !== canon(y))
      d.push(
        `contratos[${id}]: el proyecto dice ${canon(x ?? null)} y la copia ${canon(y ?? null)}`,
      )
  }
  return d
}

// ---------- poner el suelto al día sin reescribirlo ----------

/** Un escalar o una lista corta como va en el yaml: la lista, en una línea. */
const textoYaml = (v) =>
  Array.isArray(v)
    ? `[${v.map((x) => stringify(x, { lineWidth: 0 }).trimEnd()).join(', ')}]`
    : stringify(v, { lineWidth: 0 }).trimEnd()

const inicioDeLinea = (t, i) => t.lastIndexOf('\n', i - 1) + 1
const finDeLinea = (t, i) => {
  const j = t.indexOf('\n', i)
  return j < 0 ? t.length : j
}

/**
 * Pone `clave: valor` en el mapa de `ruta`: si la clave está, reemplaza sólo su valor (el resto del archivo, comentarios incluidos, queda
 * igual); si falta, agrega la línea después de `despuesDe`. Devuelve el texto nuevo, o el mismo si ya decía eso. Puro.
 * @param {string} texto  @param {(string | number)[]} ruta  @param {string} clave  @param {unknown} valor  @param {string[]} despuesDe
 */
function ponerCampo(texto, ruta, clave, valor, despuesDe) {
  const doc = parseDocument(texto)
  const mapa = doc.getIn(ruta, true)
  if (!isMap(mapa)) return texto
  const nuevo = textoYaml(valor)
  const actual = mapa.get(clave, true)
  if (actual && typeof actual === 'object' && 'range' in actual && actual.range) {
    if (
      canon(doc.getIn([...ruta, clave])?.toJSON?.() ?? doc.getIn([...ruta, clave])) === canon(valor)
    )
      return texto
    const [desde, hasta] = actual.range
    return texto.slice(0, desde) + nuevo + texto.slice(hasta)
  }
  for (const previa of despuesDe) {
    const par = mapa.items.find((i) => String(/** @type {any} */ (i.key)?.value) === previa)
    const nodo = /** @type {any} */ (par?.value)
    const inicioClave = /** @type {any} */ (par?.key)?.range?.[0]
    if (!nodo?.range || inicioClave === undefined) continue
    const sangria = texto.slice(inicioDeLinea(texto, inicioClave), inicioClave).replace(/\S/g, ' ')
    const fin = finDeLinea(texto, nodo.range[1])
    return `${texto.slice(0, fin)}\n${sangria}${clave}: ${nuevo}${texto.slice(fin)}`
  }
  return texto
}

/**
 * El manifiesto suelto con lo que manda cada repo traído de su copia: por cada repo con copia, su `etapa`, `semilla` y `provee`, y los
 * `vigentes` de los contratos que provee. Sólo cambia lo que difiere. Puro.
 * @param {string} texto  el manifiesto suelto
 * @param {{ rol: string, copia: import('./manifiesto.mjs').Manifiesto }[]} copias
 * @returns {{ texto: string, cambios: string[] }}
 */
export function conLoDeLosRepos(texto, copias) {
  const cambios = []
  let t = texto
  for (const { rol, copia } of copias) {
    const lo = loDelRepo(copia, rol)
    const actual = parseDocument(t).toJS()
    const idx = (actual.repos ?? []).findIndex((r) => r.rol === rol)
    if (!lo || idx < 0) continue
    const r = actual.repos[idx]
    for (const [clave, valor, despues] of /** @type {const} */ ([
      ['etapa', lo.etapa, ['github', 'nombre']],
      ['semilla', lo.semilla, ['etapa']],
      ['provee', lo.provee, ['puertos', 'semilla']],
    ])) {
      const antes = r[clave] ?? (clave === 'provee' ? [] : null)
      if (canon(antes) === canon(valor)) continue
      const nuevo = ponerCampo(t, ['repos', idx], clave, valor, [...despues])
      if (nuevo === t) continue
      cambios.push(`${r.nombre}: ${clave} ${canon(antes)} → ${canon(valor)}`)
      t = nuevo
    }
    for (const [id, vigentes] of Object.entries(lo.vigentes)) {
      const ci = (parseDocument(t).toJS().contratos ?? []).findIndex((c) => c.id === id)
      if (ci < 0) continue
      const previo = parseDocument(t).toJS().contratos[ci].vigentes ?? null
      if (canon(previo) === canon(vigentes)) continue
      const nuevo = ponerCampo(t, ['contratos', ci], 'vigentes', vigentes, [
        'tipo',
        'consumidores',
        'proveedor',
      ])
      if (nuevo === t) continue
      cambios.push(`contrato ${id}: vigentes ${canon(previo)} → ${canon(vigentes)}`)
      t = nuevo
    }
  }
  return { texto: t, cambios }
}

/** El suelto con su cabecera, a partir del texto de una copia (sin su cabecera de copia). Puro. */
export function textoSuelto(copiaTexto, { nombre }, plantilla) {
  const lineas = copiaTexto.split('\n')
  let i = 0
  while (i < lineas.length && (lineas[i]?.startsWith('#') || lineas[i]?.trim() === '')) i++
  return `${[
    `# Manifiesto de ${nombre} (proyecto/v1). Suelto, sin versionar: las copias de cada repo (.proyecto/proyecto.yaml) son el respaldo.`,
    `# Plantilla y reglas: ${plantilla}. Lo rehizo \`proyecto.sh reconstruir\` desde esas copias; \`sincronizar\` lo mantiene al día.`,
  ].join('\n')}\n${lineas.slice(i).join('\n')}`.replace(/\n*$/, '\n')
}

/** Cuál de varias copias sirve de base al reconstruir: la que lista más repos y contratos; a igual, el rol menor. Puro. */
export function copiaBase(copias) {
  return [...copias].sort(
    (a, b) =>
      b.copia.repos.length - a.copia.repos.length ||
      (b.copia.contratos?.length ?? 0) - (a.copia.contratos?.length ?? 0) ||
      a.rol.localeCompare(b.rol),
  )[0]
}

// ---------- el issue «sincronizar el manifiesto» ----------

export const TITULO_SINCRONIZAR = 'sincronizar el manifiesto'

/**
 * El cuerpo del issue `cola` que le pide a un repo poner su copia al día: el yaml de la tarea, qué difiere y el contenido esperado.
 * El orquestador lo toma como cualquier tarea. Puro.
 * @param {{ repo: string, diferencias: string[], esperado: string }} p
 */
export function issueDeSincronizar({ repo, diferencias, esperado }) {
  return `\`\`\`yaml
titulo: ${TITULO_SINCRONIZAR}
rama: chore/sincronizar-manifiesto
nivel: rapido
effort: medium
\`\`\`

## Pedido de la persona

El manifiesto del proyecto (\`z_<proyecto>/proyecto.yaml\`, el suelto) manda en lo del proyecto y la copia de ${repo} dejó de coincidir.
Lo abrió \`proyecto.sh sincronizar\`.

## Objetivo

\`.proyecto/proyecto.yaml\` de ${repo} con exactamente el contenido de abajo, y nada más cambiado.

## Decisiones ya tomadas

- No se discute el contenido: es el del manifiesto del proyecto. Lo que manda el repo (\`etapa\`, \`semilla\`, \`provee\` y los \`vigentes\`
  de lo que provee) ya viene al día en el esperado.
- Lo que difiere:
${diferencias.map((d) => `  - ${d}`).join('\n')}

## Anclajes

\`.proyecto/proyecto.yaml\`, \`scripts/proyecto/manifiesto.mjs\`.

## Estados no felices

Si el contenido no pasa \`python3 _herramientas/kit/scripts/semilla/validar_semilla.py --manifiesto .proyecto/proyecto.yaml\` o el repo
tiene un puerto o un contrato que el esperado no trae, queda trabada con el motivo.

## Verificación

\`pnpm test\` y que \`node scripts/proyecto/manifiesto.mjs nombre\` siga diciendo el nombre del repo.

## Contenido esperado de \`.proyecto/proyecto.yaml\`

\`\`\`\`yaml
${esperado.replace(/\n*$/, '\n')}\`\`\`\`
`
}

// ---------- la retro del PR de cierre ----------

/** La sección `## Retro` del cuerpo de un PR (sin el título), o `null` si no la trae. Puro. @param {string | null | undefined} cuerpo */
export function retroDeCuerpo(cuerpo) {
  const m = /^## Retro[ \t]*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(
    (cuerpo ?? '').replace(/\r\n/g, '\n'),
  )
  const t = m?.[1]?.trim()
  return t ? t : null
}

const MARCA_RETRO = /^<!-- retro: (\S+) -->$/m

/**
 * `semilla/retro.md` con el bloque de un repo puesto (o cambiado), sin tocar los de los demás. Puro.
 * @param {string} previo  @param {string} nombreProyecto  @param {{ repo: string, pr: number, fecha: string, retro: string }} b
 */
export function retroConBloque(previo, nombreProyecto, b) {
  const partes = previo.split(/^(?=<!-- retro: \S+ -->$)/m).filter((p) => MARCA_RETRO.test(p))
  const bloque = `<!-- retro: ${b.repo} -->\n## ${b.repo} · PR #${b.pr} (${b.fecha})\n\n${b.retro}\n`
  const i = partes.findIndex((p) => MARCA_RETRO.exec(p)?.[1] === b.repo)
  if (i < 0) partes.push(bloque)
  else partes[i] = bloque
  return `# Retro de la construcción de ${nombreProyecto}\n\nCopiada de la «## Retro» del PR de cierre de cada repo por \`proyecto.sh sincronizar\`: no se edita, se reescribe.\n\n${partes.map((p) => p.replace(/\n*$/, '\n')).join('\n')}`
}

// ---------- el resumen diario: las unidades de systemd ----------

export const UNIDAD = 'proyectos-resumen'
export const HORA_DEL_RESUMEN = '*-*-* 08:00:00 America/La_Paz'

/**
 * El servicio y el timer del resumen diario. Puro.
 * @param {{ kit: string, raiz: string, home: string, path: string }} p
 */
export function unidadesDelResumen({ kit, raiz, home, path }) {
  const guion = `${kit}/scripts/proyecto/proyecto.sh`
  return {
    servicio: `# Lo escribe \`bash _herramientas/kit/scripts/proyecto/proyecto.sh instalar-resumen\`. No se edita: se vuelve a instalar.
[Unit]
Description=Resumen diario de los proyectos (sincronizar el manifiesto y avisar a ntfy)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${raiz}
# El «-» deja seguir al resumen aunque sincronizar falle (sin red, sin acceso a una cuenta).
ExecStart=-/usr/bin/env bash ${guion} sincronizar --todos
ExecStart=/usr/bin/env bash ${guion} resumen --todos
Environment=HOME=${home}
Environment=PATH=${path}
`,
    timer: `# Lo escribe \`bash _herramientas/kit/scripts/proyecto/proyecto.sh instalar-resumen\`. No se edita: se vuelve a instalar.
[Unit]
Description=Resumen diario de los proyectos, a las 08:00 de La Paz

[Timer]
OnCalendar=${HORA_DEL_RESUMEN}
# Si la máquina estaba apagada a esa hora, corre al encender.
Persistent=true
Unit=${UNIDAD}.service

[Install]
WantedBy=timers.target
`,
  }
}

/** Un valor de cabecera HTTP que ntfy entiende aunque lleve tildes o símbolos (RFC 2047 en base64 si no es ASCII). Puro. */
export const cabecera = (texto) =>
  /^[\x20-\x7e]*$/.test(texto)
    ? texto
    : `=?UTF-8?B?${Buffer.from(texto, 'utf8').toString('base64')}?=`
