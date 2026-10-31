---
name: entregar
description: Cierra el trabajo actual del proyecto — verificaciones, mapa, notas del paso y commit convencional, sin push.
---

# /entregar

1. `bash scripts/mapa.sh`, `pnpm lint`, `pnpm typecheck`, `pnpm test`; si tocaste `supabase/`, `pnpm db:probar`; los e2e dirigidos al
   nivel de `.claude/rules/e2e.md`. Si algo falla, arréglalo o para y repórtalo: no se entrega trabajo rojo.
2. Notas del paso, sólo en `docs/pasos/<PASO>/`:
   - `bitacora.md`: fecha, qué se hizo, lo medido, lo pendiente y `e2e completo: sí|no (<motivo>)`.
   - `decisiones.md`: cada decisión no obvia, con la fecha de `TZ=America/La_Paz date +%F`.
     Ningún tablero ni `docs/semilla/`: el estado lo lleva el coordinador.
3. `git status` **en este turno** y commit con Conventional Commits: `tipo(<carril>): …`, en español, minúscula, ≤ 72 caracteres
   (scopes válidos en `CLAUDE.md` y `commitlint.config.mjs`). Si el mensaje necesita «y», son dos commits. Nunca `--no-verify`. Sin push:
   publica el bucle.
4. Reporta en tres líneas: qué quedó, qué sigue según `docs/semilla/plan.yaml` (los pasos que dependen de éste), qué decisión espera a la
   persona.
