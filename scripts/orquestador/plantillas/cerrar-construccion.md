---
# El cierre de la construcción de un repo: semilla-a-repo (publicar-proyecto.mjs cola) lo crea como un issue `cola` más, después de
# los pasos del plan, y reemplaza {{REPO}} (el nombre del repo), {{VERSION}} (la `version` de su semilla) y {{DEPENDE}} (los T<n> de
# todos sus pasos). `al_integrar` es de K10: hasta entonces el orquestador no lo usa (spec-issue.mjs conserva las claves que no conoce).
titulo: cerrar la construcción de {{REPO}} (semilla v{{VERSION}})
rama: chore/cerrar-construccion
depende: {{DEPENDE}}
conflicto: docs
planificar: si
nivel: capaz
effort: high
al_integrar: etiquetar semilla-v{{VERSION}}
paso: cierre
---

## Pedido de la persona

«Cierre de construcción como paso explícito: la semilla se congela con una etiqueta y los docs de mantenimiento pasan a mandar.»
Es la última tarea de la cola de construcción de {{REPO}}.

## Objetivo

{{REPO}} queda en mantenimiento: la etiqueta `semilla-v{{VERSION}}` sobre el commit integrado, los docs de mantenimiento escritos, la
etapa cambiada en su manifiesto y una retro que alimenta las lecciones de las semillas.

## Decisiones ya tomadas

1. Comprueba que todos los issues de pasos (los que llevan `paso:` en su yaml) están `cola:integrada` u omitidos; si no, termina
   TRABADA con la lista.
2. Corre el nivel 3 en su carril (`pnpm test:e2e:completo` con los dos proyectos, `pnpm db:probar` y `pnpm db:carreras` si hay dinero
   o RLS y el proyecto lo tiene). Si algo cae, termina TRABADA con lo caído: no lo arregla en esta tarea.
3. Escribe `docs/ESTADO.md` (60 líneas como máximo), `docs/PENDIENTES.md` (de «Riesgos y supuestos» de la semilla y de las
   «Decisiones tomadas sin preguntar» de los PR integrados: `gh pr list --state merged`), `docs/DECISIONES.md` (el registro, por
   área, una viñeta por decisión con su ID) y `docs/LECCIONES.md` (las del kit más lo que agregaron los PR). `docs/FLUJO.md` ya está.
4. Saca `docs/semilla/` (queda en la etiqueta) y cambia en `.proyecto/proyecto.yaml` su repo a `etapa: mantenimiento` y
   `semilla: semilla-v{{VERSION}}`.
5. Pone en el cuerpo del PR una sección `## Retro`: las tareas trabadas y su motivo, las decisiones tomadas sin preguntar (con su
   PR), los pasos partidos o rehechos y, para cada una, «hueco de la semilla / defecto del kit / otro».

- La etiqueta `semilla-v{{VERSION}}` la crea el orquestador al integrar (`al_integrar`), no la sesión.

## Anclajes

`docs/semilla/`, `.proyecto/proyecto.yaml`, `docs/ESTADO.md`, `docs/PENDIENTES.md`, `docs/DECISIONES.md`, `docs/LECCIONES.md`.

## Estados no felices

Un paso sin integrar → TRABADA con la lista · el nivel 3 cae → TRABADA con lo caído · sin PR con «Decisiones tomadas sin preguntar»
→ la retro lo dice · la etiqueta ya existe → no se pisa; se avisa.

## Verificación

`pnpm test:e2e:completo` con los dos proyectos y `pnpm db:probar` — nivel 3 (`.claude/rules/e2e.md`). `docs/ESTADO.md` con 60 líneas
como máximo. Antes de publicar, la segunda lectura del agente `revisor` sobre el diff, y se atiende lo que encuentre.
