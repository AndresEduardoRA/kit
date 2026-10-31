-- La base del kit: lo que todo proyecto necesita antes de su primera tabla. No se edita nunca
-- (scripts/guardas/orden-de-migraciones.test.ts fija su sha256): un cambio va en una migración nueva.

-- Privilegios por defecto (.claude/rules/migraciones.md › Privilegios): `anon` no toca `public`. Lo que se cree después en `public`
-- nace sin nada para `anon`; cada objeto nuevo da explícito lo que sí corresponde. Lo prueba supabase/tests/privilegios-de-anon.sql.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- El único ayudante de tamaño de página (.claude/rules/escala.md): toda RPC con un parámetro de tamaño (`p_tamano`, `p_tope`…) lo
-- acota con esto, nunca con `least(greatest(…))` a mano. Sin pedido, el por defecto; nunca menos de 1 ni más del máximo.
create or replace function public._acotar_pagina(p_pedido int, p_por_defecto int, p_maximo int)
returns int
language sql
immutable
parallel safe
set search_path = ''
as $$
  select least(greatest(coalesce(p_pedido, p_por_defecto), 1), p_maximo)
$$;

revoke all on function public._acotar_pagina(int, int, int) from public, anon;
grant execute on function public._acotar_pagina(int, int, int) to authenticated, service_role;
