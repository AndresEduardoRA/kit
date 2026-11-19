# shellcheck shell=bash
# Cambiar de máquina sin repetir trabajo (scripts/orquestador/README.md › «Cómo decide»). El estado de cada tarea es de la máquina
# (.orquestador/estado/), pero la cola vive en los issues: en una máquina nueva, o con el estado borrado, una tarea que otra máquina ya
# publicó se ve `pendiente`. Antes de lanzarla se mira GitHub y, si su PR ya existe, se adopta en vez de pagar una sesión que lo rehaga;
# mientras tanto, el espejo no le borra al issue la etiqueta de estado más avanzada. Lo carga orquestador.sh con `source`, después de
# github.sh; usa sus `EST`, `log`, `campo`, `spec_de`, `estado_de`, `est_*`, `integrada` y `comentar`.

# Sin rastro en esta máquina: nunca tuvo un estado aquí (cada cambio de estado lo escribe, y nada lo borra) ni se le conoce un PR. Se ve
# pendiente, pero puede ser de otra máquina. Una que volvió a pendiente aquí (reintentada, sin turno) sí tiene rastro.
sin_rastro() { [ ! -e "$EST/$1/estado" ] && [ ! -e "$EST/$1/pr" ]; }

# Las etiquetas del issue dicen que la tarea ya está más allá de pendiente (en otra máquina).
estado_avanzado_en() { [[ " $1 " =~ \ cola:(corriendo|esperando-ci|por-arreglar|trabada)\  ]]; }

# Antes de lanzar una tarea sin rastro: un PR de su rama abierto después de su issue (uno de antes es de otra tarea que usó ese nombre
# de rama). Abierto → la adopta (esperando_ci; la vigilancia del PR hace el resto); integrado → integrada. 0: se puede lanzar; 1: no se
# lanza en esta vuelta (la adoptó, ya estaba integrada o GitHub no respondió: nunca se lanza a ciegas).
mirar_otra_maquina() { # ID
  local id=$1 n rama j creado prs elegido pr estado
  if ! con_issues || ! sin_rastro "$id"; then return 0; fi
  n=$(est_get "$id" issue)
  [ -n "$n" ] || return 0
  rama=$(campo "$(spec_de "$id")" rama)
  if gh_en_espera || ! j=$(api_issue "$n") ||
    ! prs=$(ghc pr list --head "$rama" --state all --limit 30 --json number,state,createdAt); then
    if [ ! -e "$EST/$id/sin_github" ]; then
      est_set "$id" sin_github "$(ahora_utc)"
      log "$id: no pude preguntarle a GitHub si otra máquina ya publicó su PR ($(cat "$EST/.gh-ultimo-error" 2>/dev/null)): no la lanzo y vuelvo a mirar en la vuelta siguiente"
    fi
    return 1
  fi
  est_del "$id" sin_github
  creado=$(jq -r '.created_at // ""' <<<"$j")
  elegido=$(jq -r --arg c "$creado" '[.[] | select(.createdAt >= $c)]
    | (map(select(.state == "OPEN")) + map(select(.state == "MERGED")))[0] // empty | "\(.number) \(.state)"' <<<"$prs")
  [ -n "$elegido" ] || return 0
  read -r pr estado <<<"$elegido"
  est_set "$id" pr "$pr"
  if [ "$estado" = OPEN ]; then
    est_set "$id" estado esperando_ci
    log "$id: su rama $rama ya tiene el PR #$pr abierto (lo publicó otra máquina): lo adopto y espero al CI, sin lanzar sesión"
    comentar "$id" "adopté el PR #$pr que abrió otra máquina: no lanzo una sesión nueva y sigo su CI desde aquí." >/dev/null
  else
    log "$id: el PR #$pr de su rama $rama ya está integrado (lo publicó otra máquina): queda integrada, sin lanzar sesión"
    integrada "$id" "$pr"
  fi
  return 1
}

# Para `verificar`: las tareas cuyo issue está abierto con cola:corriendo o cola:esperando-ci y que aquí no tienen estado (las corre
# otra máquina, o las corrió). Nada si GitHub no responde.
tareas_de_otra_maquina() {
  local abiertos n
  abiertos=$(issues_abiertos) || return 0
  for n in $(jq -r '.[] | select(any(.labels[]?; (if type == "string" then . else .name end)
      | . == "cola:corriendo" or . == "cola:esperando-ci")) | .number' <<<"$abiertos"); do
    [ -e "$EST/T$n/estado" ] || echo "T$n"
  done
}
