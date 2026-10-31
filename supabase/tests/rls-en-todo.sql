-- Ninguna tabla de `public` sin RLS, después de aplicar todas las migraciones. En la base real lo dice también splinter
-- (`rls_disabled_in_public`, en el job `base` de CI).

-- @test ninguna tabla de public sin RLS
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1 loop
    raise exception 'Tabla sin RLS: public.%', t;
  end loop;
end $$;
