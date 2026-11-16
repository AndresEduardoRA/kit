---
name: semilla-a-repo
description: En reescritura (K09): no se usa hasta entonces. Crearía un proyecto nuevo desde el kit y una semilla validada de idea-a-semilla.
argument-hint: '<slug>'
---

# /semilla-a-repo — en reescritura (K09)

**No uses esta skill hasta que K09 la reescriba.** La versión anterior armaba los carriles y el arranque del flujo que se quitó del kit
en K04 (`docs/KIT.md`), y ya no describe lo que un proyecto nuevo trae.

Si la persona pide crear un proyecto ahora, dilo y para. Lo que sí existe es la parte determinista, que se corre a mano:
`pnpm kit:nuevo <carpeta de la semilla> <carpeta destino> [--en-seco]` (`scripts/kit/nuevo-proyecto.mjs`; `docs/KIT.md` › «Crear un
proyecto» dice qué hace y qué reemplaza).
