#!/usr/bin/env bash
# Un `claude` falso para las pruebas del orquestador (prueba/maquina.ts): no habla con nadie. Anota en $CLAUDE_FALSO_LOG
# «inicio <ns> <pwd> <modelo> <pid>» y, al terminar, «fin <ns> <pid>»; según CLAUDE_FALSO_MODO:
#   trabada (por defecto)  duerme CLAUDE_FALSO_DUERME segundos y devuelve «RESULTADO: TRABADA …»
#   limite                 dice por stderr que llegó al límite del plan y sale con 1
#   identidad              devuelve un resultado con modelUsage, como `claude -p --output-format json`
set -uo pipefail
modelo=""
while [ $# -gt 0 ]; do
  case "$1" in
    --model) modelo=${2:-} && shift ;;
  esac
  shift
done
cat >/dev/null # el prompt
anotar() { [ -n "${CLAUDE_FALSO_LOG:-}" ] && printf '%s\n' "$*" >>"$CLAUDE_FALSO_LOG"; return 0; }
anotar "inicio $(date +%s%N) $PWD ${modelo:-?} $$"
case "${CLAUDE_FALSO_MODO:-trabada}" in
  limite)
    echo "Claude usage limit reached. Your limit will reset at 5pm." >&2
    anotar "fin $(date +%s%N) $$"
    exit 1
    ;;
  identidad)
    echo '{"type":"result","result":"Soy el modelo falso","modelUsage":{"modelo-falso":{}}}'
    ;;
  *)
    sleep "${CLAUDE_FALSO_DUERME:-1}"
    echo '{"type":"result","result":"RESULTADO: TRABADA prueba del claude falso","is_error":false}'
    ;;
esac
anotar "fin $(date +%s%N) $$"
