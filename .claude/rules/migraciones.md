---
paths:
  - 'supabase/**/*.sql'
  - 'supabase/config.toml'
---

# Base de datos

La matriz RLS (quién lee y escribe cada tabla) está en `docs/semilla/semilla.md` › Seguridad. Una
policy que no sale de ahí es una pregunta, no una decisión del paso.

## Una sola fuente: las migraciones

- **Una migración que ya entró a `main` no se edita nunca.** Si un día se aplastan en una base, su
  sha256 lo fija una guarda (`scripts/guardas/orden-de-migraciones.test.ts`).
- Todo cambio es una migración nueva: `pnpm exec supabase migration new <nombre>` (fecha y hora
  reales, UTC). Si al integrar quedó antes de una que ya entró (otro carril se adelantó), se crea de
  nuevo con otra fecha.
- Cambiar una función: `create or replace` en la migración nueva, partiendo de su definición vigente
  (la última migración que la toca, no la primera). Renombrar es `alter … rename`.
- Un dato de catálogo (permiso, estado, bucket, job) va en su migración con `insert … on conflict`:
  la nube no vuelve a correr el seed. `seed.sql` es lo configurable por empresa y los ejemplos.
- Después de cualquier cambio: `pnpm db:reset`, `pnpm db:types` y `pnpm db:probar`; si tocaste
  policies, un caso en `supabase/tests/` con un usuario simulado por cada rol de la matriz.

## Privilegios

- **Una tabla, vista, secuencia o función nueva de `public` nace con todo para `authenticated` y
  `service_role`, y la función además con EXECUTE para PUBLIC** (privilegios por defecto). Todo objeto
  nuevo quita lo que no corresponde: `revoke all … from anon, authenticated` (y `public` en una
  función) y da explícito lo que sí. Una función que recrea una vista lo repite cada vez. Una prueba
  cae si `anon` o PUBLIC quedan con algo en `public`.
- Toda tabla nueva en `public`: `enable row level security`, el revoke, grants explícitos y una
  policy por operación `to authenticated`. `anon` sólo toca lo público que diga la matriz, mejor en
  su propio esquema. Una prueba falla si una tabla de `public` queda sin RLS.
- `security definer` = `set search_path = ''`, todo calificado con esquema, `revoke all … from
public, anon` y `grant execute` explícito.
- `(select auth.uid())`, nunca suelto; `(select public.tiene_permiso(...))` envuelto. Es InitPlan
  sólo si no nombra una columna de la fila: para acotar por un alcance, `col = any ((select
ids_con_alcance('x'))::uuid[])`. Se comprueba con `EXPLAIN` como `authenticated`.
- Un dato que sólo algunos leen **por fila** va en su tabla con la policy como regla, y la columna
  original pierde su grant. Una tabla con columnas que no lee todo el que lee la fila pierde el
  `select` de tabla y da `select (columnas)` (una columna nueva nace sin grant: dásela o no, a propósito).
- Lo que guarda dinero o una fórmula se escribe sólo por RPC `security definer`, con una prueba que
  falla si alguien concede escritura directa.
- Permiso nuevo = su fila en el catálogo de permisos en la misma migración que crea su punto de
  enforcement (policy o RPC); sin enforcement no hay permiso.

## Forma

- Índice en toda FK y en toda columna de una policy. Bajo RLS un operador no `leakproof` (`@>`,
  `ilike`) no usa su índice: un listado filtrado se apoya en un btree de su orden.
- Policies de la fila propia inline sobre columnas; una función `puede_*(id)` para tablas hijas. Una
  función STABLE no ve la fila recién insertada en `INSERT … RETURNING`.
- Conflicto de edición: `raise exception … using errcode = 'PT409'`, jamás `40001`. Un error de
  validación lleva en `hint` el campo. Los textos de `raise exception` siguen `docs/GLOSARIO.md`.
- Toda RPC de edición nace con `p_actualizado_en_esperado timestamptz` sin default y lo exige; las de
  crear no. Una de lote, por elemento. Una versión que debe moverse dos veces en una transacción no
  usa el trigger genérico: `greatest(clock_timestamp(), anterior + 1 µs)`.
- Un `if` de plpgsql termina en el primer `then`, también el de un `case`: esa condición va a una
  variable antes.
- Columna nueva con una ruta de storage = sumarla al refcount de storage; nunca `delete` sobre
  `storage.objects`, y a esa tabla sólo se le crean policies (nunca `alter table`).
- Una prueba de la base compara claves exactas y hojas (`jsonb_path_query`), nunca texto suelto en
  una respuesta con uuids o fechas.
