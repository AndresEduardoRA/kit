---
name: revisar
description: Revisión adversarial del diff actual de {{NOMBRE}} contra las reglas del proyecto antes de commitear.
context: fork
model: sonnet
allowed-tools: Read, Grep, Glob, Bash
---

# /revisar

Revisa `git diff` y `git diff --staged` buscando lo que los lints **no** atrapan. No edites nada: reporta. Para cada hallazgo: archivo
y línea, qué está mal, por qué importa, severidad (bloquea / debería / menor).

Busca en este orden:

1. **Datos**: tabla sin RLS, policy sin `(select auth.uid())`, definer sin `set search_path = ''`, columna de policy sin índice,
   migración ya integrada editada, schema cambiado sin `pnpm db:types` ni prueba en `supabase/tests/`, `.update()` sobre una columna que
   otorga permisos (estado del flujo, dueño, visibilidad, borrado lógico), `count: 'exact'`, `offset` o lista sin tope.
2. **Permisos en UI**: `if (rol === …)`, acciones visibles que la RPC rechaza, algo que la matriz RLS de `docs/semilla/semilla.md` no deja
   ver a ese rol, montos sin el componente de montos, una columna sensible leída de la tabla en vez de su vista.
3. **Estados no felices**: pantallas sin vacío/error/sin permiso; `PT409` tratado como error genérico; destructivas sin deshacer ni
   confirmación según `docs/UX.md`; errores tragados; Zod ausente en una frontera.
4. **Contrato de módulo**: import a tripas de otro módulo, API pública que creció sin necesidad, dependencia nueva o ciclo (mira «Depende
   de» en `docs/MAPA.md` antes y después).
5. **Nombres**: términos fuera de `docs/GLOSARIO.md` o sinónimos de uno que sí está; textos fijos que nombran lo que el usuario
   configura (estados, categorías, tipos de documento: salen de la base).
6. **Memoria**: unidad nueva sin `CLAUDE.md`, ficha que ya no describe la unidad, un pendiente cerrado que sigue en
   `docs/PENDIENTES.md`, decisión no obvia sin su viñeta en `docs/DECISIONES.md`, historia en un doc en vez de la regla que resultó.

Termina con un veredicto de una línea: **listo para commitear** o **no todavía** y por qué.
