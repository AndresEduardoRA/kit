// Lo puro del generador: la semilla v2 (secciones, registro, pantallas, auditoría, CSS) y los reemplazos (puertos, scopes,
// marcadores). Sin python3: corre siempre.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { marcadoresSueltos, moverPuertos, scopesDelPlan } from './reemplazos.mjs'
import {
  cssDeLaSemilla,
  faltaAuditoria,
  leerRegistro,
  pantallasDe,
  problemasDelCss,
  seccion,
  terminosDe,
} from './semilla.mjs'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const EJEMPLO = join(KIT, 'scripts/semilla/ejemplo/semilla')
const leer = (f) => readFileSync(join(EJEMPLO, f), 'utf8')

test('seccion: título exacto, con o sin número; no confunde un título que empieza igual', () => {
  assert.equal(seccion('## 1. Datos\nx\n## 2. Datos extra\ny', 'Datos'), 'x')
  assert.equal(seccion('## Datos extra\ny', 'Datos'), null)
  assert.equal(seccion('## 6. Experiencia\n\ntabla\n', 'Experiencia'), 'tabla')
  // Un título que termina en una letra no ASCII: \b fallaba ahí.
  assert.equal(seccion('## 3. Técnica\nz', 'Técnica'), 'z')
})

test('pantallasDe: la tabla de app (con Rol e «igual») y la de web (sin Rol)', () => {
  const app = pantallasDe(seccion(leer('repos/app/semilla.md'), 'Experiencia'))
  assert.deepEqual(
    app.map((p) => [p.ruta, p.rol, p.estados]),
    [
      ['/agenda', 'barbero, dueño', 'vacío, carga, error, sin permiso, sin conexión'],
      ['/agenda/semana', 'dueño', 'vacío, carga, error, sin permiso, sin conexión'],
      ['/barberos', 'dueño', 'vacío, carga, error, sin permiso, sin conexión'],
    ],
  )
  const web = pantallasDe(seccion(leer('repos/web/semilla.md'), 'Experiencia'))
  assert.deepEqual(
    web.map((p) => [p.pantalla, p.ruta, p.rol]),
    [
      ['Inicio', '/', ''],
      ['Reservar', '/reservar', ''],
      ['Cancelar', '/cancelar/[codigo]', ''],
    ],
  )
  assert.deepEqual(pantallasDe('sin tabla'), [])
})

test('el registro y el glosario', () => {
  const r = leerRegistro(leer('registro.md'))
  assert.equal(r.size, 15)
  assert.deepEqual(r.get('B1'), {
    tema: 'Roles',
    decision: 'Cliente sin cuenta; barbero y dueño con cuenta',
    estado: 'cerrada',
  })
  assert.equal(terminosDe(seccion(leer('comun.md'), 'Glosario')), 3)
})

test('faltaAuditoria: de mediano para arriba pide «auditoría independiente: hecha» en ESTADO.md', () => {
  assert.equal(faltaAuditoria(null, ['chico', 'chico']), null)
  assert.equal(faltaAuditoria(null, ['chico', 'grande']), 'grande')
  assert.equal(faltaAuditoria('- Auditoría independiente: pendiente', ['mediano']), 'mediano')
  assert.equal(faltaAuditoria('- Auditoría independiente: hecha (2026-11-16)', ['escala']), null)
})

test('el CSS de lo común cumple el contrato de tokens del kit', () => {
  const tokens = readFileSync(join(KIT, 'design/tokens.css'), 'utf8')
  const cssKit = tokens.slice(tokens.indexOf('semilla:inicio'), tokens.indexOf('semilla:fin'))
  const css = cssDeLaSemilla(leer('comun.md'))
  assert.deepEqual(problemasDelCss(css, cssKit), [])
  const p = problemasDelCss(':root { --color-primario: red; --fondo: x; }', cssKit)
  assert.match(p[0] ?? '', /le faltan tokens del contrato del kit: .*--color-paper/)
  assert.match(p.join('\n'), /no trae el tema oscuro/)
  assert.throws(() => cssDeLaSemilla('## 5. Marca y sistema de diseño\n\nsin css'), /bloque ```css/)
})

test('los puertos del bloque 5 pasan al del repo, y nada más', () => {
  assert.equal(
    moverPuertos('port = 55321\nshadow = 55320\nhttp://localhost:8000 e2e 8210 id 4000-8000-x', 6),
    'port = 56321\nshadow = 56320\nhttp://localhost:9000 e2e 9210 id 4000-9000-x',
  )
})

test('los scopes salen de los módulos del plan del repo', () => {
  const plan = {
    carriles: [{ id: 'datos', dueno_de: ['supabase/', 'src/modules/turnos/infra/'] }],
    pasos: [{ modulos: ['src/modules/pagos/features/x/'] }],
  }
  assert.deepEqual(scopesDelPlan(plan), ['pagos', 'turnos'])
  assert.deepEqual(scopesDelPlan(null), [])
})

test('marcadoresSueltos nombra cada marcador que quedó y en qué archivo', () => {
  assert.deepEqual(
    marcadoresSueltos({ 'a.md': 'sin nada', 'b.yml': 'x {{PUERTOS_PILA}} y cambiar-slug' }),
    ['b.yml: {{PUERTOS_PILA}}', 'b.yml: cambiar-slug'],
  )
  // Los del orquestador no son del generador: los reemplaza orquestador.sh al armar cada prompt.
  assert.deepEqual(marcadoresSueltos({ 'tarea.md': '# Tarea {{ID}} — {{TITULO}}' }), [])
})
