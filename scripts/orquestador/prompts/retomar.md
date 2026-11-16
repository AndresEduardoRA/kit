# Retomas una tarea a medias

{{MOTIVO_RETOMAR}}

Antes de escribir nada, mira qué quedó hecho en la rama: `git log --oneline origin/main..HEAD`, `git status --short` y `git diff --stat`,
y si ya hay PR, `gh pr view --json number,state,title,body`. No rehagas lo que ya está bien: sigue desde ahí hasta dejar la tarea
terminada y publicada según lo de abajo. Si hay cambios sin commitear que no sabes de dónde salen, revísalos: si sirven, commitéalos;
si no, déjalos fuera con `git stash` y dilo en el PR.
