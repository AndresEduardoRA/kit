# shellcheck shell=bash
# Lo que una tarea pide hacer cuando se integra (`al_integrar:` en su spec; scripts/orquestador/README.md › «Al integrar»). Hoy hay una
# sola acción: `etiquetar <nombre>`, que crea la etiqueta sobre el último commit de main antes del PR de la tarea (el padre de su
# squash: el PR del cierre de la construcción saca docs/semilla/, y la etiqueta tiene que conservarla). Con la cola de integración ese
# padre puede ser el squash de otro PR del mismo grupo: sigue siendo el último commit de main antes del de la tarea.
#
# `integrada` (orquestador.sh) la marca pendiente antes de dejar la tarea integrada y la intenta al final; si GitHub falla, el espejo
# (cola-github.sh) la reintenta, una vez cada AL_INTEGRAR_ESPERA segundos como mucho, hasta AL_INTEGRAR_MAX_FALLOS. Sin cola en los
# issues no hay espejo: el primer fallo ya avisa. Una etiqueta que ya existe en otro commit no se pisa: se avisa.
#
# El estado, en estado/<ID>/: `al_integrar` (pendiente | hecha | ya-existia | fallida), `al_integrar_fallos`, `al_integrar_intento`
# (epoch) y `al_integrar.md` (lo último que pasó). Lo carga orquestador.sh con `source`; usa sus `campo`, `spec_de`, `est_get`, `est_set`,
# `num`, `sumar`, `estado_de`, `ids`, `avisar` y `log`, y de github.sh `ghc`, `comentar`, `enlace_issue`, `con_issues` y `REPO_GH`.

AL_INTEGRAR_MAX_FALLOS=5
AL_INTEGRAR_ESPERA=300
# El mismo de NOMBRE_DE_ETIQUETA en spec-issue.mjs: el nombre se interpola en un filtro jq, y la cola sólo local no pasa por ahí.
AL_INTEGRAR_NOMBRE='^[A-Za-z0-9]+([._-][A-Za-z0-9]+)*$'

marcar_al_integrar() { # ID — antes de `estado integrado`: si el proceso muere entre medio, la acción queda pendiente
  local spec
  spec=$(spec_de "$1") || return 0
  [ -n "$(campo "$spec" al_integrar)" ] || return 0
  [ -z "$(est_get "$1" al_integrar)" ] || return 0
  est_set "$1" al_integrar pendiente
  est_set "$1" al_integrar_fallos 0
}

hacer_al_integrar() { # ID
  local id=$1 spec accion verbo arg resto
  [ "$(est_get "$id" al_integrar)" = pendiente ] || return 0
  AL_SHA="" # el «A mano» de un fallo no lleva el sha de otra tarea
  est_set "$id" al_integrar_intento "$(date +%s)"
  spec=$(spec_de "$id") || { al_integrar_fallo "$id" "su spec ya no está en la cola" final; return 0; }
  accion=$(campo "$spec" al_integrar)
  read -r verbo arg resto <<<"$accion"
  if [ "$verbo" = etiquetar ] && [ -n "$arg" ] && [ -z "$resto" ]; then
    etiquetar_integrada "$id" "$arg"
  else
    al_integrar_fallo "$id" "«$accion» no es una acción conocida (etiquetar <nombre>)" final
  fi
}

# Un `ghc` de la acción: la salida en AL_SALIDA. 0 bien; 1 GitHub falló; 2 el límite de la API (no cuenta como fallo).
al_gh() { AL_SALIDA=$(ghc "$@"); }
al_gh_fallo() { # ID qué-se-hacía rc
  if [ "$3" = 2 ]; then
    con_issues && return 0 # el espejo la reintenta cuando pase la espera
    al_integrar_fallo "$1" "$2: GitHub dio el límite de la API" final
    return 0
  fi
  al_integrar_fallo "$1" "$2: $(cat "$EST/.gh-ultimo-error" 2>/dev/null)"
}

