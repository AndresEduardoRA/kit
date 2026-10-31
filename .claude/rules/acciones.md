---
paths:
  - 'src/modules/*/features/**/actions/**'
  - 'src/app/api/**'
---

# Server Actions y route handlers

- Toda action: `actionClient.inputSchema(schema).action(async ({ parsedInput, ctx }) => …)` de
  `@/shared/lib/safe-action`. El schema Zod vive en `../schemas/`, nunca inline. Zod en cada frontera:
  lo que entra por formulario, URL, webhook o respuesta externa se parsea antes de usarse.
- `actionClient` ya resuelve el usuario con `getClaims()` y sus permisos (`ctx.permisos`); una
  action sin usuario falla antes de ejecutar. Una action = un caso de uso.
- Verifica el permiso en la action con `puede(ctx.permisos, 'clave', alcance)` **y** deja que la
  base lo vuelva a verificar (RLS/RPC). La UI es comodidad; la base es la seguridad. Las claves y su
  alcance están en `docs/semilla/semilla.md` › Roles y permisos.
- Devuelve valores, no excepciones: `{ ok: true, data }` | `{ ok: false, error: { codigo, mensaje } }`.
  `PT409` → `codigo: 'conflicto'`; `42501` → `codigo: 'sin_permiso'`; `23505` → `codigo: 'duplicado'`.
  Ningún error se traga: o se devuelve con su código o se registra y se devuelve uno genérico.
- Después de mutar: `revalidatePath()` de la pantalla afectada (y `revalidateTag('x', 'max')`
  si hay caché por etiqueta). Nada de `redirect()` dentro de un `try`.
- Route handlers públicos (portal, webhooks, revalidación): validan el secreto o la cookie firmada
  con `jose` antes de cualquier lectura, usan el cliente admin sólo para la RPC pública que les toca,
  y nunca devuelven la ruta de storage: generan `createSignedUrl` de 60 s.
- Nada de trabajo largo en una action (importación masiva, envío masivo): encolar y procesar en
  `supabase/functions/`. Dos excepciones razonadas:
  - **Una API externa con clave**: la llamada vive en una edge function (que tiene la clave) y la
    hace el navegador con su sesión (`functions.invoke`), de a pocas y con resultado por línea; la
    action sólo guarda lo ya validado.
  - **Una importación desde el navegador**: lotes chicos, cada fila vale por sí misma y es idempotente
    por su id (el id lo genera el navegador). Medido en un proyecto anterior: lotes de 50 filas, ~50 ms
    cada uno.
