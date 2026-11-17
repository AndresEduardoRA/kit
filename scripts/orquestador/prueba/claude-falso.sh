#!/usr/bin/env bash
# Un `claude` falso para las pruebas del orquestador (prueba/maquina.ts, prueba/escenario.ts): no habla con nadie. Anota en
# $CLAUDE_FALSO_LOG «inicio <ns> <pwd> <modelo> <pid>» y, al terminar, «fin <ns> <pid>»; en $CLAUDE_FALSO_ARGS, una línea por llamada
# con el ORQ_PERMITE que recibió («(sin definir)» si no vino) y sus argumentos; en $CLAUDE_FALSO_PROMPT, el prompt de la última
# llamada; en $CLAUDE_FALSO_TMPDIR, «<TMPDIR> <cuántas entradas tenía>», y deja ahí un `sobrante` (lo que una prueba no borra).
# Según CLAUDE_FALSO_MODO:
#   trabada (por defecto)  duerme CLAUDE_FALSO_DUERME segundos y devuelve «RESULTADO: TRABADA …»
#   limite                 dice por stderr que llegó al límite del plan y sale con 1
#   identidad              devuelve un resultado con modelUsage, como `claude -p --output-format json`
#   salida                 devuelve como resultado el texto del archivo $CLAUDE_FALSO_SALIDA
set -uo pipefail
if [ -n "${CLAUDE_FALSO_ARGS:-}" ]; then
  printf 'ORQ_PERMITE=%s · %s\n' "${ORQ_PERMITE-(sin definir)}" "$*" >>"$CLAUDE_FALSO_ARGS"
fi
modelo=""
while [ $# -gt 0 ]; do
  case "$1" in
    --model) modelo=${2:-} && shift ;;
  esac
  shift
done
if [ -n "${CLAUDE_FALSO_TMPDIR:-}" ]; then
  printf '%s %s\n' "${TMPDIR-}" "$(find "${TMPDIR:-/no-existe}" -mindepth 1 2>/dev/null | wc -l)" >>"$CLAUDE_FALSO_TMPDIR"
  [ -n "${TMPDIR:-}" ] && touch "$TMPDIR/sobrante"
fi
if [ -n "${CLAUDE_FALSO_PROMPT:-}" ]; then cat >"$CLAUDE_FALSO_PROMPT"; else cat >/dev/null; fi
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
  salida)
    jq -cRs '{type: "result", result: ., is_error: false}' <"${CLAUDE_FALSO_SALIDA:?falta CLAUDE_FALSO_SALIDA}"
    ;;
  *)
    sleep "${CLAUDE_FALSO_DUERME:-1}"
    echo '{"type":"result","result":"RESULTADO: TRABADA prueba del claude falso","is_error":false}'
    ;;
esac
anotar "fin $(date +%s%N) $$"