etiquetar_integrada() { # ID nombre
  local id=$1 nombre=$2 pr integrado existente
  AL_SHA=""
  if [[ ! "$nombre" =~ $AL_INTEGRAR_NOMBRE ]] || [ "${#nombre}" -gt 100 ]; then
    al_integrar_fallo "$id" "«$nombre» no sirve como nombre de etiqueta" final
    return 0
  fi
  pr=$(est_get "$id" pr)
  [ -n "$pr" ] || { al_integrar_fallo "$id" "la tarea no tiene PR: no sé sobre qué commit va" final; return 0; }
  [ -n "$REPO_GH" ] || { al_integrar_fallo "$id" "el repo no tiene remoto de GitHub" final; return 0; }

  al_gh api "repos/{owner}/{repo}/pulls/$pr" --jq 'if .merged then .merge_commit_sha else "" end' ||
    { al_gh_fallo "$id" "no pude leer el PR #$pr" $?; return 0; }
  integrado=$AL_SALIDA
  [ -n "$integrado" ] || { al_integrar_fallo "$id" "GitHub no da el PR #$pr como integrado"; return 0; }
  al_gh api "repos/{owner}/{repo}/commits/$integrado" --jq '.parents[0].sha // ""' ||
    { al_gh_fallo "$id" "no pude leer el commit integrado ${integrado:0:7}" $?; return 0; }
  AL_SHA=$AL_SALIDA
  [ -n "$AL_SHA" ] || { al_integrar_fallo "$id" "el commit integrado ${integrado:0:7} no tiene padre"; return 0; }
  # matching-refs busca por prefijo (semilla-v1 trae semilla-v10): se filtra la ref exacta. Una anotada trae otro sha: no se pisa.
  al_gh api "repos/{owner}/{repo}/git/matching-refs/tags/$nombre" \
    --jq "[.[] | select(.ref == \"refs/tags/$nombre\")][0].object.sha // \"\"" ||
    { al_gh_fallo "$id" "no pude ver si la etiqueta $nombre ya existe" $?; return 0; }
  existente=$AL_SALIDA

  if [ "$existente" = "$AL_SHA" ]; then
    est_set "$id" al_integrar hecha
    log "$id: la etiqueta $nombre ya estaba sobre ${AL_SHA:0:7}"
    return 0
  fi
  if [ -n "$existente" ]; then
    est_set "$id" al_integrar ya-existia
    printf '%s · la etiqueta %s ya existe sobre %s; la que tocaba: %s\n' "$(date '+%F %T')" "$nombre" "$existente" "$AL_SHA" \
      >"$EST/$id/al_integrar.md"
    comentar "$id" "la etiqueta \`$nombre\` ya existe sobre ${existente:0:7}: no la piso. La que tocaba: ${AL_SHA:0:7}, el último commit de main antes del PR #$pr." >/dev/null
    avisar "$id: la etiqueta $nombre ya existe" "No la pisé (está sobre ${existente:0:7}; tocaba ${AL_SHA:0:7}, el último commit de main antes del PR #$pr)." \
      high warning "$(enlace_issue "$id")"
    return 0
  fi
  al_gh api -X POST "repos/{owner}/{repo}/git/refs" -f ref="refs/tags/$nombre" -f sha="$AL_SHA" --jq .ref ||
    { al_gh_fallo "$id" "no pude crear la etiqueta $nombre" $?; return 0; }
  est_set "$id" al_integrar hecha
  log "$id: etiqueté $nombre sobre ${AL_SHA:0:7}, el último commit de main antes del PR #$pr"
  comentar "$id" "etiqueté \`$nombre\` sobre ${AL_SHA:0:7}, el último commit de main antes del PR #$pr ✓" >/dev/null
}

al_integrar_fallo() { # ID motivo [final]
  local id=$1 motivo=$2 n accion nombre pr
  sumar "$id" al_integrar_fallos
  n=$(num "$id" al_integrar_fallos)
  accion=$(campo "$(spec_de "$id")" al_integrar 2>/dev/null)
  printf '%s · %s · intento %s: %s\n' "$(date '+%F %T')" "$accion" "$n" "$motivo" >"$EST/$id/al_integrar.md"
  if [ "${3:-}" != final ] && [ "$n" -lt "$AL_INTEGRAR_MAX_FALLOS" ] && con_issues; then
    log "$id: no pude $accion (intento $n de $AL_INTEGRAR_MAX_FALLOS): $motivo; se reintenta en el espejo"
    return 0
  fi
  est_set "$id" al_integrar fallida
  nombre=$(awk '{print $2}' <<<"$accion")
  pr=$(est_get "$id" pr)
  local a_mano="gh api -X POST repos/${REPO_GH:-<cuenta>/<repo>}/git/refs -f ref=refs/tags/$nombre -f sha=${AL_SHA:-<el padre del commit integrado del PR #$pr>}"
  # Un nombre que no vale no se ofrece como comando para pegar: va al texto de un issue.
  [[ "$nombre" =~ $AL_INTEGRAR_NOMBRE ]] || a_mano="corrige «al_integrar» en la spec (etiquetar <nombre>) y crea la etiqueta con gh api"
  echo "A mano: $a_mano" >>"$EST/$id/al_integrar.md"
  comentar "$id" "no pude $accion al integrar: $motivo. A mano: \`$a_mano\`" >/dev/null
  avisar "$id: no pude $accion al integrar" "$motivo. A mano: $a_mano" high warning "$(enlace_issue "$id")"
}

al_integrar_pendientes() { # el espejo (o el bucle, con la cola sólo local): las integradas cuya acción quedó pendiente, una vez cada AL_INTEGRAR_ESPERA
  local id ult ahora
  ahora=$(date +%s)
  for id in $(ids); do
    [ "$(estado_de "$id")" = integrado ] || continue
    [ "$(est_get "$id" al_integrar)" = pendiente ] || continue
    ult=$(est_get "$id" al_integrar_intento)
    [ $((ahora - ${ult:-0})) -ge "$AL_INTEGRAR_ESPERA" ] || continue
    hacer_al_integrar "$id"
  done
  return 0
}

linea_al_integrar() { # ID → el sufijo que muestra `plan`
  local accion
  accion=$(campo "$(spec_de "$1")" al_integrar 2>/dev/null)
  case "$(est_get "$1" al_integrar)" in
    pendiente) echo " · falta al integrar: $accion" ;;
    fallida) echo " · no se pudo al integrar: $accion (estado/$1/al_integrar.md)" ;;
    ya-existia) echo " · la etiqueta ya existía: no se pisó" ;;
  esac
  return 0
}
