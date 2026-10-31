-- El humo de la base: lo mínimo que tiene que estar después de aplicar las migraciones y el seed. Cada paso que crea tablas o RPC
-- agrega aquí (o en su propio archivo de supabase/tests/, sumado a la lista de scripts/probar-schema.mjs) sus casos, con un usuario
-- simulado por cada rol de la matriz RLS (`set local role authenticated` y `request.jwt.claim.sub`).

-- @test la migración base dejó _acotar_pagina
do $$
begin
  if public._acotar_pagina(null, 20, 50) <> 20 then
    raise exception '_acotar_pagina(null, 20, 50) no dio el por defecto';
  end if;
end $$;

-- @test auth.uid() lee el usuario simulado
do $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  if auth.uid() is distinct from '00000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'auth.uid() no devolvió el usuario simulado';
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
