import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { juguete } from '../kit/juguete'
import { cuerpo, escenario, TIEMPO } from './prueba/escenario'

// Lo que sube al kit (kit.sh, README.md › «Lo que sube al kit»): al integrar un PR que toca flujo (según el flujo.txt del repo, el del
// kit de juguete), el orquestador crea en el kit un issue `cola` «traer de <repo> el PR #<n>» con el token del dueño del kit, y lo
// reintenta en el espejo si falla. Con el gh falso (prueba/escenario.ts), que guarda los issues del kit en `git[<kit>].issues`.

const KIT = 'AndresEduardoRA/kit'
type Archivo = { filename: string; previous_filename?: string; patch?: string }

/** T12 integra el PR #40 con `archivos`; T11, el #39 con producto y una lección propia. Listas para que el espejo las integre. */
function conIntegradas(
  archivos: Archivo[],
  { rama = 'feat/doce', cuentas = ['Cuenta', 'AndresEduardoRA'] } = {},
) {
  const k = juguete()
  const t = escenario('KIT_AVISAR="si"\n', { conKit: { dir: k.kit, version: k.A } })
  t.issue(11, cuerpo('feat/once'))
  t.issue(12, cuerpo(rama))
  t.orq('espejo')
  for (const [id, pr] of [
    ['T11', '39'],
    ['T12', '40'],
  ] as const) {
    t.ponerEst(id, 'estado', 'esperando_ci')
    t.ponerEst(id, 'pr', pr)
  }
  t.cambiarGh((g) => {
    g.issues[11]!.state = 'closed'
    g.issues[12]!.state = 'closed'
    g.cuentas = cuentas
    const propias = [
      { filename: 'src/x.ts' },
      { filename: 'docs/LECCIONES.md', patch: '@@ -1 +1,2 @@\n+- Mía.' },
    ]
    g.prs['Cuenta/tienda-app'] = [
      { number: 39, rama: 'feat/once', estado: 'MERGED', archivos: propias },
      { number: 40, rama, estado: 'MERGED', archivos },
    ]
  })
  return t
}
const issuesDelKit = (t: ReturnType<typeof escenario>) =>
  Object.values(t.gh().git?.[KIT]?.issues ?? {}) as {
    title: string
    body: string
    labels: string[]
  }[]
/** El issue del kit como lo lee el espejo del kit: la vuelta por spec-issue.mjs (el título lleva «#»). */
const comoSpec = (i: { title: string; body: string; labels: string[] }) =>
  execFileSync('node', ['scripts/orquestador/spec-issue.mjs', 'de-issue'], {
    input: JSON.stringify({ number: 1, ...i }),
    encoding: 'utf8',
  })

