import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { cuerpo, escenario, TIEMPO } from './prueba/escenario'

// La cola en los issues: dependencias por rama de otro repo, issues cerrados a mano, sin red, yaml roto, rama repetida y el
// límite de la API, con un gh falso (prueba/escenario.ts).

it(
  'cola en issues › una dependencia por rama de otro repo (y del kit) se da por integrada sólo con su PR integrado y el token de esa cuenta',
  () => {
    const t = escenario('KIT_GITHUB="Cuenta/kit"\n')
    t.issue(8, cuerpo('feat/ocho', 'depende: tienda-web:feat/agenda\n'))
    t.issue(9, cuerpo('feat/nueve', 'depende: kit:feat/cola-en-issues\n'))
    t.issue(10, cuerpo('feat/diez', 'depende: nadie:feat/x\n'))
    t.orq('espejo')
    let plan = t.orq('plan').salida
    expect(plan).toContain(
      'T8  espera dependencias: tienda-web:feat/agenda (sin token de la cuenta Otra: gh auth login)',
    )
    expect(plan).toContain(
      'T9  espera dependencias: kit:feat/cola-en-issues (sin PR integrado de feat/cola-en-issues en Cuenta/kit)',
    )
    expect(plan).toContain('no sé qué repo es «nadie»')

    t.cambiarGh((g) => {
      g.cuentas.push('Otra')
      g.prs['Otra/tienda-web'] = [{ number: 3, rama: 'feat/agenda', estado: 'OPEN' }]
      g.prs['Cuenta/kit'] = [{ number: 5, rama: 'feat/cola-en-issues', estado: 'MERGED' }]
    })
    plan = t.orq('plan').salida
    expect(plan).toContain(
      'T8  espera dependencias: tienda-web:feat/agenda (sin PR integrado de feat/agenda en Otra/tienda-web)',
    )
    expect(plan).toContain('T9  LISTA para lanzar')

    t.cambiarGh((g) => {
      g.prs['Otra/tienda-web']![0]!.estado = 'MERGED'
    })
    expect(t.orq('plan').salida).toContain('T8  LISTA para lanzar')
    const deOtra = t.llamadas().filter((l) => l.args.includes('Otra/tienda-web'))
    expect(deOtra.length).toBeGreaterThan(0)
    expect(deOtra.every((l) => l.token === 'tok-Otra')).toBe(true)
  },
  TIEMPO,
)

it(
  'cola en issues › un issue cerrado a mano deja la tarea omitida; cerrado con su PR integrado, integrada',
  () => {
    const t = escenario()
    t.issue(11, cuerpo('feat/once'))
    t.issue(12, cuerpo('feat/doce'))
    t.orq('espejo')
    t.ponerEst('T12', 'estado', 'esperando_ci')
    t.ponerEst('T12', 'pr', '40')
    t.cambiarGh((g) => {
      g.issues[11]!.state = 'closed'
      g.issues[12]!.state = 'closed'
      g.prs['Cuenta/tienda-app'] = [{ number: 40, rama: 'feat/doce', estado: 'MERGED' }]
    })
    t.orq('espejo')
    expect(t.est('T11', 'estado')).toBe('omitida')
    expect(t.gh().issues[11]!.labels).toEqual(['cola', 'cola:omitida'])
    expect(t.gh().issues[11]!.comentarios.at(-1)!.body).toContain('cerraste el issue')
    expect(t.est('T12', 'estado')).toBe('integrado')
    expect(t.gh().issues[12]!.labels).toEqual(['cola', 'cola:integrada'])
    expect(t.gh().issues[12]!.comentarios.at(-1)!.body).toContain('integrada en main con el PR #40')
  },
  TIEMPO,
)

