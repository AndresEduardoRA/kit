---
# La tarea semanal del flujo del kit: la crea sola el orquestador (kit_semanal en kit.sh) con la etiqueta `kit` cuando `.kit/version`
# quedó atrás del main del kit en algún archivo de flujo, y reemplaza {{SEMANA}} por la semana (AAAA-Wss, ISO, UTC) y {{RAMA_SEMANA}}
# por la misma en minúsculas. `conflicto: flujo`: dos tareas de flujo no corren a la vez.
titulo: traer el flujo del kit ({{SEMANA}})
rama: chore/flujo-del-kit-{{RAMA_SEMANA}}
conflicto: flujo
nivel: normal
effort: high
---

## Pedido de la persona

«Una forma de llevar a los proyectos existentes una mejora del kit, sin tocar el código del producto.» Esta tarea la abre sola el
orquestador cuando el flujo de este repo quedó atrás del kit (`scripts/orquestador/README.md` › «La tarea semanal del flujo del kit»).

## Objetivo

El flujo de este repo al día con el main del kit (`.kit/version` en ese commit) y el CI de este repo en verde, sin tocar `src/`,
`supabase/` ni las dependencias.

## Decisiones ya tomadas

- Sólo `node scripts/kit/actualizar.mjs` (`docs/KIT.md` › «El flujo entre el kit y los proyectos»): baja el kit por GitHub y mezcla
  cada archivo de flujo. No uses la skill `feature` ni edites a mano un archivo de flujo para traer el kit.
- Sale con 0: ya commiteó `chore(kit): traer el flujo del kit <sha corto>`. Verifica y publica con ese mismo título.
- Sale con 3 (choques): no tocó nada. Termina con `RESULTADO: TRABADA — choques con el kit en: <las rutas que listó>`.
- Sale con 1: `RESULTADO: TRABADA — <la línea que dio>` (sin acceso al kit, un `.kit/version` que el kit no tiene, un commit que cayó).
- Dice «al día»: `RESULTADO: TRABADA — nada que traer: el flujo ya está al día` (la persona cierra el issue).
- Al retomar con la respuesta de la persona sobre un choque, por cada ruta: `--tomar-kit <ruta>` (la del kit), `--dejar <ruta>` (la de
  aquí, por esta vez) o una línea en `.kit/omitir` (nunca más, con su commit `chore(kit): omitir <ruta> del flujo del kit`). Después
  vuelve a correr `node scripts/kit/actualizar.mjs` con esas respuestas.
- Si la verificación cae por algo propio de este repo, adapta sólo el archivo de flujo que lo causa, en un commit aparte, y dilo en el
  PR. Si hace falta tocar `src/`, `supabase/` o una dependencia (`package.json` no es flujo): `RESULTADO: TRABADA — <qué y por qué>`.

## Anclajes

`scripts/kit/actualizar.mjs`, `scripts/kit/flujo.txt`, `.kit/version`, `.kit/omitir`, `docs/KIT.md`.

## Estados no felices

Al día → trabada a propósito · choques → trabada con las rutas, sin marcas en el repo · sin acceso al kit → trabada con el motivo · una
mejora del kit que pide una dependencia nueva → trabada.

## Verificación

`pnpm lint`, `pnpm typecheck`, `pnpm test` y `bash scripts/mapa.sh --check`. El resto lo decide el CI de este repo.
