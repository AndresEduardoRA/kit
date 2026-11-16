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
- `/entregar` — cierra el trabajo: verificación, docs, commits convencionales y el PR integrado con `scripts/flujo/publicar.sh`.

## El flujo de un PR y el orquestador

- Un cambio es una rama, un PR con auto-merge y el CI que decide (`docs/FLUJO.md`); una tanda de tareas que corre sola, el
  orquestador (`scripts/orquestador/README.md`). Lo de la máquina vive en `.orquestador/` (no se versiona).
- El subagente `revisor` (`.claude/agents/`) revisa; no edita.

## Antes de dar algo por terminado

Corre lo de «Terminado significa» de `AGENTS.md`. Lo que no corriste (un e2e sin Docker, por ejemplo) se dice en el cuerpo del PR;
no se da por pasado.