it(
  'cola en issues › sin red el espejo no rompe nada: la cola local sigue y lo pendiente se publica cuando vuelve',
  () => {
    const t = escenario()
    t.issue(5, cuerpo('feat/cinco'))
    t.orq('espejo')
    t.ponerEst('T5', 'estado', 'trabada')
    t.cambiarGh((g) => {
      g.sinRed = true
    })
    mkdirSync(join(t.datos, 'entrada'))
    writeFileSync(
      join(t.datos, 'entrada/nueva.md'),
      '---\ntitulo: una nueva\nrama: feat/nueva\n---\n',
    )
    expect(t.orq('espejo').estado).toBe(0)
    expect(t.orq('entrada').estado).toBe(1)
    expect(t.cola()).toEqual(['T5-cinco.md'])
    expect(t.est('T5', 'estado')).toBe('trabada')
    expect(existsSync(join(t.datos, 'entrada/nueva.md'))).toBe(true)
    expect(t.log()).toContain('GitHub no responde')
    expect(t.orq('plan').salida).toContain('T5  trabada')

    t.cambiarGh((g) => {
      g.sinRed = false
    })
    t.orq('espejo')
    expect(t.cola()).toEqual(['T5-cinco.md', 'T6-nueva.md'])
    expect(t.log()).toContain('GitHub responde otra vez')
  },
  TIEMPO,
)

it(
  'cola en issues › un yaml roto o una rama repetida dejan la tarea en borrador con un comentario; el límite de la API pausa el espejo',
  () => {
    const t = escenario()
    t.issue(20, '```yaml\nrama: [feat/rota\n```\n')
    t.issue(21, cuerpo('feat/igual'))
    t.issue(22, cuerpo('feat/igual'))
    // Un issue de alguien sin permiso de escritura no entra a la cola (su spec sería el prompt de una sesión).
    t.issue(23, cuerpo('feat/ajeno'))
    t.cambiarGh((x) => {
      x.issues[23]!.autor = 'NONE'
    })
    t.orq('espejo')
    t.orq('espejo')
    expect(t.cola()).not.toContain('T23-ajeno.md')
    expect(t.log()).toContain('issue #23: lo abrió alguien sin permiso de escritura')
    const g = t.gh()
    expect(g.issues[20]!.labels).toContain('cola:borrador')
    expect(g.issues[20]!.comentarios).toHaveLength(1)
    expect(g.issues[20]!.comentarios[0]!.body).toContain('no puedo leer el bloque yaml')
    expect(g.issues[22]!.labels).toContain('cola:borrador')
    expect(g.issues[22]!.comentarios.filter((c) => c.body.includes('ya es de T21'))).toHaveLength(1)
    expect(g.issues[21]!.labels).toEqual(['cola'])
    expect(t.spec('T22-igual.md')).toContain('\nborrador: si\n')
    expect(t.orq('plan').salida).toMatch(/T21 {2}LISTA[\s\S]*T22 {2}borrador/)

    t.cambiarGh((x) => {
      x.limite = true
    })
    t.orq('espejo')
    expect(t.log()).toContain('límite de la API')
    const antes = t.llamadas().length
    t.orq('espejo')
    expect(t.llamadas().length).toBe(antes)
  },
  TIEMPO,
)

it(
  'cola en issues › «nueva <tema>» publica la spec en borrador como issue y la deja en la cola con su número',
  () => {
    const t = escenario()
    const r = t.orq('nueva', 'avisos-nuevos')
    expect(r.estado).toBe(0)
    expect(r.salida).toContain(
      'T5: issue https://github.com/Cuenta/tienda-app/issues/5 (en borrador)',
    )
    expect(t.gh().issues[5]!.labels).toEqual(['cola', 'cola:borrador'])
    expect(t.gh().issues[5]!.body).toContain('rama: feat/avisos-nuevos')
    expect(t.cola()).toEqual(['T5-avisos-nuevos.md'])
    expect(t.orq('plan').salida).toContain('T5  borrador')
    // Con la cola en issues el id lo da el issue.
    expect(t.orq('nueva', 'T9', 'otra').estado).toBe(64)
  },
  TIEMPO,
)
