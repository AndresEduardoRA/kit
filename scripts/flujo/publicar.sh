#!/usr/bin/env bash
# Publica la rama actual como un PR que GitHub integra solo cuando el CI queda en verde (docs/FLUJO.md), y espera a verlo integrado.
#
#   bash scripts/flujo/publicar.sh [--titulo '<tipo(scope): descripción>'] [--cuerpo <archivo.md>] [--sin-esperar]
#
# 1. Comprueba: una rama que no es main, el árbol limpio y commits propios sobre origin/main.
# 2. El título del PR es el mensaje del commit que queda en main (squash): un commit convencional. Sin `--titulo` vale el asunto del
#    único commit de la rama; con más de uno hay que darlo. Lo valida commitlint, igual que el CI.
# 3. Empuja la rama (nunca fuerza), abre el PR (o le actualiza el título) y le enciende el auto-merge con squash. Si main exige la cola
#    de integración (cola_activa), con «Listo · todo en verde» el PR entra a ella, que lo prueba combinado con main y los PR de delante
#    y lo integra: nadie trae main a la rama y el orden de migraciones lo valida el CI del grupo.
#    Si esta misma punta ya se integró en un PR (se vuelve a correr tras un corte), no abre otro: lo dice y sale con 0.
# 4. Espera (hasta ESPERA_MAX s, 5400) a verlo integrado: integrado → vuelve a main al día (en un worktree, a origin/main suelto: main
#    es de la principal) y borra las ramas ya integradas; rojo → dice qué job cayó y sale con 1 (se arregla, se commitea y se vuelve a
#    correr). Sin la cola, atrasada respecto de main (otro PR se integró antes) → `PUT …/pulls/<n>/update-branch` y el CI vuelve a
#    correr, con el orden de migraciones contra el main nuevo. Con la cola, en verde → dice su puesto cuando cambia; la cola lo sacó
#    después de empezar esta corrida → el motivo, los jobs caídos del grupo y qué hacer, y sale con 1. `--sin-esperar` sale tras el 3.
# Sale con 64 si no hay qué publicar o falta algo; con 1 si el CI cayó o la cola lo sacó; con 75 si se agotó la espera (el PR sigue su
# curso solo).
# Se ubica por la carpeta del propio guion, no por la de quien lo corre: corrido desde `proyectos/` publica igual su repo.
set -euo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
# shellcheck source=scripts/flujo/cola-de-integracion.sh
source scripts/flujo/cola-de-integracion.sh
falta() { echo "✗ $1" >&2; exit 64; }

TITULO=""
CUERPO=""
ESPERAR=1
while [ "$#" -gt 0 ]; do
  case "$1" in
    --titulo) TITULO="${2:-}"; shift 2 ;;
    --cuerpo) CUERPO="${2:-}"; shift 2 ;;
    --sin-esperar) ESPERAR=0; shift ;;
    *) falta "opción desconocida: $1" ;;
  esac
done

RAMA=$(git symbolic-ref --quiet --short HEAD) || falta "HEAD suelto: publica desde una rama."
[ "$RAMA" != main ] || falta "estás en main: crea una rama (git switch -c <tipo>/<tema>) y commitea ahí."
[ -z "$(git status --porcelain)" ] || falta "hay cambios sin commitear: commitéalos o apártalos antes."
git fetch --quiet origin main
PROPIOS=$(git rev-list --count --no-merges origin/main..HEAD)
[ "$PROPIOS" -gt 0 ] || falta "la rama no tiene commits propios sobre origin/main."
if [ -z "$TITULO" ]; then
  [ "$PROPIOS" = 1 ] || falta "la rama tiene $PROPIOS commits: pasa --titulo '<tipo(scope): descripción>' (el commit que queda en main)."
  TITULO=$(git log --no-merges --format=%s -1 origin/main..HEAD)
fi
printf '%s\n' "$TITULO" | pnpm exec commitlint >/dev/null 2>&1 ||
  falta "el título «$TITULO» no es un commit convencional (commitlint.config.mjs: tipo(scope): descripción en minúscula, ≤ 72)."
