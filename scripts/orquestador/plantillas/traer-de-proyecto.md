---
# La tarea del kit que trae la mejora del flujo hecha en un proyecto: la crea el orquestador del proyecto al integrar un PR que toca
# flujo (avisar_al_kit en kit.sh), como un issue `cola` del kit, y reemplaza {{REPO_GH}} (cuenta/repo del proyecto), {{REPO}} (su
# nombre), {{PR}} (el número del PR), {{RUTAS}} (las rutas de flujo que tocó) y {{LECCIONES}} (sus líneas `(kit)` y `(semilla)`).
# `nivel: capaz`: lo que entra al kit llega a todos los proyectos.
titulo: traer de {{REPO}} el PR #{{PR}}
rama: feat/traer-{{REPO}}-pr-{{PR}}
conflicto: flujo
nivel: capaz
effort: high
---

## Pedido de la persona

«Una forma de llevar al kit una mejora del flujo hecha en un proyecto, sin tocar el código del producto.» Esta tarea la abrió sola el
orquestador de {{REPO}} al integrar su PR #{{PR}} (`scripts/orquestador/README.md` › «Lo que sube al kit»).

## Objetivo

Lo que el PR https://github.com/{{REPO_GH}}/pull/{{PR}} mejoró del flujo, generalizado para todos los proyectos y en el main del kit,
con el CI del kit en verde. Desde ahí llega a cada proyecto con su tarea semanal.

## Decisiones ya tomadas

- Con la skill `traer-de-proyecto` (`.claude/skills/traer-de-proyecto/SKILL.md`):
  `node scripts/kit/traer-de-proyecto.mjs {{REPO_GH}} {{PR}}` baja el PR por GitHub, se queda con las rutas de flujo y las aplica
  sobre el kit; la sesión generaliza los nombres a marcadores, prueba y publica.
- Sólo rutas de `scripts/kit/flujo.txt`: nada de `src/`, `supabase/`, `design/` ni de docs de producto, aunque el PR los toque.
- Las lecciones `(kit)` van a `docs/LECCIONES.md`, en su sección; las `(semilla)`, a `docs/semillas/LECCIONES.md` › «Sugerencias de
  los proyectos». Cada una igual, con `({{REPO}}, PR #{{PR}})` en lugar del sufijo.
- Lo que sólo sirve a {{REPO}} no se trae: se revierte y se dice en el PR.
- Si no queda nada que traer: `RESULTADO: TRABADA — nada que traer: <por qué>` (la persona cierra el issue).

## Anclajes

Las rutas de flujo que tocó el PR:

{{RUTAS}}

Las lecciones que subió:

{{LECCIONES}}

## Estados no felices

Un choque con el kit → se aplica a mano con las tres versiones que deja `traer-de-proyecto.mjs`, y si la intención no está clara,
trabada · un nombre de {{REPO}} sin generalizar → lo atrapa `traer-de-proyecto.mjs comprobar` · un archivo que el PR borró → por
decidir, se dice en el PR · una mejora que pide una dependencia nueva → trabada.

## Verificación

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:generador`,
`node scripts/kit/traer-de-proyecto.mjs comprobar --nombre {{REPO}} --slug <el slug de su manifiesto>` y `shellcheck` si se tocó bash.
