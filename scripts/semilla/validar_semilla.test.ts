// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// El validador de semillas (scripts/semilla/validar_semilla.py, copia literal del de idea-a-semilla) sobre la semilla de ejemplo y
// sobre variantes rotas, una regla por variante. Cada prueba copia el ejemplo a `<tmp>/z_turnero/semilla` (el validador avisa si la
// carpeta no se llama como el proyecto), le aplica una mutación y corre el validador de verdad.
// Sin PyYAML el validador no arranca: las pruebas se saltan diciéndolo, salvo con SEMILLA_EXIGE_PYYAML=1 (el job «kit · proyecto de
// ejemplo» del CI lo instala y lo exige), que las hace caer.
const KIT = resolve(import.meta.dirname, '../..')
const VALIDADOR = join(KIT, 'scripts/semilla/validar_semilla.py')
const EJEMPLO = join(KIT, 'scripts/semilla/ejemplo/semilla')
// Cada prueba arranca un python3 que lee seis archivos: en el runner de CI tarda menos de un segundo, pero un runner ocupado lo
// estira; 20 s deja margen sin esconder un cuelgue.
const TOPE_MS = 20_000

const hayPyYaml = spawnSync('python3', ['-c', 'import yaml']).status === 0
const exige = process.env['SEMILLA_EXIGE_PYYAML'] === '1'
if (!hayPyYaml && !exige)
  console.warn('aviso: sin python3 con PyYAML se saltan las pruebas del validador de semillas')
const conPyYaml = hayPyYaml || exige ? describe : describe.skip

const carpetas: string[] = []
afterAll(() => {
  for (const c of carpetas) rmSync(c, { recursive: true, force: true })
})

/** El ejemplo en `<tmp>/z_turnero/semilla`, con `cambio(archivo relativo, texto)` aplicado a cada archivo de `archivos`. */
function semilla(cambios: Record<string, (texto: string) => string> = {}) {
  const raiz = mkdtempSync(join(tmpdir(), 'validar-semilla-'))
  carpetas.push(raiz)
  const dir = join(raiz, 'z_turnero', 'semilla')
  cpSync(EJEMPLO, dir, { recursive: true })
  for (const [archivo, cambio] of Object.entries(cambios)) {
    const ruta = join(dir, archivo)
    const antes = readFileSync(ruta, 'utf8')
    const despues = cambio(antes)
    expect(despues, `la mutación de ${archivo} no cambió nada`).not.toBe(antes)
    writeFileSync(ruta, despues)
  }
  return dir
}

function validar(dir: string) {
  const r = spawnSync('python3', [VALIDADOR, dir], { encoding: 'utf8' })
  return { estado: r.status, salida: `${r.stdout}${r.stderr}` }
}

/** El paso `pid` de un plan.yaml con `campo: valor` cambiado (sólo dentro de ese paso). */
function enPaso(pid: string, campo: string, valor: string) {
  return (plan: string) => {
    const ini = plan.indexOf(`- id: ${pid}\n`)
    const fin = plan.indexOf('\n  - id: ', ini + 1)
    const paso = plan.slice(ini, fin < 0 ? undefined : fin)
    const nuevo = paso.replace(new RegExp(`${campo}: [^,\\n}]+`), `${campo}: ${valor}`)
    return plan.slice(0, ini) + nuevo + (fin < 0 ? '' : plan.slice(fin))
  }
}

conPyYaml('validar_semilla.py', () => {
  it(
    'el ejemplo pasa: 0 errores y sale con 0',
    () => {
      const { estado, salida } = validar(semilla())
      expect(salida).toContain('0 errores')
      expect(estado).toBe(0)
    },
    TOPE_MS,
  )

  // Cada variante rompe una regla y el validador la nombra.
  const variantes: [string, Record<string, (t: string) => string>, RegExp][] = [
    [
      'un ciclo entre repos',
      { 'repos/app/plan.yaml': enPaso('P01', 'depende_de', '[web:P03]') },
      /Ciclo de dependencias/,
    ],
    [
      'una versión de modelo fija',
      {
        // Armada en ejecución: escrita tal cual, la guarda de versiones de modelo marcaría esta prueba.
        'comun.md': (t) =>
          t.replace(
            '## 8. Riesgos',
            `Se escribió con ${['Opus', '4'].join(' ')}.\n\n## 8. Riesgos`,
          ),
      },
      /versión de modelo fija/,
    ],
    [
      'un token del contrato que falta',
      { 'comun.md': (t) => t.replace(/^ {2}--color-paper-dim:.*\n/m, '') },
      /le faltan tokens[\s\S]*--color-paper-dim/,
    ],
    [
      'un consumidor que no espera al paso que publica',
      { 'repos/web/plan.yaml': enPaso('P01', 'depende_de', '[]') },
      /no espera al paso que lo publica/,
    ],
    [
      'un paso rojo con nivel flojo',
      { 'repos/app/plan.yaml': enPaso('P01', 'nivel', 'normal') },
      /un paso rojo va con nivel capaz/,
    ],
  ]

  it.each(variantes)(
    'cae con %s',
    (_nombre, cambios, mensaje) => {
      const { estado, salida } = validar(semilla(cambios))
      expect(salida).toMatch(mensaje)
      expect(estado).toBe(1)
    },
    TOPE_MS,
  )
})
