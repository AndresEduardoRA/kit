import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { MARCADORES } from './personalizar.mjs'
import { git, juguete, LINEAS, TIEMPO } from './juguete'

// actualizar.mjs con tres repos de juguete (juguete.ts): sin choque, con choque y con .kit/omitir; más sin acceso, `--revisar` y el
// árbol sucio (docs/KIT.md › «El flujo entre el kit y los proyectos»).

const NOMBRE = MARCADORES[0] ?? ''
const corto = (sha: string) => sha.slice(0, 7)

it(
  'sin choque › mezcla las dos partes, trae lo nuevo personalizado, no toca src/ y commitea; la segunda vez, al día',
  () => {
    const t = juguete()
    const r = t.correr()
    expect(r.salida).toContain(`✓ traje el flujo del kit hasta ${corto(t.B)}`)
    expect(r.estado).toBe(0)
    expect(t.leer('scripts/flujo/estado.sh')).toBe(
      LINEAS.replace('uno', 'UNO').replace('siete', 'SIETE'),
    )
    expect(t.leer('scripts/flujo/nuevo.sh')).toBe('echo nuevo\n')
    expect(statSync(join(t.proyecto, 'scripts/flujo/nuevo.sh')).mode & 0o111).toBeTruthy()
    expect(t.leer('.claude/agents/revisor.md')).toContain('cinco: tienda-app\n')
    expect(t.leer('.claude/agents/revisor.md')).not.toContain(NOMBRE)
    expect(t.leer('docs/LECCIONES.md')).toMatch(/- Sólo de aquí\.\n- Del kit\.\n$/)
    expect(t.leer('src/x.ts')).toBe('export const propio = true\n')
    expect(t.leer('.kit/version')).toBe(`${t.B}\n`)
    expect(git(t.proyecto, 'log', '-1', '--format=%s')).toBe(
      `chore(kit): traer el flujo del kit ${corto(t.B)}`,
    )
    expect(git(t.proyecto, 'status', '--porcelain')).toBe('')
    expect(r.salida).toContain('· traídos del kit (1): .claude/agents/revisor.md')
    expect(r.salida).toContain('· mezclados (2): docs/LECCIONES.md, scripts/flujo/estado.sh')
    expect(r.salida).toContain('· nuevos (1): scripts/flujo/nuevo.sh')

    const otra = t.correr()
    expect(otra.estado).toBe(0)
    expect(otra.salida).toContain(`al día con el kit (${corto(t.B)})`)
    expect(git(t.proyecto, 'rev-list', '--count', 'HEAD')).toBe('2')
  },
  TIEMPO,
)

it(
  'con choque › sale con 3 nombrando la ruta, sin tocar nada ni dejar marcas; con --tomar-kit, trae la del kit',
  () => {
    const t = juguete((dir) =>
      writeFileSync(join(dir, 'scripts/flujo/estado.sh'), LINEAS.replace('uno', 'Uno')),
    )
    const r = t.correr()
    expect(r.estado).toBe(3)
    expect(r.salida).toContain('✗ choques con el kit (1): no toqué nada')
    expect(r.salida).toContain('scripts/flujo/estado.sh: 1 choque al mezclar')
    expect(r.salida).toContain(
      'Para responder: --tomar-kit <ruta> · --dejar <ruta> · o una línea en .kit/omitir',
    )
    expect(git(t.proyecto, 'status', '--porcelain')).toBe('')
    expect(t.leer('scripts/flujo/estado.sh')).toBe(LINEAS.replace('uno', 'Uno'))
    expect(t.leer('.kit/version')).toBe(`${t.A}\n`)

    const tomada = t.correr('--tomar-kit', 'scripts/flujo/estado.sh')
    expect(tomada.estado).toBe(0)
    expect(t.leer('scripts/flujo/estado.sh')).toBe(LINEAS.replace('uno', 'UNO'))
    expect(tomada.salida).toContain('· tomados del kit (--tomar-kit) (1): scripts/flujo/estado.sh')
    expect(t.leer('.kit/version')).toBe(`${t.B}\n`)
  },
  TIEMPO,
)

it(
  'con .kit/omitir › el borrado y anotado sigue afuera; el borrado sin anotar vuelve y el resumen dice cómo omitirlo',
  () => {
    const t = juguete((dir) => {
      rmSync(join(dir, 'scripts/flujo/omitido.sh'))
      rmSync(join(dir, 'scripts/flujo/restaurado.sh'))
      writeFileSync(
        join(dir, '.kit/omitir'),
        '# lo que no quiero del kit\nscripts/flujo/omitido.sh\n',
      )
    })
    const r = t.correr()
    expect(r.estado).toBe(0)
    expect(existsSync(join(t.proyecto, 'scripts/flujo/omitido.sh'))).toBe(false)
    expect(t.leer('scripts/flujo/restaurado.sh')).toBe('echo restaurado\n')
    expect(r.salida).toContain(
      '· restaurados (si no lo quieres, bórralo y anótalo en .kit/omitir) (1): scripts/flujo/restaurado.sh',
    )
    expect(r.salida).toContain('· omitidos por .kit/omitir (1): scripts/flujo/omitido.sh')
  },
  TIEMPO,
)

it(
  'sin acceso al kit › sale con 1 con el motivo y no cambia nada (tampoco --revisar)',
  () => {
    const t = juguete()
    t.cambiarKit((k) => {
      k.sinAcceso = true
    })
    const r = t.correr()
    expect(r.estado).toBe(1)
    expect(r.salida).toMatch(
      /^actualizar: sin acceso al kit por GitHub \(AndresEduardoRA\/kit\): HTTP 404/m,
    )
    expect(git(t.proyecto, 'status', '--porcelain')).toBe('')
    expect(t.leer('.kit/version')).toBe(`${t.A}\n`)
    expect(t.correr('--revisar').estado).toBe(1)
  },
  TIEMPO,
)

it(
  '--revisar › 10 atrás por flujo; 0 al día; 0 si el kit sólo avanzó fuera del flujo',
  () => {
    const t = juguete()
    const atras = t.correr('--revisar')
    expect(atras.estado).toBe(10)
    expect(atras.salida.trim()).toBe(`${corto(t.B)} · 4 archivos de flujo`)
    expect(git(t.proyecto, 'status', '--porcelain')).toBe('')
    expect(t.correr().estado).toBe(0)
    expect(t.correr('--revisar').salida).toContain('al día con el kit')
    t.escribir(t.kit, { 'src/x.ts': 'export const x = 3\n' })
    const C = t.commitear(t.kit, 'C')
    const fuera = t.correr('--revisar')
    expect(fuera.estado).toBe(0)
    expect(fuera.salida.trim()).toBe(`al día: el kit avanzó fuera del flujo (${corto(C)})`)
  },
  TIEMPO,
)

it(
  'se niega › con el árbol sucio, sin .kit/version o en el kit',
  () => {
    const t = juguete()
    writeFileSync(join(t.proyecto, 'suelto.txt'), 'x')
    const sucio = t.correr()
    expect(sucio.estado).toBe(1)
    expect(sucio.salida).toContain('hay cambios sin commitear: commitéalos o descártalos antes')
    rmSync(join(t.proyecto, 'suelto.txt'))
    rmSync(join(t.proyecto, '.kit/version'))
    expect(t.correr('--revisar').salida).toContain(
      'sin .kit/version: escribe en él el commit del kit',
    )
    writeFileSync(join(t.proyecto, '.kit/plantilla'), 'x')
    expect(t.correr('--revisar').salida).toContain('esto es el kit')
    expect(t.correr('--otra').estado).toBe(64)
  },
  TIEMPO,
)
