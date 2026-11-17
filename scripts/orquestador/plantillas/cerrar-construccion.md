---
# El cierre de la construcción de un repo: semilla-a-repo (publicar-proyecto.mjs cola) lo crea como un issue `cola` más, después de
# los pasos del plan, y reemplaza {{REPO}} (el nombre del repo), {{VERSION}} (la `version` de su semilla) y {{DEPENDE}} (los T<n> de
# todos sus pasos). `al_integrar` lo cumple el orquestador al integrar (al-integrar.sh): la etiqueta va sobre el último commit de main
# antes del PR, el que todavía tiene docs/semilla/.
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

{{REPO}} queda en mantenimiento: la etiqueta `semilla-v{{VERSION}}` sobre el último commit de main antes de este PR, los docs de
mantenimiento escritos, la etapa cambiada en su manifiesto y una retro que alimenta las lecciones de las semillas.

## Decisiones ya tomadas

Lo determinista lo hace `node scripts/flujo/cierre.mjs` (sale con 1 si falta algo, con 2 si GitHub no respondió); la sesión completa
lo que pide criterio.

1. `node scripts/flujo/cierre.mjs pasos --etiqueta semilla-v{{VERSION}}`: si nombra algún paso sin integrar, termina
   `RESULTADO: TRABADA — pasos sin integrar: <lista>`. Si dice que la etiqueta ya existe, dilo en el PR.
2. El nivel 3 en el carril: `pnpm test:e2e:completo` (escritorio y movil), `pnpm db:probar` y `pnpm db:carreras` si el proyecto lo
   tiene y hay dinero o RLS. Si algo cae, no commitees nada: termina TRABADA con lo caído (los specs o bloques y la carpeta de
   `e2e-fallos/`). No se arregla en esta tarea.
3. `node scripts/flujo/cierre.mjs aplicar --etiqueta semilla-v{{VERSION}}`: escribe `docs/DECISIONES.md` (el registro por área),
   `docs/PENDIENTES.md` (los riesgos y supuestos de la semilla y las «Decisiones tomadas sin preguntar» de los PR integrados) y el
   borrador de `docs/ESTADO.md`, suma «Para las semillas» a `docs/LECCIONES.md`, pasa el repo a `etapa: mantenimiento` y
   `semilla: semilla-v{{VERSION}}` en `.proyecto/proyecto.yaml` y saca `docs/semilla/`. Después completa cada «completar» de ESTADO
   (60 líneas como máximo; en «Verdes», el commit, la fecha y los números del nivel 3) y revisa PENDIENTES y DECISIONES: une los
   duplicados sin borrar un ID.
4. `node scripts/flujo/cierre.mjs retro > <archivo>` y clasifica cada línea («→ hueco de la semilla», «→ defecto del kit» o
   «→ otro»). Por cada «hueco de la semilla», una línea en `docs/LECCIONES.md` › «Para las semillas»:
   `- Haz/Evita X: porque Y; salió de T<n>. (semilla)`. Por cada «defecto del kit», una en su sección, terminada en `(kit)`.
5. Con `node scripts/flujo/cierre.mjs comprobar --etiqueta semilla-v{{VERSION}} --cuerpo <archivo del cuerpo del PR>` en verde, la
   segunda lectura del agente `revisor` sobre el diff, y se atiende lo que encuentre.
6. Dos commits: `docs(docs): escribir los docs de mantenimiento` y `chore(docs): sacar la semilla y pasar el repo a mantenimiento`.
   El PR se titula `chore(docs): cerrar la construcción (semilla-v{{VERSION}})` (así lo encuentran las lecciones de las semillas).
   Su cuerpo: lo que corrió del nivel 3, «Decisiones tomadas sin preguntar» y la sección `## Retro` clasificada.

- La etiqueta `semilla-v{{VERSION}}` la crea el orquestador al integrar (`al_integrar`). La sesión no crea etiquetas.

## Anclajes

`scripts/flujo/cierre.mjs`, `docs/semilla/`, `.proyecto/proyecto.yaml`, `docs/ESTADO.md`, `docs/PENDIENTES.md`, `docs/DECISIONES.md`,
`docs/LECCIONES.md`.

## Estados no felices

Un paso sin integrar → TRABADA con la lista · el nivel 3 cae → TRABADA con lo caído · GitHub no responde (salida 2) → se reintenta;
si sigue, TRABADA · sin PR con «Decisiones tomadas sin preguntar» → la retro lo dice · la etiqueta ya existe → no se pisa; se avisa.

## Verificación

El nivel 3 (`pnpm test:e2e:completo` con los dos proyectos y `pnpm db:probar`; `.claude/rules/e2e.md`), `cierre.mjs comprobar` en
verde y la segunda lectura del `revisor` antes de publicar.
