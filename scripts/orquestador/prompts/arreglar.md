# Arreglar el PR #{{PR}} de la tarea {{ID}} — {{TITULO}}

Eres una sesión autónoma del orquestador de {{NOMBRE}}. **Nadie va a contestar preguntas.** El PR #{{PR}} (rama `{{RAMA}}`) no se
integró; el motivo está abajo. Trabajas en el worktree `{{WT}}`, que vuelve a ser un carril listo (Supabase propio, base reseteada).

Primero entiende el estado: `git log --oneline origin/main..HEAD`, `git status --short`, `gh pr view {{PR}} --json title,body,mergeable,statusCheckRollup`.

- **Choque con main:** `git fetch origin && git merge origin/main` (nunca rebase ni push forzado), resuelve conservando lo de las dos
  partes, commitea. Si una migración de esta rama quedó con fecha anterior a una ya integrada, créala de nuevo con
  `pnpm exec supabase migration new` y borra la vieja de la rama (el CI exige el orden). Después `pnpm db:reset`, `pnpm db:types`.
- **Rama puesta al día por el orquestador** (`gh pr update-branch`) y luego en rojo por el **orden de migraciones**: otra tarea
  integró antes una migración más nueva. Haz lo de arriba (migración nueva con fecha de hoy, la vieja fuera de la rama).
- **CI en rojo:** lee el log de lo que cayó (`gh run view <id> --log-failed`, sólo los jobs caídos), reproduce en local el mismo comando
  y arregla **la causa**. Cambiar una prueba sólo si la prueba está mal, y se justifica en el PR. Un e2e que falla a veces y otras no
  no se reintenta hasta que pase: diagnostica con sus artefactos (`e2e-fallos/`, la traza) y arregla el producto o la prueba con
  evidencia. Si lo que cae no tiene nada que ver con esta rama (también cae en `main`), no lo arregles aquí: `RESULTADO: TRABADA —`
  con el job y la evidencia.
- Verifica (Nivel 1): `pnpm lint`, `pnpm typecheck`, `pnpm test`, lo de base si tocaste `supabase/`, y los e2e que cayeron más los del
  módulo, nombrados.
- Publica de nuevo con `bash scripts/flujo/publicar.sh --sin-esperar --titulo '<el título actual del PR>'`. Agrega al cuerpo del PR
  (`gh pr edit` falla en este repo: `gh api -X PATCH 'repos/{owner}/{repo}/pulls/{{PR}}' -F body=@<archivo>`) qué cayó y cómo se arregló, en dos líneas.

No hagas: preguntar · empujar `main` o forzar · desactivar una regla de lint o un test · cambiar dependencias · tocar variables,
secretos, funciones, la base remota o Vercel de producción.

Tu última línea, siempre: `RESULTADO: PUBLICADO #{{PR}}` o `RESULTADO: TRABADA — <motivo>`.

---

## Motivo

{{MOTIVO}}

---

## Spec de la tarea (para tener el contexto)

{{SPEC}}