[ -z "$CUERPO" ] || [ -f "$CUERPO" ] || falta "no existe el archivo del cuerpo: $CUERPO"

# La cuenta de GitHub es la dueña del repo, aunque la activa de la máquina sea otra: la del manifiesto (.proyecto/proyecto.yaml);
# sin manifiesto, la del remoto. Un manifiesto inválido corta aquí y dice qué campo.
DUENO=""
if [ -f .proyecto/proyecto.yaml ] && ! DUENO=$(node scripts/proyecto/manifiesto.mjs cuenta . 2>&1); then
  printf '%s\n' "$DUENO" >&2
  exit 64
fi
[ -n "$DUENO" ] || DUENO=$(git remote get-url origin | sed -nE 's#.*github\.com[:/]([^/]+)/.*#\1#p')
if [ -z "${GH_TOKEN:-}" ] && [ -n "$DUENO" ] && TOKEN=$(gh auth token --user "$DUENO" 2>/dev/null) && [ -n "$TOKEN" ]; then
  export GH_TOKEN="$TOKEN"
fi

# Integrado ya deja la rama como está: volver a main (o, en un worktree, a origin/main suelto, porque main es de la principal).
volver() {
  if [ "$(git rev-parse --path-format=absolute --git-dir)" = "$(git rev-parse --path-format=absolute --git-common-dir)" ]; then
    git switch --quiet main
    git pull --quiet --ff-only origin main
  else
    git fetch --quiet origin main
    git switch --quiet --detach origin/main
  fi
  node scripts/flujo/limpiar-ramas.mjs || true
}

# Esta misma punta ya se integró (se vuelve a correr tras un corte): no se abre otro PR con lo mismo.
YA=$(gh pr list --head "$RAMA" --state merged --json number,headRefOid \
  --jq "map(select(.headRefOid == \"$(git rev-parse HEAD)\")) | .[0].number // empty" 2>/dev/null || true)
if [ -n "$YA" ]; then
  echo "✓ PR #$YA ya integrado en main con esta misma punta: no hay nada que publicar."
  [ "$ESPERAR" = 1 ] && volver
  exit 0
fi

INICIO=$(date -u +%FT%TZ) # una salida de la cola de antes de esta corrida no cuenta
git push --quiet -u origin "$RAMA"
PR=$(gh pr view "$RAMA" --json number,state --jq 'select(.state == "OPEN") | .number' 2>/dev/null || true)
if [ -z "$PR" ]; then
  if [ -n "$CUERPO" ]; then
    gh pr create --base main --head "$RAMA" --title "$TITULO" --body-file "$CUERPO" >/dev/null
  else
    gh pr create --base main --head "$RAMA" --title "$TITULO" --body "$(git log --no-merges --reverse --format='- %s' origin/main..HEAD)" >/dev/null
  fi
  PR=$(gh pr view "$RAMA" --json number --jq .number)
  echo "✓ PR #$PR abierto: $TITULO"
else
  gh api -X PATCH "repos/{owner}/{repo}/pulls/$PR" -f title="$TITULO" >/dev/null
  echo "✓ PR #$PR actualizado: $TITULO"
fi
gh pr merge "$PR" --auto --squash >/dev/null ||
  falta "no se pudo encender el auto-merge del PR #$PR (¿«Allow auto-merge» y la protección de main? docs/FLUJO.md › «GitHub»)."
COLA=$(cola_activa)
if [ "$COLA" = true ]; then
  echo "✓ auto-merge encendido: en verde entra a la cola de integración, que lo prueba combinado con main y lo integra."
else
  echo "✓ auto-merge encendido: GitHub lo integra con «Listo · todo en verde»."
fi
[ "$ESPERAR" = 1 ] || exit 0

