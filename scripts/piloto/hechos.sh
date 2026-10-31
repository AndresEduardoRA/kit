#!/usr/bin/env bash
# Los hechos de cada vuelta del bucle, sin modelo: un JSON por stdout (el bucle lo guarda en `.piloto/hechos.json`). El paso lee de aquí
# lo que necesitaría un comando. Viene de importadora; en el kit no lleva la cuenta de e2e de la bitácora (el nivel lo dice el plan y
# `nivel.mjs`) y las funciones edge que exige el e2e completo salen de PILOTO_FUNCIONES (piloto.config; vacío = ninguna).
#
# hora (La Paz), carril, rama, head, origin_main, arbol_limpio, disco_pct, candado {libre, dueno}, ci (el último de la rama, o null),
# ultimo, en_curso, paso (.piloto/paso.json: lo que entregó el coordinador), fallas_seguidas, funciones, autoelecciones (las compuertas
# ámbar que el bucle eligió solo y el paso tiene que anotar) y decision (el texto de la decisión vigente, hasta 8.000 B).
set -uo pipefail
# shellcheck source=comun.sh
source "$(dirname "${BASH_SOURCE[0]}")/comun.sh"
cd "$RAIZ" || exit 1
# shellcheck source=../lib/carril.sh
[ -f "$RAIZ/scripts/lib/carril.sh" ] && source "$RAIZ/scripts/lib/carril.sh"

HORA=$(ahora_lapaz)
RAMA=$(git symbolic-ref --quiet --short HEAD || echo "")
HEAD_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
ORIGIN=$(git rev-parse --verify --quiet origin/main 2>/dev/null || echo "")
[ -z "$(git status --porcelain 2>/dev/null)" ] && LIMPIO=true || LIMPIO=false
DISCO=$(df --output=pcent / 2>/dev/null | tail -n 1 | tr -dc '0-9')

DIR_CANDADO="${CANDADO_DIR:-$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)}"
LIBRE=true
DUENO=""
CANDADO="$DIR_CANDADO/candado-base-${SUPABASE_DB_PORT:-principal}"
if [ -e "$CANDADO.lock" ] && ! flock -n "$CANDADO.lock" true 2>/dev/null; then
  LIBRE=false
  DUENO=$(tr '\n' ';' <"$CANDADO.info" 2>/dev/null)
fi

CI=$(timeout 20 gh run list --branch "${RAMA:-main}" --limit 1 --json databaseId,status,conclusion,headSha,displayTitle 2>/dev/null | jq -c '.[0] // null' 2>/dev/null)
[ -n "$CI" ] || CI=null

URL_SUPABASE="${PILOTO_SUPABASE_URL:-}"
servida() {
  local codigo intento
  [ -n "$URL_SUPABASE" ] || return 1
  for intento in 1 2; do
    codigo=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS --max-time 2 "$URL_SUPABASE/functions/v1/$1" 2>/dev/null)
    [[ "$codigo" =~ ^[1-4][0-9][0-9]$ ]] && [ "$codigo" != 404 ] && return 0
  done
  return 1
}
FUNCIONES='{}'
for funcion in ${PILOTO_FUNCIONES:-}; do
  servida "$funcion" && valor=true || valor=false
  FUNCIONES=$(jq -c --arg f "$funcion" --argjson v "$valor" '.[$f] = $v' <<<"$FUNCIONES")
done

FALLAS=$(cat "$ESTADO/fallas" 2>/dev/null)
AUTO=""
[ -s "$ESTADO/autoelecciones.md" ] && AUTO=$(tail -c 4000 "$ESTADO/autoelecciones.md")

DECISION=""
if [ -s "$COMUN/compuerta.md" ] && [ -s "$COMUN/decision.md" ]; then
  ID_C=$(sed -n 's/^id: *//p' "$COMUN/compuerta.md" | head -n 1)
  ID_D=$(sed -n 's/^id: *//p' "$COMUN/decision.md" | head -n 1)
  [ -n "$ID_C" ] && [ "$ID_C" = "$ID_D" ] && DECISION=$(head -c 8000 "$COMUN/decision.md")
fi

jq -n \
  --arg hora "$HORA" --arg carril "$CARRIL" --arg rama "$RAMA" --arg head "$HEAD_SHA" --arg origin "$ORIGIN" \
  --argjson limpio "$LIMPIO" --arg disco "$DISCO" --argjson libre "$LIBRE" --arg dueno "$DUENO" --argjson ci "$CI" \
  --argjson ultimo "$(json_o_null "$ESTADO/ultimo.json")" --argjson en_curso "$(json_o_null "$ESTADO/en-curso.json")" \
  --argjson paso "$(json_o_null "$ESTADO/paso.json")" --arg fallas "${FALLAS:-0}" --arg auto "$AUTO" \
  --arg decision "$DECISION" --argjson funciones "$FUNCIONES" '{
    hora: $hora,
    carril: $carril,
    rama: $rama,
    head: $head,
    origin_main: (if $origin == "" then null else $origin end),
    arbol_limpio: $limpio,
    disco_pct: (if $disco == "" then null else ($disco | tonumber) end),
    candado: { libre: $libre, dueno: (if $dueno == "" then null else $dueno end) },
    ci: $ci,
    ultimo: $ultimo,
    en_curso: $en_curso,
    paso: $paso,
    fallas_seguidas: ($fallas | tonumber? // 0),
    funciones: $funciones,
    autoelecciones: (if $auto == "" then null else $auto end),
    decision: (if $decision == "" then null else $decision end)
  }'
