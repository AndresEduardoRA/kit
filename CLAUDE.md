@AGENTS.md

# Para Claude Code

Lo de arriba (`AGENTS.md`) son las reglas de todos los agentes. Esto es lo propio de Claude Code; si algo choca, manda `AGENTS.md`.

## Lo que se carga solo

- `.claude/rules/*.md` al tocar los archivos de su `paths:`; la ficha `CLAUDE.md` de cada unidad (`src/shared/CLAUDE.md`,
  `src/modules/<x>/CLAUDE.md`) al tocar sus archivos.
- Los hooks de `.claude/settings.json`: bloquean lo peligroso (`supabase` y el runner sueltos, `--no-verify`, leer `.env*`), lintean
  cada archivo que escribes y, al terminar, verifican lo que corresponde al estado del árbol (hook Stop). Si el hook Stop te
  devuelve un error, arréglalo: no lo esquives.

## Skills

- `/feature` — un caso de uso completo (capas, tests, ficha, glosario y mapa).
- `/revisar` — revisión adversarial del diff contra las reglas, antes de commitear.
- `/entregar` — cierra el trabajo: verificaciones, mapa, notas del paso y commit convencional (sin push).
- `/piloto` — lo usa el bucle del piloto (`scripts/piloto/bucle.sh`); `piloto-decidir` y `piloto-control`, sus sesiones de compuerta
  y de control. No los invoques a mano dentro de un paso.

## El piloto y los carriles

- Cada carril es un worktree con su stack (`.env.carril`) y corre los pasos que le entrega el coordinador
  (`node scripts/coordinador/coordinador.mjs siguiente <carril>`), uno por rama `<carril>/<paso>` y un PR por paso. `docs/KIT.md`
  explica el flujo; `piloto.config`, la configuración del proyecto.
- Lo que el piloto escribe vive en `.piloto/` (no se versiona). Una pregunta que sólo la persona puede responder es una compuerta
  (`.claude/skills/piloto/compuertas.md`), no una suposición.
- Los subagentes `planificador`, `revisor` y `auditor` (`.claude/agents/`) planifican, revisan y auditan; no editan.

## Antes de dar algo por terminado

Corre lo de «Terminado significa» de `AGENTS.md`. Lo que no corriste (un e2e sin Docker, por ejemplo) se dice en la bitácora del paso;
no se da por pasado.
