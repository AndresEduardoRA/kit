// semilla-a-repo, la parte determinista: el ejemplo v2 (turnero: app y web) en una raíz temporal, los repos que salen, volver a
// correr, --sumar, y lo que se niega a hacer. Corre el validador de verdad: sin python3 con PyYAML se salta diciéndolo (salvo con
// SEMILLA_EXIGE_PYYAML=1, que lo exige: el job «kit · proyecto de ejemplo»).
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { leerManifiesto } from '../proyecto/manifiesto.mjs'
import { coincide, esFlujo, patronesDelKit, rutaProhibida } from './flujo.mjs'
import { crear, resumen } from './nuevo-proyecto.mjs'
import { personalizar } from './personalizar.mjs'
import { reemplazos } from './reemplazos.mjs'
import { archivosDelKit } from './repo-nuevo.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const hayPyYaml = spawnSync('python3', ['-c', 'import yaml']).status === 0
const exige = process.env.SEMILLA_EXIGE_PYYAML === '1'
if (!hayPyYaml && !exige)
  console.log('# aviso: sin python3 con PyYAML se saltan las pruebas del generador')
const conValidador = hayPyYaml || exige ? describe : describe.skip

/** Una raíz de proyectos temporal con la semilla de ejemplo en z_turnero/semilla, con `cambio(dir)` aplicado. */
function proyecto(cambio = () => {}) {
  const raiz = mkdtempSync(join(tmpdir(), 'proyectos-'))
  const semilla = join(raiz, 'z_turnero', 'semilla')
  cpSync(join(KIT, 'scripts/semilla/ejemplo/semilla'), semilla, { recursive: true })
  cambio(semilla)
  return { raiz, z: join(raiz, 'z_turnero') }
}
const editar = (archivo, fn) => writeFileSync(archivo, fn(readFileSync(archivo, 'utf8')))

/** Los archivos de una carpeta, relativos a ella (sin .git). */
function listar(raiz, pre = '') {
  return readdirSync(join(raiz, pre)).flatMap((n) => {
    const rel = pre + n
    if (n === '.git') return []
    return statSync(join(raiz, rel)).isDirectory() ? listar(raiz, rel + '/') : [rel]
  })
}

