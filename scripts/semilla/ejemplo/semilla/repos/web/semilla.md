---
esquema: semilla-repo/v2
proyecto: turnero
rol: web
nombre: turnero-web
descripcion: Web pública para ver horas libres y reservar un turno
version: 1
tamano: chico
tipo: sitio público
plataforma: web (celular primero)
arquitectura: monolito modular del kit, sin base propia; lee y escribe sólo por el contrato agenda-publica
stack:
  verificado_el: el día que se escribe la semilla, contra el package.json del kit
  base: el del kit
servicios: [Vercel]
funciones_edge: []
---

# turnero-web

## 1. Alcance del repo

Inicio con los servicios, reserva en tres pasos (barbero, hora, datos) y la página de cancelar con el código del correo.
No tiene base propia (C1).

## 2. Roles y permisos

Un solo rol: visitante anónimo. Puede ver horas libres, reservar y cancelar con su código. Nada más.

## 3. Datos

No guarda datos. Manda nombre y correo a `publico.reservar_turno` y no los conserva. Valida con Zod antes de mandar:
nombre de 2 a 80 caracteres, correo válido.

## 4. Seguridad

| Rol | Objeto | Acción | Resultado | Ejemplo |
|---|---|---|---|---|
| anon | `publico.horas_libres` | select | permitido | lista de horas |
| anon | `publico.reservar_turno` | execute | permitido | reserva válida |
| anon | `public.turnos` | select | denegado | no se lee directo |

Secretos: ninguno; sólo `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

## 5. Reglas de negocio y fórmulas

Las reglas viven en turnero-app. La web muestra el error del contrato tal cual llega. Ejemplo: PT409 → «Esa hora se acaba
de ocupar, elige otra».

## 6. Experiencia

| Pantalla | Ruta | Contenido | Estados |
|---|---|---|---|
| Inicio | `/` | servicios y botón reservar | carga, error |
| Reservar | `/reservar` | barbero → hora → datos | vacío (sin horas), carga, error, conflicto, sin conexión |
| Cancelar | `/cancelar/[codigo]` | confirmar cancelación | código inválido, fuera de plazo, hecho |

## 7. Escala y rendimiento

Horas libres de un día por vez, tope de 48 tramos. Presupuesto: reservar en 3 peticiones y 60 KB de JS.

## 8. Sistema de diseño

Tokens de lo común. Componentes: selector de barbero, grilla de horas, formulario de datos, confirmación.

## 9. Técnica

Módulo `src/modules/reserva/` con su `infra/` que llama sólo a lo que dice `.proyecto/contratos/agenda-publica@1.json`.
`pnpm contrato:usar` lo comprueba en CI. Los e2e usan un doble del contrato construido desde esa copia.

## 10. Verificación

Nivel 1 en cada tarea; nivel 2 si cambia la copia del contrato; nivel 3 al cerrar. Nadie prueba a mano.

## 11. Plan de ejecución

P01 copia del contrato y su prueba (espera a app:P02) → P02 reservar → P03 cancelar.

## 12. Riesgos y supuestos

Si app publica una v2, esta web sigue en v1 hasta su propia tarea de pasar a v2 (C3).
