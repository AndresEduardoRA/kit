-- La base de ejemplo de las pruebas de scripts/contratos (PGlite): lo que dejaría la migración de un proveedor que expone el esquema
-- `agenda_publica`. Sin Supabase: los roles se crean aquí y los permisos se dan y se quitan explícitos, porque PGlite no trae los
-- privilegios por defecto de la imagen de Supabase (y una función nace con `execute` para PUBLIC).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema agenda_publica;
revoke all on schema agenda_publica from public;
grant usage on schema agenda_publica to anon, authenticated;

-- El enum lo usa la vista y el compuesto; el compuesto, sólo `franja_de` (así se prueba la inclusión transitiva). `sin_uso` no lo usa
-- nadie: no entra al contrato.
create type agenda_publica.estado as enum ('libre', 'tomado');
create type agenda_publica.franja as (inicio timestamptz, estado agenda_publica.estado);
create type agenda_publica.sin_uso as enum ('nada');

create table public.turnos_base (
  id uuid primary key,
  inicio timestamptz not null,
  estado agenda_publica.estado not null default 'libre',
  nota text
);
revoke all on public.turnos_base from public, anon, authenticated, service_role;

create view agenda_publica.turnos with (security_invoker = true) as
  select t.id, t.inicio, t.estado, t.nota from public.turnos_base t;
revoke all on agenda_publica.turnos from public;
grant select on agenda_publica.turnos to anon, authenticated;

create function agenda_publica.reservar(p_turno uuid, p_nota text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.turnos_base set estado = 'tomado', nota = p_nota where id = p_turno;
  return p_turno;
end
$$;
revoke all on function agenda_publica.reservar(uuid, text) from public;
grant execute on function agenda_publica.reservar(uuid, text) to authenticated, service_role;

create function agenda_publica.turnos_del_dia(p_dia date)
returns table (id uuid, inicio timestamptz)
language sql
stable
set search_path = ''
as $$
  select t.id, t.inicio from public.turnos_base t where t.inicio::date = p_dia order by t.inicio, t.id
$$;
revoke all on function agenda_publica.turnos_del_dia(date) from public;
grant execute on function agenda_publica.turnos_del_dia(date) to anon, authenticated, service_role;

create function agenda_publica.franja_de(p_turno uuid)
returns agenda_publica.franja
language sql
stable
set search_path = ''
as $$
  select row(t.inicio, t.estado)::agenda_publica.franja from public.turnos_base t where t.id = p_turno
$$;
revoke all on function agenda_publica.franja_de(uuid) from public;
grant execute on function agenda_publica.franja_de(uuid) to authenticated, service_role;
