-- Lo que postgres cree después en public nace sin lo que `authenticated` nunca necesita (.claude/rules/migraciones.md › Privilegios):
-- en tablas y vistas, truncate, references, trigger y maintain; en secuencias, select y update (le basta usage para el nextval de un
-- insert). La imagen de Supabase se los da por defecto y la base sólo se los quitaba a `anon`. Lo prueba
-- supabase/tests/privilegios-de-anon.sql.
alter default privileges for role postgres in schema public revoke truncate, references, trigger, maintain on tables from authenticated;
alter default privileges for role postgres in schema public revoke select, update on sequences from authenticated;