LIMITE=$(($(date +%s) + ${ESPERA_MAX:-5400}))
PUESTA=0
PUESTO=""
while :; do
  ESTADO=$(gh pr view "$PR" --json state,mergeable,mergeStateStatus,statusCheckRollup)
  case "$(jq -r .state <<<"$ESTADO")" in
    MERGED) break ;;
    CLOSED) echo "✗ el PR #$PR se cerró sin integrarse." >&2; exit 1 ;;
  esac
  if [ "$(jq -r .mergeable <<<"$ESTADO")" = CONFLICTING ]; then
    echo "✗ el PR #$PR choca con main: git merge origin/main, resuelve, commitea y vuelve a correr." >&2
    exit 1
  fi
  # main exige la rama al día (otro PR se integró antes): GitHub la pone al día con un merge, nunca fuerza; como mucho cada 10 min.
  # Con la cola de integración nadie trae main a la rama: el grupo la prueba combinada.
  if [ "$COLA" != true ] && [ "$(jq -r '.mergeStateStatus // ""' <<<"$ESTADO")" = BEHIND ] && [ "$(date +%s)" -ge "$PUESTA" ]; then
    # Por la API y no `gh pr update-branch`: ese subcomando no existe en el gh de algunas máquinas (2.46) y el fallo se tragaba en silencio.
    if gh api -X PUT "repos/{owner}/{repo}/pulls/$PR/update-branch" >/dev/null 2>&1; then
      echo "· main avanzó: rama puesta al día con un merge; el CI vuelve a correr."
    else
      echo "· main avanzó y no se pudo poner al día la rama (se reintenta en 10 min): gh api -X PUT repos/{owner}/{repo}/pulls/$PR/update-branch" >&2
    fi
    PUESTA=$(($(date +%s) + 600))
  fi
  LISTO=$(jq -r '[.statusCheckRollup[] | select(.__typename == "CheckRun" and (.name | startswith("Listo"))) | .conclusion] | last // ""' <<<"$ESTADO")
  if [ "$LISTO" = FAILURE ] || [ "$LISTO" = CANCELLED ]; then
    echo "✗ el CI del PR #$PR cayó:" >&2
    jq -r '.statusCheckRollup[] | select(.__typename == "CheckRun" and (.conclusion == "FAILURE" or .conclusion == "CANCELLED") and (.name | startswith("Listo") | not)) | "  · " + .name + "  " + (.detailsUrl // "")' <<<"$ESTADO" >&2
    echo "  El detalle: gh run view <id> --log-failed. Arréglalo, commitea y vuelve a correr este guion." >&2
    exit 1
  fi
  # En verde, con la cola: en ella (dice el puesto cuando cambia) o sacado después de empezar esta corrida. Sin respuesta, la vuelta siguiente.
  if [ "$COLA" = true ] && [ "$LISTO" = SUCCESS ] && EN_COLA=$(estado_en_la_cola "$PR"); then
    if [ "$(jq -r .enCola <<<"$EN_COLA")" = true ]; then
      P=$(jq -r '.puesto // "?"' <<<"$EN_COLA")
      [ "$P" = "$PUESTO" ] || echo "· en la cola de integración (puesto $P)"
      PUESTO=$P
    elif SALIDA=$(jq -re --arg desde "$INICIO" '.entrada as $e | .salida | select(. != null and .cuando > $desde and ($e == null or .cuando >= $e)) | .motivo' <<<"$EN_COLA"); then
      echo "✗ la cola de integración sacó el PR #$PR: ${SALIDA:-sin motivo de GitHub}" >&2
      CORRIDA=$(corrida_del_grupo "$PR" || true)
      if [ -n "$CORRIDA" ]; then
        { caidos_del_grupo "$CORRIDA" || true; } | while IFS=$'\t' read -r NOMBRE JOB _; do
          echo "  · $NOMBRE  gh run view --job $JOB --log-failed" >&2
        done
      fi
      echo "  Si es el orden de migraciones: créala de nuevo con \`pnpm exec supabase migration new\` y borra la vieja. Si no: git merge" >&2
      echo "  origin/main, reproduce, arregla, commitea y vuelve a correr este guion." >&2
      exit 1
    fi
  fi
  if [ "$(date +%s)" -ge "$LIMITE" ]; then
    echo "· el PR #$PR sigue esperando: se integra solo cuando termine en verde (gh pr view $PR)." >&2
    exit 75
  fi
  sleep "${ESPERA_PASO:-30}"
done

echo "✓ PR #$PR integrado en main."
volver