it(
  'un PR que toca flujo › un issue cola en el kit con el token de su dueño y sólo las rutas de flujo, una vez; sin flujo, nada',
  () => {
    const t = conIntegradas([
      { filename: 'scripts/flujo/publicar.sh', patch: '+x' },
      { filename: 'src/app/page.tsx' },
    ])
    t.orq('espejo')
    expect(t.est('T12', 'estado')).toBe('integrado')
    const issues = issuesDelKit(t)
    expect(issues).toHaveLength(1)
    const i = issues[0]!
    expect(i.labels).toEqual(['cola'])
    expect(i.title).toBe('traer de tienda-app el PR #40')
    const post = t.llamadas().filter((l) => l.args.includes(`repos/${KIT}/issues`))
    expect(post.map((l) => l.token)).toEqual(['tok-AndresEduardoRA'])
    const spec = comoSpec(i)
    expect(spec).toMatch(/^titulo: traer de tienda-app el PR #40$/m)
    for (const linea of [
      'rama: feat/traer-tienda-app-pr-40',
      'conflicto: flujo',
      'nivel: capaz',
      'effort: high',
    ])
      expect(spec).toContain(`\n${linea}\n`)
    expect(spec).toContain('- `scripts/flujo/publicar.sh`')
    expect(spec).not.toContain('src/app/page.tsx')
    expect(spec).toContain('https://github.com/Cuenta/tienda-app/pull/40')
    expect(spec).not.toContain('{{')
    expect(t.est('T12', 'aviso_kit')).toBe('hecho')
    expect(t.est('T12', 'aviso_kit_issue')).toBe(`https://github.com/${KIT}/issues/1`)
    expect(t.gh().issues[12]!.comentarios.at(-1)!.body).toContain(
      `llevé al kit lo de flujo de este PR: https://github.com/${KIT}/issues/1`,
    )
    // T11 tocó producto y una lección sin (kit) ni (semilla).
    expect(t.est('T11', 'aviso_kit')).toBe('nada')

    t.ponerEst('T12', 'aviso_kit_intento', '0')
    t.orq('espejo')
    expect(issuesDelKit(t)).toHaveLength(1)
  },
  TIEMPO,
)

it(
  'una lección (semilla) sola › crea el issue con la lección para las semillas',
  () => {
    const t = conIntegradas([
      {
        filename: 'docs/LECCIONES.md',
        patch: '@@ -9 +9,2 @@\n+- Pide la cuenta en la semilla: porque X. (semilla)',
      },
    ])
    t.orq('espejo')
    const [i] = issuesDelKit(t)
    expect(i?.title).toBe('traer de tienda-app el PR #40')
    expect(i?.body).toContain('Para `docs/semillas/LECCIONES.md` › «Sugerencias de los proyectos»:')
    expect(i?.body).toContain('\n- Pide la cuenta en la semilla: porque X. (semilla)\n')
    expect(i?.body).toContain('- ninguna: sólo lecciones')
  },
  TIEMPO,
)

it(
  'la tarea que trae el flujo del kit › no avisa (lo que trae ya es del kit)',
  () => {
    const t = conIntegradas([{ filename: 'scripts/flujo/publicar.sh' }], {
      rama: 'chore/flujo-del-kit-2026-w47',
    })
    t.orq('espejo')
    expect(t.est('T12', 'estado')).toBe('integrado')
    expect(t.est('T12', 'aviso_kit')).toBe('')
    expect(issuesDelKit(t)).toEqual([])
    expect(t.llamadas().some((l) => l.args.some((a) => a.includes('pulls/40/files')))).toBe(false)
  },
  TIEMPO,
)

it(
  'sin sesión del dueño del kit › queda pendiente y se reintenta; a los 5 fallos, fallido con aviso y el comando a mano',
  () => {
    const t = conIntegradas([{ filename: 'scripts/flujo/publicar.sh' }], { cuentas: ['Cuenta'] })
    t.orq('espejo')
    expect(t.est('T12', 'aviso_kit')).toBe('pendiente')
    expect(t.log()).toContain(
      'T12: no pude llevar al kit el PR (intento 1 de 5): sin sesión de gh de AndresEduardoRA (gh auth login)',
    )
    expect(t.orq('plan').salida).toContain('T12  integrado · falta llevar al kit')
    // Antes de la espera no se reintenta.
    t.orq('espejo')
    expect(t.est('T12', 'aviso_kit_fallos')).toBe('1')
    for (let n = 0; n < 4; n++) {
      t.ponerEst('T12', 'aviso_kit_intento', '0')
      t.orq('espejo')
    }
    expect(t.est('T12', 'aviso_kit')).toBe('fallido')
    expect(t.log()).toContain('AVISO · T12: no pude llevar al kit el PR #40')
    expect(t.log()).toContain(
      `gh api -X POST repos/${KIT}/issues -f title='traer de tienda-app el PR #40'`,
    )
    expect(t.orq('plan').salida).toContain(
      'T12  integrado · no se pudo llevar al kit (estado/T12/aviso_kit.md)',
    )
    expect(issuesDelKit(t)).toEqual([])
  },
  TIEMPO * 2,
)
