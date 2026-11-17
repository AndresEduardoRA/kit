# shellcheck shell=bash
# Lo que entra a la cola en los issues desde esta máquina (scripts/orquestador/README.md › «La cola en los issues»): la entrada
# (.orquestador/entrada/, donde dejan sus specs la skill que escribe tareas y `nueva`), la tarea mensual de dependencias y la
# adopción de las tareas locales de antes. Lo carga orquestador.sh con `source`, después de github.sh y cola-github.sh; lo llaman
# `espejo` en cada vuelta y el comando `entrada`.

# ------------------------------------------------------------------------------------------------------------------ entrada

# `.orquestador/entrada/<tema>.md` (sin id: lo escribe la skill de tareas o `nueva`) → un issue nuevo; la tarea pasa a la cola con el
# número del issue y se borra de la entrada. `entrada/respuesta-T<n>.md` → un comentario en el issue <n> (la respuesta a una trabada).
procesar_entrada() {
  local f
  [ -d "$DATOS/entrada" ] || return 0
  for f in "$DATOS/entrada"/*.md; do
    [ -e "$f" ] || continue
    case "$(basename "$f")" in
      respuesta-T[0-9]*.md) publicar_respuesta "$f" || return 1 ;;
      *) publicar_entrada "$f" || return 1 ;;
    esac
  done
}

publicar_entrada() { # archivo [etiquetas extra…] — deja en PUBLICADA el id de la tarea nueva
  local f=$1 err j rama otra cuerpo n id gen etiquetas=(cola "${@:2}")
  PUBLICADA=""
  [ -f "$f.error" ] && [ "$f.error" -nt "$f" ] && return 0
  err=$(mktemp)
  if ! j=$(node "$SPEC_ISSUE" a-issue "$f" 2>"$err"); then
    cp "$err" "$f.error"
    rm -f "$err"
    log "entrada/$(basename "$f"): no se publica: $(cat "$f.error") (arréglala: el motivo queda en $(basename "$f").error)"
    return 0
  fi
  rm -f "$err" "$f.error"
  rama=$(jq -r .rama <<<"$j")
  otra=$(tarea_con_rama "$rama" "" "") || otra=""
  { [ "$(jq -r .borrador <<<"$j")" = true ] || [ -n "$otra" ]; } && etiquetas+=(cola:borrador)
  [ "$(jq -r .urgente <<<"$j")" = true ] && etiquetas+=(cola:urgente)
  cuerpo=$(mktemp)
  jq -r .cuerpo <<<"$j" >"$cuerpo"
  n=$(crear_issue "$(jq -r .titulo <<<"$j")" "$cuerpo" "${etiquetas[@]}") || { rm -f "$cuerpo"; return 1; }
  id="T$n"
  gen=$(jq -n --argjson n "$n" --arg t "$(jq -r .titulo <<<"$j")" --rawfile b "$cuerpo" --arg l "${etiquetas[*]}" \
    '{number: $n, title: $t, body: $b, labels: ($l | split(" "))}' | node "$SPEC_ISSUE" de-issue)
  rm -f "$cuerpo"
  mkdir -p "$EST/$id"
  est_set "$id" issue "$n"
  escribir_spec "$id" "$gen"
  est_set "$id" issue_base "$(huella <<<"$gen")"
  rm -f "$f"
  PUBLICADA=$id
  log "$id: publicada desde entrada/$(basename "$f") → issue #$n"
  if [ -n "$otra" ]; then
    comentar "$id" "la rama \`$rama\` ya es de $otra: esta queda en borrador. Cambia la rama en el bloque yaml (o cierra una de las dos) y quita la etiqueta cola:borrador." >/dev/null
    est_set "$id" issue_rama_dup "$otra"
  fi
  return 0
}

publicar_respuesta() { # entrada/respuesta-T<n>.md → comentario (sin el prefijo del orquestador: es la respuesta de la persona)
  local f=$1 n
  n=$(basename "$f" .md)
  n=${n#respuesta-T}
  ghc api -X POST "repos/{owner}/{repo}/issues/$n/comments" -F body=@"$f" >/dev/null || return 1
  rm -f "$f"
  log "T$n: la respuesta de entrada/ quedó como comentario en el issue #$n"
}

# ------------------------------------------------------------------------------------------------- la tarea mensual de dependencias

# README.md › «La tarea mensual de dependencias»: si en el mes (UTC) no se creó ningún issue `deps` y no queda uno abierto de antes,
# la crea desde plantillas/dependencias.md y la publica con `cola` y `deps`. El mes resuelto queda en estado/.deps-mes: una llamada a
# la API al mes. La spec se arma en estado/, no en la entrada: si GitHub no responde, la entrada la publicaría sin `deps` y el mes
# siguiente no la vería. Apagada con DEPS_MENSUAL="no". Devuelve 1 si GitHub no respondió.
deps_del_mes() {
  [ "${DEPS_MENSUAL:-si}" = si ] || return 0
  local mes salida f
  mes=$(date -u +%Y-%m)
  [ "$(cat "$EST/.deps-mes" 2>/dev/null)" = "$mes" ] && return 0
  salida=$(ghc api --paginate "repos/{owner}/{repo}/issues?labels=deps&state=all&per_page=100") || return 1
  if jq -s -e --arg mes "$mes" '[add[]? | select(has("pull_request") | not)
      | select(.state == "open" or ((.created_at // "")[0:7] == $mes))] | length > 0' <<<"$salida" >/dev/null; then
    echo "$mes" >"$EST/.deps-mes"
    return 0
  fi
  f="$EST/dependencias-$mes.md"
  [ -e "$f" ] || sed "s/{{MES}}/$mes/g" "$ORQ/plantillas/dependencias.md" >"$f"
  publicar_entrada "$f" deps || return 1
  if [ -n "$PUBLICADA" ]; then
    echo "$mes" >"$EST/.deps-mes"
    log "$PUBLICADA: la tarea de dependencias de $mes, a la cola"
  elif [ -f "$f.error" ]; then
    # Una plantilla que no se lee es del repo: se dice una vez y no se reintenta hasta el mes siguiente.
    echo "$mes" >"$EST/.deps-mes"
    log "✗ la tarea de dependencias de $mes no se publica: plantillas/dependencias.md no se lee ($(cat "$f.error"))"
  fi
}

# ----------------------------------------------------------------------------------------------------------------- adopción

# Una tarea local sin issue (de antes de la cola en issues) se publica como issue y toma su número: su archivo, su estado y los
# `depende` que la nombran pasan a T<n>. Sólo las pendientes: las que ya empezaron terminan como locales.
adoptar() {
  local f id s j n nuevo cuerpo etiquetas texto g
  for f in "$COLA"/T*.md; do
    { [ -e "$f" ] && id_valido "$f"; } || continue
    id=$(campo "$f" id)
    [ -n "$(est_get "$id" issue)" ] && continue
    s=$(estado_de "$id")
    case "$s" in
      pendiente) ;;
      integrado | omitida) continue ;;
      *)
        [ -f "$EST/$id/adopcion-avisada" ] || { log "$id: sigue sólo local hasta terminar (está $s)"; touch "$EST/$id/adopcion-avisada"; }
        continue
        ;;
    esac
    j=$(node "$SPEC_ISSUE" a-issue "$f" 2>/dev/null) || { log "$id: no se adopta: la spec está rota"; continue; }
    etiquetas=(cola)
    [ "$(jq -r .borrador <<<"$j")" = true ] && etiquetas+=(cola:borrador)
    [ "$(jq -r .urgente <<<"$j")" = true ] && etiquetas+=(cola:urgente)
    cuerpo=$(mktemp)
    jq -r .cuerpo <<<"$j" >"$cuerpo"
    n=$(crear_issue "$(jq -r .titulo <<<"$j")" "$cuerpo" "${etiquetas[@]}") || { rm -f "$cuerpo"; return 1; }
    rm -f "$cuerpo"
    nuevo="T$n"
    if [ "$nuevo" != "$id" ]; then
      if spec_de "$nuevo" >/dev/null || [ -e "$EST/$nuevo" ]; then
        log "✗ $id: su issue es el #$n pero ya hay una $nuevo local: renombra una de las dos a mano"
        continue
      fi
      [ -d "$EST/$id" ] && mv "$EST/$id" "$EST/$nuevo"
      for g in "$COLA"/T*.md; do
        [ -e "$g" ] && sed -i -E "/^depende:/{s/ $id( |\$)/ $nuevo\\1/g;s/ $id( |\$)/ $nuevo\\1/g}" "$g"
      done
    fi
    texto=$(node "$SPEC_ISSUE" canon "$f" "$nuevo")
    rm -f "$f"
    mkdir -p "$EST/$nuevo"
    est_set "$nuevo" issue "$n"
    escribir_spec "$nuevo" "$texto"
    est_set "$nuevo" issue_base "$(huella <<<"$texto")"
    comentar "$nuevo" "adopté esta tarea de la cola local (era $id): desde ahora es $nuevo y este issue es su fuente de verdad." >/dev/null
    log "$id: adoptada como $nuevo (issue #$n)"
  done
}
