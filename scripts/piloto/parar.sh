#!/usr/bin/env bash
# Para el piloto de ESTE carril.
#   parar.sh          pone `.piloto/PARAR`: el bucle se detiene entre pasos (el paso en curso termina)
#   parar.sh --ya     además manda SIGINT al paso en curso (cierra su turno) y lo deja en `en-curso.json` para retomarlo
#   parar.sh --todos  en la principal: PARAR en cada carril (<repo>.carriles/*) y cierra la sesión del coordinador
# Para quitar la parada: rm .piloto/PARAR y bash scripts/piloto/arrancar.sh.
set -uo pipefail
# shellcheck source=comun.sh
source "$(dirname "${BASH_SOURCE[0]}")/comun.sh"

if [ "${1:-}" = --todos ]; then
  for dir in "$(dirname "$RAIZ")/$(basename "$RAIZ").carriles"/*/; do
    [ -d "$dir" ] && (cd "$dir" && bash scripts/piloto/parar.sh "${2:-}")
  done
  tmux kill-session -t "$PROYECTO-coordinador" 2>/dev/null && echo "parar: coordinador cerrado."
  exit 0
fi

mkdir -p "$ESTADO"
touch "$ESTADO/PARAR"
echo "parar: $CARRIL: .piloto/PARAR puesto; el bucle se detiene entre pasos."
if [ "${1:-}" = --ya ]; then
  pid=$(jq -r '.pid // empty' "$ESTADO/en-curso.json" 2>/dev/null)
  [ -n "$pid" ] && kill -INT "$pid" 2>/dev/null && echo "parar: SIGINT al paso en curso (pid $pid); se retoma con arrancar.sh."
fi
