---
esquema: semilla-repo/v2
proyecto: turnero
rol: app
nombre: turnero-app
descripcion: Panel interno de la barbería y dueño de la base de turnos
version: 1
tamano: chico
tipo: interno
plataforma: web (escritorio primero, celular cuidado)
arquitectura: monolito modular del kit (src/modules + src/shared) con Supabase
stack:
  verificado_el: el día que se escribe la semilla, contra el package.json del kit
  base: el del kit
servicios: [Supabase, Vercel, Resend]
funciones_edge: []
---

# turnero-app

## 1. Alcance del repo

Panel para barberos y dueño: agenda del día y de la semana, barberos y sus horarios, bloqueos, marcar llegada o ausencia.
Es dueño de la base y publica el contrato `agenda-publica` (ver lo común). (A2, B1)

## 2. Roles y permisos

| Rol | Turnos | Barberos | Horarios | Informe |
|---|---|---|---|---|
| barbero | ver y marcar los suyos | ver | ver el suyo | no |
| dueño | todo | todo | todo | sí |
| anon (por el contrato) | reservar y cancelar con código | no | no | no |

## 3. Datos

- `barberos(id uuid, nombre text 2–60, activo bool)`.
- `horarios(barbero_id, dia_semana 1–7, desde time, hasta time)`; índice por barbero.
- `turnos(id, barbero_id, inicio timestamptz, nombre text 2–80, correo citext, estado reservado|llego|ausente|cancelado,
  codigo text único)`; índice `(barbero_id, inicio)`; único parcial por `(barbero_id, inicio)` cuando no está cancelado. (D1)
- Retención: los turnos cancelados se borran a los 90 días.

## 4. Seguridad

| Rol | Tabla | Acción | Resultado | Ejemplo |
|---|---|---|---|---|
| barbero | turnos | select de otro barbero | denegado | barbero A no ve turnos de B |
| dueño | turnos | update | permitido | marca ausente |
| anon | turnos | select | denegado | sólo por `publico.horas_libres` |
| anon | `publico.reservar_turno` | execute | permitido | reserva válida |

Datos personales: nombre y correo del cliente, sólo en `turnos`. Secretos: `SUPABASE_SECRET_KEY`, `RESEND_API_KEY` (sólo
nombres; van en Vercel). Amenaza: reservas falsas en masa → límite de 3 reservas por correo por día en la RPC.

## 5. Reglas de negocio y fórmulas

- Una hora libre es un tramo de 30 minutos del horario sin turno activo. Ejemplo: horario 09:00–11:00 con un turno a las
  09:30 deja libres 09:00, 10:00 y 10:30.
- Cancelar sólo hasta 2 horas antes. Ejemplo: turno a las 15:00, cancelar a las 13:10 sí; a las 13:01 no.

## 6. Experiencia

| Pantalla | Ruta | Rol | Contenido | Estados |
|---|---|---|---|---|
| Agenda del día | `/agenda` | barbero, dueño | turnos por barbero y hora | vacío, carga, error, sin permiso, sin conexión |
| Semana | `/agenda/semana` | dueño | grilla de 7 días | igual |
| Barberos | `/barberos` | dueño | lista y horario | igual |

Recorrido: el barbero entra con enlace mágico (F2), ve su día, toca un turno y marca «llegó».

## 7. Escala y rendimiento

Listas con cursor y tope de 50 en un solo punto; la agenda trae sólo el día pedido; sin conteos exactos. Volumen de prueba:
20.000 turnos. Presupuesto: agenda en 2 peticiones y 40 KB.

## 8. Sistema de diseño

Usa los tokens de lo común. Componentes: tarjeta de turno (reservado, llegó, ausente, cancelado), grilla de semana, chip
de estado.

## 9. Técnica

Módulos `src/modules/agenda/` y `src/modules/equipo/`. El contrato se genera con `pnpm contrato:generar` desde la base local
y se prueba con `pnpm contrato:probar`. CI por niveles del kit. Demo con 3 barberos y una semana de turnos.

## 10. Verificación

Nivel 1 en cada tarea; nivel 2 al tocar RLS, el esquema `publico` o el contrato; nivel 3 al cerrar la construcción. Nadie
prueba a mano: e2e o recorrido de la IA con capturas.

## 11. Plan de ejecución

P01 base y RLS (rojo) → P02 contrato `agenda-publica` v1 (rojo) → P03 agenda y P04 barberos en paralelo.

## 12. Riesgos y supuestos

Choque de reservas resuelto en la RPC (F1). Supuesto: una sola zona horaria, la de la barbería.
