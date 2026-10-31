---
paths:
  - 'src/modules/*/infra/**'
  - 'src/shared/lib/supabase/**'
---

# Capa de datos

Qué tabla lee y escribe quién está en `docs/semilla/semilla.md` › Datos y › Seguridad (matriz RLS).

- Lecturas en `infra/queries/*.ts` con `import 'server-only'`; realtime y fetch del browser en
  `infra/*.client.ts` (`@/shared/lib/supabase/browser`). Nunca desde componentes.
- El cliente de servidor se crea por request (`createClient()` de `@/shared/lib/supabase/server`).
- El cliente admin (secret key) salta la RLS: sólo en route handlers públicos, webhooks y crons, y
  nunca lee tablas del negocio. El lint prohíbe importar `@/shared/lib/supabase/admin` desde otro
  archivo. Si hace falta `auth.admin` (invitar personas): una función que primero comprueba el permiso
  con el cliente de quien invita, entrega sólo `auth.admin` y no asigna el rol (eso va por RPC).
- Los tipos salen de `@/shared/types/database.types` (`pnpm db:types`), nunca escritos a mano.
- Una columna sensible que no ve todo el que ve la fila (un teléfono, un documento) se lee de su
  vista con la máscara, nunca de la tabla. Qué fuente lee un listado lo decide una función de
  `entities/`, no cada pantalla.
- Buscar por texto en una tabla grande va a una función de candidatos con su índice y luego se
  lee por ids. Una función `returns setof <vista>` nace sin `strict`, `set`, `security definer` ni
  `volatile` (así Postgres la alinea y la RLS de la vista aplica).
- Lo que otorga permisos o cambia de dueño se escribe **sólo por RPC**: el estado del flujo, el
  responsable, la visibilidad pública, el borrado lógico, `creado_por`, los accesos compartidos.
  Un `.update()` sobre una de esas columnas es un bug. Las tablas que se escriben sólo por RPC
  las nombra la matriz RLS de la semilla.
- Toda edición manda `p_actualizado_en_esperado` (o la versión de estado esperada) y trata `PT409`
  con `conflicto()` de `@/shared/lib/errores`. Una RPC de lote lleva `[{id, actualizado_en}]` y
  devuelve un resultado parcial con `codigo` y `motivo` por fila, que se muestra.
- Ninguna lectura toca un esquema interno (`interno`, `private`): sólo sus RPC.
- Una query de seguimiento sobre una página ya paginada se acota con `.in('id', ids)`.
- Uploads: fotos comprimidas en el navegador (y en los tamaños que pide la UI) y subidas por hash
  con la extensión de su `blob.type`; documentos sin comprimir.
- Borrar de Storage nunca es un `remove` directo: un objeto se quita sólo si quedó huérfano
  (refcount) o lo barre el recolector de la base. El navegador no borra lo compartido.
- Las claves de integraciones viven en Vault y las lee sólo una función `security definer`; nunca
  el cliente admin ni el navegador. Lo crudo de una API externa lo guarda la edge function.
- `revalidatePath` en la action que muta; sin `router.refresh()` en el éxito.
