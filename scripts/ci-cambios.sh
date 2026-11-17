#!/usr/bin/env bash
# Decide qué jobs pesados de CI corren (`.github/workflows/ci.yml`, job `cambios`). Imprime cuatro líneas para $GITHUB_OUTPUT:
#
#   pesado=true|false        la base (`base`): el cambio toca código, base, e2e, scripts o la configuración que los mueve
#   e2e=true|false           el e2e en bloques: pesado y, además, el evento lo pide (pull_request, schedule y workflow_dispatch; no push)
#   contrato=true|false      el proveedor (`contrato`): toca la base, sus contratos, los scripts de contratos o el manifiesto
#   contrato_uso=true|false  el consumidor (`contrato-uso`): toca las copias fijadas, el manifiesto, algún `infra/`, los tipos de los
#                            contratos o sus scripts (.claude/rules/contratos.md)
#
# `schedule` (el completo de cada noche sobre main) corre sólo si main tuvo commits en las últimas 25 horas.
#
# Entradas (variables): EVENTO (push | pull_request | workflow_dispatch), ANTES (`github.event.before`), BASE_PR
# (`github.event.pull_request.base.sha`) y DESPUES (por defecto HEAD). La razón va a stderr, para el log del job.
#
# Ante la duda corre todo: sin commit de comparación (push de una rama nueva, `before` en ceros), con un commit que el clon no
# tiene (un clon superficial: el job pide `fetch-depth: 0`; un push forzado) o si `git diff` falla. En esos caminos (y en la noche)
# los dos de contratos valen lo mismo que `pesado`.
# Se prueba en `scripts/ci-cambios.test.ts`.
set -uo pipefail

PATRON='^(src/|supabase/|e2e/|scripts/|\.github/|package\.json$|pnpm-lock\.yaml$|playwright\.config\.ts$|next\.config\.ts$)'
PATRON_CONTRATO='^(supabase/|contratos/|scripts/contratos/|\.proyecto/proyecto\.yaml$)'
PATRON_CONTRATO_USO='^(\.proyecto/contratos/|\.proyecto/proyecto\.yaml$|src/(.+/)?infra/|src/shared/types/contratos/|scripts/contratos/)'
CEROS=0000000000000000000000000000000000000000
EVENTO="${EVENTO:-}"

# salir <pesado> <motivo> [<contrato> <contrato_uso>]: sin los dos últimos, valen lo mismo que <pesado>.
salir() {
  local pesado="$1" motivo="$2" contrato="${3:-$1}" contrato_uso="${4:-$1}" e2e=false
  # El disparo del e2e: cambiar esta línea es cambiar cuándo se gastan sus minutos (`docs/DECISIONES.md`, «CI-1»).
  if [ "$pesado" = true ] && [ "$EVENTO" != push ]; then e2e=true; fi
  echo "pesado=$pesado"
  echo "e2e=$e2e"
  echo "contrato=$contrato"
  echo "contrato_uso=$contrato_uso"
  echo "cambios: pesado=$pesado e2e=$e2e contrato=$contrato contrato_uso=$contrato_uso ($motivo)" >&2
  exit 0
}

# ¿Algún archivo de la lista calza con el patrón? true o false.
toca() { if grep -qE "$1" <<< "$2"; then echo true; else echo false; fi; }

case "$EVENTO" in
  schedule)
    if [ -n "$(git log -1 --since='25 hours ago' --format=%H 2>/dev/null)" ]; then
      salir true "la noche: main tuvo commits en las últimas 25 h"
    fi
    salir false "la noche: main no tuvo commits en las últimas 25 h"
    ;;
  push) desde="${ANTES:-}" ;;
  pull_request) desde="${BASE_PR:-}" ;;
  *) salir true "evento «${EVENTO:-ninguno}»: corre todo" ;;
esac
hasta="${DESPUES:-HEAD}"

if [ -z "$desde" ] || [ "$desde" = "$CEROS" ]; then
  salir true "sin commit de comparación"
fi
if ! git cat-file -e "${desde}^{commit}" 2>/dev/null; then
  salir true "el clon no tiene ${desde:0:12} (¿superficial o push forzado?)"
fi

if ! archivos=$(git diff --name-only "${desde}...${hasta}" 2>/dev/null); then
  salir true "git diff ${desde:0:12}...${hasta} falló"
fi
tocados=$(grep -cE "$PATRON" <<< "$archivos" || true)
contrato=$(toca "$PATRON_CONTRATO" "$archivos")
contrato_uso=$(toca "$PATRON_CONTRATO_USO" "$archivos")
if [ "$tocados" -gt 0 ]; then
  salir true "$tocados archivos de código, base, e2e, scripts o configuración" "$contrato" "$contrato_uso"
fi
salir false "ni código, ni base, ni e2e, ni scripts, ni configuración" "$contrato" "$contrato_uso"