conValidador('nuevo-proyecto.mjs sobre el ejemplo turnero', () => {
  test('en seco: dos repos, bloques 5 y 6, ningún marcador y nada escrito', () => {
    const p = proyecto()
    const r = crear('turnero', { raiz: p.raiz, enSeco: true })
    assert.deepEqual(
      r.repos.map((x) => [x.nombre, x.bloque, x.marcadores.length, x.secretos.length]),
      [
        ['turnero-app', 5, 0, 0],
        ['turnero-web', 6, 0, 0],
      ],
    )
    assert.deepEqual(readdirSync(p.z), ['semilla'])
    const texto = resumen(r, true)
    assert.match(texto, /^manifiesto: z_turnero\/proyecto\.yaml · nuevo \(ensayo: nada escrito\)$/m)
    assert.match(
      texto,
      /^ {2}cola: 3 pasos \+ cierre · rojos: ninguno · espera a: turnero-app:P02$/m,
    )
    assert.match(texto, /^ {2}contratos: consume agenda-publica@1 en P01 · publica: nada$/m)
    assert.equal(texto.split('\n').length, 1 + 6 + 6)
  })

  test('de verdad: los dos repos, cada uno con su nombre, su bloque, su copia del manifiesto y lo que nace de la semilla', () => {
    const p = proyecto()
    crear('turnero', { raiz: p.raiz })
    const suelto = readFileSync(join(p.z, 'proyecto.yaml'), 'utf8')
    execFileSync('python3', [
      join(KIT, 'scripts/semilla/validar_semilla.py'),
      '--manifiesto',
      join(p.z, 'proyecto.yaml'),
    ])
    const kitHead = execFileSync('git', ['-C', KIT, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
    for (const [rol, bloque, scopes, descripcion] of [
      [
        'app',
        5,
        "'agenda',\n        'equipo',",
        'Panel interno de la barbería y dueño de la base de turnos',
      ],
      ['web', 6, "'reserva',", 'Web pública para ver horas libres y reservar un turno'],
    ]) {
      const dir = join(p.z, rol)
      const leer = (f) => readFileSync(join(dir, f), 'utf8')
      const copia = leerManifiesto(leer('.proyecto/proyecto.yaml'))
      assert.deepEqual(copia, leerManifiesto(suelto), `${rol}: la copia es el manifiesto entero`)
      assert.deepEqual(
        copia.repos.map((x) => [x.rol, x.puertos, x.provee, x.consume]),
        [
          ['app', { bloque: 5 }, [], []],
          ['web', { bloque: 6 }, [], []],
        ],
      )
      assert.deepEqual(copia.contratos?.[0]?.vigentes, [1])
      assert.match(leer('supabase/config.toml'), new RegExp(`^project_id = "turnero-${rol}"$`, 'm'))
      assert.match(leer('supabase/config.toml'), new RegExp(`^port = 5${bloque}321$`, 'm'))
      assert.equal(JSON.parse(leer('package.json')).name, `turnero-${rol}`)
      assert.ok(!/"(kit:|test:generador)/.test(leer('package.json')), 'sin los scripts del kit')
      assert.match(leer('AGENTS.md'), new RegExp(`^# turnero-${rol}\n\n${descripcion}\n`))
      assert.match(
        leer('AGENTS.md'),
        /`docs\/semilla\/`: `semilla\.md` y `plan\.yaml` de este repo, y `comun\.md`/,
      )
      assert.ok(leer('commitlint.config.mjs').includes(scopes), `${rol}: scopes`)
      assert.match(leer('src/shared/config/app.ts'), /^export const NOMBRE_APP = 'Turnero'$/m)
      assert.match(leer('src/shared/config/app.ts'), /COLOR_TEMA = 'oklch\(0\.45 0\.12 250\)'/)
      assert.match(leer('design/tokens.css'), /--color-primario: oklch\(0\.45 0\.12 250\);/)
      assert.match(
        leer('design/tokens.css'),
        /docs\/semilla\/comun\.md › Marca y sistema de diseño/,
      )
      assert.equal(leer('.kit/version'), kitHead)
      assert.match(leer('scripts/orquestador/README.md'), new RegExp(`orquestador-turnero-${rol}`))
      assert.match(
        leer('.claude/agents/revisor.md'),
        new RegExp(`Eres el revisor de turnero-${rol}\\.`),
      )
      for (const f of ['comun.md', 'semilla.md', 'plan.yaml', 'registro.md'])
        assert.ok(existsSync(join(dir, 'docs/semilla', f)), `${rol}: docs/semilla/${f}`)
      assert.match(leer('docs/semilla/semilla.md'), new RegExp(`^rol: ${rol}$`, 'm'))
      for (const doc of ['UX', 'RENDIMIENTO', 'GLOSARIO']) {
        assert.ok(!/no se edita a mano/i.test(leer(`docs/${doc}.md`)), `${doc} se edita`)
        assert.match(leer(`docs/${doc}.md`), /^> Nació de la semilla v1 /m)
      }
      assert.match(leer('docs/GLOSARIO.md'), /\*\*Código de cancelación:\*\*/)
      assert.match(leer('docs/GLOSARIO.md'), /docs\/semilla\/comun\.md/)
      assert.equal(
        execFileSync('git', ['-C', dir, 'log', '--format=%s'], { encoding: 'utf8' }).trim(),
        `chore(kit): arrancar turnero-${rol} desde el kit (semilla v1)`,
      )
      assert.equal(
        execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }),
        '',
      )
      // De scripts/kit/ viaja sólo lo que es flujo (traer el flujo del kit); el generador, la publicación y su gh falso, no.
      for (const f of [
        'scripts/kit/actualizar.mjs',
        'scripts/kit/flujo.txt',
        'scripts/kit/mezcla.mjs',
      ])
        assert.ok(existsSync(join(dir, f)), `${rol}: ${f} viaja`)
      for (const f of [
        'scripts/kit/nuevo-proyecto.mjs',
        'scripts/kit/publicar-proyecto.mjs',
        'scripts/kit/reemplazos.mjs',
        'scripts/kit/traer-de-proyecto.mjs',
        'scripts/kit/prueba',
        '.claude/skills/traer-de-proyecto',
        '.claude/skills/semilla-a-repo',
        '.kit/omitir',
        'scripts/semilla',
        'scripts/proyecto/proyecto.sh',
        'scripts/proyecto/proyecto.mjs',
        'scripts/proyecto/proyecto-texto.mjs',
        'docs/semillas',
        '.kit/plantilla',
        'node_modules',
      ])
        assert.ok(!existsSync(join(dir, f)), `${rol}: ${f} no viaja`)
      assert.ok(existsSync(join(KIT, '.kit/plantilla')), 'el kit sí tiene la marca de plantilla')
      // Nada del flujo viejo (el regex se arma en pedazos: el grep de K04 no cuenta esta prueba). Ni archivos ni texto, salvo docs/semilla.
      const viejo = new RegExp(
        ['pilo', 'to|coordina', 'dor|compuer', 'ta|PILO', 'TO_|COORD', '_'].join(''),
        'i',
      )
      const sueltos = listar(dir).filter(
        (f) =>
          !f.startsWith('docs/semilla/') &&
          f !== 'docs/KIT.md' &&
          (viejo.test(f) || viejo.test(readFileSync(join(dir, f), 'utf8'))),
      )
      assert.deepEqual(sueltos, [], `${rol}: sin rastro del flujo viejo`)
    }
    assert.match(
      readFileSync(join(p.z, 'app/docs/UX.md'), 'utf8'),
      /\| Agenda del día \| `\/agenda`/,
    )
    assert.match(readFileSync(join(p.z, 'web/docs/UX.md'), 'utf8'), /\| Reservar \| `\/reservar`/)
    // Volver a correr: todo se salta y el manifiesto queda byte a byte.
    const otra = crear('turnero', { raiz: p.raiz })
    assert.deepEqual(otra.repos, [])
    assert.deepEqual(
      otra.saltados.map((s) => s.rol),
      ['app', 'web'],
    )
    assert.equal(readFileSync(join(p.z, 'proyecto.yaml'), 'utf8'), suelto)
  })

  test('una carpeta ocupada se salta; después --sumar la crea con el bloque siguiente', () => {
    const p = proyecto()
    mkdirSync(join(p.z, 'web'))
    writeFileSync(join(p.z, 'web', 'algo'), 'x')
    const r = crear('turnero', { raiz: p.raiz })
    assert.deepEqual(
      r.repos.map((x) => x.rol),
      ['app'],
    )
    assert.match(
      resumen(r),
      /^turnero-web · z_turnero\/web · se salta: z_turnero\/web ya existe y no está vacía$/m,
    )
    assert.deepEqual(
      leerManifiesto(readFileSync(join(p.z, 'proyecto.yaml'), 'utf8')).repos.map((x) => x.rol),
      ['app'],
    )
    rmSync(join(p.z, 'web'), { recursive: true })
    assert.throws(() => crear('turnero', { raiz: p.raiz }), /para sumar web usa --sumar/)
    const sumado = crear('turnero', { raiz: p.raiz, sumar: 'web' })
    assert.deepEqual(
      sumado.repos.map((x) => [x.rol, x.bloque]),
      [['web', 6]],
    )
    assert.equal(sumado.manifiesto.estado, 'se suma web')
    const copia = leerManifiesto(readFileSync(join(p.z, 'web/.proyecto/proyecto.yaml'), 'utf8'))
    assert.deepEqual(copia.contratos?.[0]?.consumidores, ['web'])
  })

  test('un .creando-* que dejó un corte se borra al empezar', () => {
    const p = proyecto()
    mkdirSync(join(p.z, '.app.creando-999999999', 'x'), { recursive: true })
    crear('turnero', { raiz: p.raiz })
    assert.deepEqual(readdirSync(p.z).sort(), ['app', 'proyecto.yaml', 'semilla', 'web'])
  })

  test('se niega: sin semilla, semilla que no valida, marcas «verificar», sin auditoría', () => {
    const vacia = mkdtempSync(join(tmpdir(), 'proyectos-'))
    assert.throws(() => crear('turnero', { raiz: vacia }), /no hay semilla en .*z_turnero\/semilla/)
    const rota = proyecto((s) =>
      editar(join(s, 'comun.md'), (t) => t.replace('Pagos en línea,', 'Pagos en línea, etc.,')),
    )
    assert.throws(
      () => crear('turnero', { raiz: rota.raiz, enSeco: true }),
      /no pasa el validador:[\s\S]*texto prohibido «etc\.»[\s\S]*idea-a-semilla/,
    )
    const marcas = proyecto((s) =>
      editar(join(s, 'comun.md'), (t) =>
        t.replace('Tipografía Inter.', 'Tipografía Inter «verificar».'),
      ),
    )
    assert.throws(
      () => crear('turnero', { raiz: marcas.raiz, enSeco: true }),
      /cierra las marcas «verificar» en idea-a-semilla/,
    )
    const mediano = proyecto((s) =>
      editar(join(s, 'repos/app/semilla.md'), (t) => t.replace('tamano: chico', 'tamano: mediano')),
    )
    assert.throws(
      () => crear('turnero', { raiz: mediano.raiz, enSeco: true }),
      /falta la auditoría independiente \(tamaño mediano\): Fase 5 de idea-a-semilla/,
    )
    writeFileSync(join(mediano.z, 'semilla/ESTADO.md'), '- auditoría independiente: hecha\n')
    assert.equal(crear('turnero', { raiz: mediano.raiz, enSeco: true }).repos.length, 2)
  })
})

describe('el flujo que viaja (scripts/kit/flujo.txt)', () => {
  test('todo archivo del kit que es flujo viaja; cada línea nombra un archivo del kit y ninguna es del producto', () => {
    const patrones = patronesDelKit()
    const viajan = new Set(archivosDelKit(KIT))
    const delKit = execFileSync('git', ['-C', KIT, 'ls-files'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
    const quedan = delKit.filter((f) => esFlujo(f, patrones) && !viajan.has(f))
    assert.deepEqual(quedan, [], 'lo de flujo.txt que el generador no copia')
    for (const p of patrones) {
      assert.ok(
        delKit.some((f) => coincide(f, p)),
        `«${p}» no nombra ningún archivo del kit`,
      )
      assert.ok(
        !p.startsWith('*') && !rutaProhibida(p.replaceAll('*', 'x')),
        `«${p}» es del producto`,
      )
    }
  })

  test('personalizar.mjs (el de actualizar.mjs) da lo mismo que el generador en los archivos del flujo', () => {
    const valores = {
      nombre: 'turnero-app',
      slug: 'turnero',
      bloque: 6,
      funciones: 'avisar cobrar',
    }
    const r = reemplazos({
      slug: 'turnero',
      rol: 'app',
      nombreProyecto: 'Turnero',
      descripcion: 'x',
      bloque: 6,
      scopes: [],
      funciones: 'avisar cobrar',
      cssSemilla: '',
    })
    for (const f of [
      '.claude/agents/revisor.md',
      'scripts/orquestador/README.md',
      '.github/workflows/ci.yml',
      '.github/acciones/pila/action.yml',
    ]) {
      const t = readFileSync(join(KIT, f), 'utf8')
      assert.equal(personalizar(f, t, valores), r[f](t), f)
    }
  })
})
