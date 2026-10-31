-- @test escala: ninguna función de la app usa offset, y un conteo exacto lleva tope o su motivo
-- La regla de `.claude/rules/escala.md` en el SQL **vigente** (lo que hay en `pg_proc` y `pg_views`, no las migraciones viejas, que no
-- se editan): nada pagina con `offset`, y un `count(` que no está en una función o una vista con `limit` (el idioma de un conteo
-- acotado: `count(*)` sobre un subselect con `limit tope + 1`) figura abajo con su motivo y su tope. Una función nueva que cuente sin
-- tope rompe `pnpm db:probar`: se acota o se explica acá. Lo que lee una lista sin tope en una consulta lo vigilan las mediciones con
-- volumen.
do $$
declare
  -- Las excepciones, una por línea: ('<función o vista>', '<motivo y tope>'). Hoy ninguna.
  v_excepciones constant jsonb := coalesce((select jsonb_object_agg(f, m) from (values
    (null::text, null::text)
  ) t (f, m) where f is not null), '{}'::jsonb);
  v_malas text[];
  v_vivas text[];
begin
  -- Nada pagina con offset.
  select array_agg(n.nspname || '.' || p.proname) into v_malas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.prosrc ~* '\moffset\s+(\d|\$|p_|v_)';
  if v_malas is not null then
    raise exception 'escala: estas funciones paginan con offset (usa un cursor keyset): %', v_malas;
  end if;

  -- Un conteo exacto: la función (o vista) tiene un limit, o figura con su motivo.
  select array_agg(x.nombre) into v_malas from (
    select p.proname as nombre from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.prosrc ~* 'count\s*\(' and p.prosrc !~* '\mlimit\M'
    union
    select v.viewname from pg_views v
     where v.schemaname = 'public' and v.definition ~* 'count\s*\(' and v.definition !~* '\mlimit\M') x
   where not v_excepciones ? x.nombre;
  if v_malas is not null then
    raise exception 'escala: cuentan sin tope (cuenta sobre un subselect con limit tope + 1, o agrégala a supabase/tests/escala.sql con su motivo y su tope): %', v_malas;
  end if;

  -- Una excepción que ya no hace falta (la función se acotó o desapareció) se saca.
  select array_agg(e.key) into v_vivas from jsonb_each_text(v_excepciones) e
   where not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = e.key and p.prosrc ~* 'count\s*\(' and p.prosrc !~* '\mlimit\M')
     and not exists (
     select 1 from pg_views v
      where v.schemaname = 'public' and v.viewname = e.key and v.definition ~* 'count\s*\(' and v.definition !~* '\mlimit\M');
  if v_vivas is not null then
    raise exception 'escala: estas excepciones ya no coinciden con nada, sácalas: %', v_vivas;
  end if;
end $$;

-- @test escala: toda función que un cliente puede llamar con un tamaño de página lo acota con _acotar_pagina
-- Lo que la app (o quien le hable a PostgREST con una sesión) puede ejecutar y recibe un parámetro de tamaño (`p_tamano`, `p_tope`,
-- `p_limite`, `p_cantidad`, `p_primeros`…) acota **ese** parámetro con `_acotar_pagina(<parámetro>, por_defecto, máximo)`: el máximo
-- queda declarado en la base y a la vista, y nunca lo decide el cliente. Un `least(greatest(coalesce(p_x, …)))` escrito a mano también
-- falla. Las funciones de los jobs, que no puede ejecutar `authenticated` ni `anon`, no entran.
do $$
declare
  v_malas text[];
  v_a_mano text[];
begin
  select array_agg(n.nspname || '.' || p.proname || '(' || a || ')' order by p.proname) into v_malas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(p.proargnames) a
   where n.nspname = 'public' and p.prokind = 'f'
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
     and a ~ '^p_(tamano|tope|tope_total|limite|cantidad|limit|max|por_pagina|primeros)$'
     and p.prosrc !~* ('_acotar_pagina\(\s*' || a || '\s*,');
  if v_malas is not null then
    raise exception 'escala: estas funciones reciben un tamaño de página y no lo acotan con _acotar_pagina(parámetro, por_defecto, máximo): %', v_malas;
  end if;
  select array_agg(n.nspname || '.' || p.proname order by p.proname) into v_a_mano
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname <> '_acotar_pagina'
     and p.prosrc ~* 'least\s*\(\s*greatest\s*\(\s*coalesce\s*\(\s*p_(tamano|tope|tope_total|limite|cantidad|limit|max|por_pagina)\M';
  if v_a_mano is not null then
    raise exception 'escala: estas funciones acotan el tamaño a mano; usa _acotar_pagina: %', v_a_mano;
  end if;
end $$;

-- @test escala: _acotar_pagina vuelve a algo que vale lo que pida el cliente
do $$
declare
  c record;
begin
  for c in select * from (values
      (null::int, 20, 50, 20), (0, 20, 50, 1), (-1, 20, 50, 1), (-100000, 20, 50, 1), (1, 20, 50, 1),
      (7, 20, 50, 7), (30, 20, 50, 30), (50, 20, 50, 50), (51, 20, 50, 50), (100000, 20, 50, 50),
      (2147483647, 20, 50, 50), (null, 6, 51, 6), (100, 50, 100, 100), (101, 50, 100, 100)) t (pedido, defecto, maximo, esperado) loop
    if public._acotar_pagina(c.pedido, c.defecto, c.maximo) <> c.esperado then
      raise exception '_acotar_pagina(%, %, %) dio %, y se esperaba %', c.pedido, c.defecto, c.maximo,
        public._acotar_pagina(c.pedido, c.defecto, c.maximo), c.esperado;
    end if;
  end loop;
end $$;

-- @test escala: _acotar_pagina la ejecuta authenticated (la llaman sus RPC) y no anon
do $$
begin
  if not has_function_privilege('authenticated', 'public._acotar_pagina(int, int, int)', 'execute') then
    raise exception 'authenticated no puede ejecutar _acotar_pagina: las RPC que la llaman fallarían';
  end if;
  if has_function_privilege('anon', 'public._acotar_pagina(int, int, int)', 'execute') then
    raise exception 'anon puede ejecutar _acotar_pagina';
  end if;
end $$;
