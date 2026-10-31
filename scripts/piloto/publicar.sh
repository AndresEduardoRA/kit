#!/usr/bin/env bash
# Lo único que hace `git push` en el piloto, y sólo lo corre el bucle, nunca una sesión (con PILOTO=1 `bloquear-peligrosos.sh` le niega a
# una sesión todo push). Viene de importadora; en el kit cada paso es su propia rama y su propio PR (`<carril>/<paso>` contra main), y al
# final se le avisa al coordinador. Nunca integra: lo hace el coordinador (verdes y ámbar con el CI en verde) o la persona (rojos).
#
#   publicar.sh <paso> <HEAD de arranque>
#
# Se niega (exit 1, el motivo por stderr) si: la rama no es `<carril>/<paso>`; el árbol no está limpio; `origin/<rama>` tiene algo que
# HEAD no tiene (nunca se fuerza); o el rango agrega SQL de seguridad (policy, RLS, `security definer`, `grant`, `revoke`, Vault) sin
# `<común>/aprobado-<paso>`, que escribe el bucle cuando la persona aprueba la compuerta. Después `git push -u origin <rama>`; si la rama
# no tiene PR abierto, `gh pr create` contra main (con el riesgo en el cuerpo); si ya lo tiene (un arreglo de CI o de conflicto), un
# comentario. Al final `coordinador.mjs publicado <paso> <pr>`. Se prueba en `piloto.test.mjs`.
set -uo pipefail
# shellcheck source=comun.sh
source "$(dirname "${BASH_SOURCE[0]}")/comun.sh"
cd "$RAIZ" || exit 1

PASO="${1:-}"
DESDE="${2:-}"
[ -n "$PASO" ] && [ -n "$DESDE" ] || { echo "publicar: faltan el paso y el HEAD de arranque." >&2; exit 1; }
negar() {
  echo "publicar: $1" >&2
  exit 1
}

RAMA=$(git symbolic-ref --quiet --short HEAD)
ESPERADA="$CARRIL/$(printf '%s' "$PASO" | tr '[:upper:]' '[:lower:]')"
[ "$RAMA" = "$ESPERADA" ] || negar "el paso $PASO se publica desde la rama $ESPERADA, no desde «${RAMA:-HEAD suelto}»."
[ -z "$(git status --porcelain)" ] || negar "el árbol no está limpio."

if git ls-remote --exit-code --heads origin "$RAMA" >/dev/null 2>&1; then
  git fetch --quiet origin "$RAMA" || negar "git fetch origin $RAMA falló."
  git merge-base --is-ancestor FETCH_HEAD HEAD ||
    negar "origin/$RAMA tiene commits que HEAD no tiene (divergencia): se integra a mano, nunca se fuerza."
fi

SEGURIDAD='(create|alter|drop)[[:space:]]+policy|enable[[:space:]]+row[[:space:]]+level[[:space:]]+security|security[[:space:]]+definer|\bgrant\b|\brevoke\b|\bvault\b'
if git diff -U0 "$DESDE..HEAD" -- 'supabase/*.sql' | grep -E '^\+' | grep -vE '^\+\+\+' | grep -qiE "$SEGURIDAD"; then
  [ -f "$COMUN/aprobado-${PASO//[^A-Za-z0-9._-]/_}" ] ||
    negar "el rango agrega SQL de seguridad (policy, RLS, security definer, grant/revoke, Vault) sin la aprobación de la persona: falta aprobado-$PASO."
fi

git push --quiet -u origin "$RAMA" || negar "git push origin $RAMA falló."

PASO_JSON="$ESTADO/paso.json"
TITULO=$(jq -r '.titulo // ""' "$PASO_JSON" 2>/dev/null)
RIESGO=$(jq -r '.riesgo // "?"' "$PASO_JSON" 2>/dev/null)
CORTO=$(git rev-parse --short HEAD)
PR=$(gh pr list --head "$RAMA" --state open --json number 2>/dev/null | jq -r '.[0].number // empty' 2>/dev/null)
if [ -z "$PR" ]; then
  case "$RIESGO" in
    rojo) case ",${COORD_MERGE_AUTO:-verde,ambar}," in
        *,rojo,*) QUIEN="Es **rojo**, pero \`COORD_MERGE_AUTO\` incluye \`rojo\`: el coordinador lo integra solo cuando el CI esté en verde." ;;
        *) QUIEN="Es **rojo**: lo integras tú, en GitHub, después de revisar el diff." ;;
      esac ;;
    *) QUIEN="Es **$RIESGO**: el coordinador lo integra solo cuando el CI esté en verde (COORD_MERGE_AUTO)." ;;
  esac
  gh pr create --base main --head "$RAMA" --title "$PASO · $TITULO" --body "Paso $PASO del plan (carril \`$CARRIL\`), publicado por el piloto ($CORTO).

Lo verificó el bucle antes de publicar (lint, typecheck, test, el comando de terminado del plan y los e2e dirigidos). Notas del paso: \`docs/pasos/$PASO/\`.

$QUIEN" >/dev/null || negar "se empujó $RAMA, pero gh pr create falló."
  PR=$(gh pr list --head "$RAMA" --state open --json number 2>/dev/null | jq -r '.[0].number // empty' 2>/dev/null)
  [ -n "$PR" ] || negar "se abrió el PR de $RAMA, pero no pude leer su número."
else
  gh pr comment "$PR" --body "Paso $PASO: arreglo publicado ($CORTO)." >/dev/null || negar "se empujó $RAMA, pero no se pudo comentar el PR #$PR."
fi
coordinador publicado "$PASO" "$PR" >/dev/null || negar "el PR #$PR está abierto, pero el coordinador no lo anotó (coordinador.mjs publicado $PASO $PR)."
echo "publicar: $PASO en $RAMA ($CORTO), PR #$PR."
