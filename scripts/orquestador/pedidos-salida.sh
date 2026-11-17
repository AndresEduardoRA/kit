# shellcheck shell=bash
# Lo que hace el orquestador con lo que devolvió la redacción de un pedido (pedidos.sh, README.md › «Un pedido desde el celular»):
# `SPEC:` → el issue pasa a ser la spec; `PREGUNTAS:` → el comentario de la ronda y cola:pregunta; la tercera que pregunta, una salida
# rota o una spec que no se lee → cola:trabada. Siempre sobre el issue releído. Lo carga orquestador.sh con `source`, después de
# pedidos.sh; usa sus `N`, `ID`, `RONDAS_MAX`, `REDACCION`, `RESULTADO_TEXTO`, `por_redactar` y `etiquetas_del_pedido`.

aplicar_redaccion() { # ronda — lo que devolvió la sesión, sobre el issue releído
  local s tipo texto j
  s=$(node "$REDACCION" salida <<<"$RESULTADO_TEXTO")
  tipo=$(jq -r .tipo <<<"$s")
  texto=$(jq -r .texto <<<"$s")
  if ! j=$(api_issue "$N"); then
    est_set "$ID" estado ""
    log "$ID: GitHub no respondió al aplicar la redacción: se redacta otra vez"
    return
  fi
  if ! por_redactar "$j"; then
    est_set "$ID" estado hecho
    log "$ID: el pedido #$N se cerró o dejó de ser un pedido mientras se redactaba: descarto la salida"
    return
  fi
  est_del "$ID" fallos
  case "$tipo" in
    spec) aplicar_spec "$j" "$texto" ;;
    preguntas)
      if [ "$1" -gt "$RONDAS_MAX" ]; then
        trabar_pedido "después de dos rondas de preguntas la redacción sigue preguntando:

$texto" "$j"
      else
        aplicar_preguntas "$j" "$texto" "$1"
      fi
      ;;
    *) trabar_pedido "la redacción no terminó en «SPEC:» ni en «PREGUNTAS:» (lo último que dijo: «$(tail -c 300 <<<"$RESULTADO_TEXTO" | tr '\n' ' ')»)" "$j" ;;
  esac
}

aplicar_spec() { # json texto — el cuerpo y el título primero (el espejo no debe ver `cola` con el pedido viejo), las etiquetas después
  local j=$1 f err gen titulo
  f=$(mktemp) && err=$(mktemp)
  printf '%s\n' "$2" >"$f"
  if ! gen=$(jq -n --argjson n "$N" --rawfile b "$f" '{number: $n, body: $b, labels: []}' | node "$SPEC_ISSUE" de-issue 2>"$err"); then
    trabar_pedido "la spec que escribió la redacción no se lee: $(head -c 300 "$err")" "$j"
  elif grep -qE '^(permite|al_integrar):' <<<"$gen"; then
    # Un permiso o una acción al integrar (una escritura en el repo) los da la persona en el issue, nunca una sesión: el pedido y el
    # repo que lee la redacción son texto de afuera.
    trabar_pedido "la spec que escribió la redacción pide «$(grep -m1 -E '^(permite|al_integrar):' <<<"$gen")»: un permiso o una acción al integrar lo da la persona. Si de verdad hace falta, escríbelo tú en el bloque yaml" "$j"
  elif [ "${#2}" -gt 60000 ]; then
    trabar_pedido "la spec que escribió la redacción pasa de 60.000 caracteres (GitHub no la guarda)" "$j"
  else
    titulo=$(sed -n 's/^titulo: //p' <<<"$gen" | head -n 1)
    if editar_issue "$N" "$titulo" "$f" && etiquetas_del_pedido cola "pedido cola:pregunta cola:corriendo"; then
      est_set "$ID" estado hecho
      comentar "$ID" "redacté la spec y el pedido quedó en la cola como T$N: se lanza cuando le toque. Si quieres revisarla antes, ponle la etiqueta cola:borrador." >/dev/null
      avisar "T$N a la cola" "Redacté la spec del pedido #$N: $titulo" default memo "$(enlace_issue "$ID")"
      log "$ID: el pedido #$N es ahora la spec de T$N"
    else
      est_set "$ID" estado ""
      log "$ID: GitHub no respondió al escribir la spec en el issue #$N: se redacta otra vez"
    fi
  fi
  rm -f "$f" "$err"
}

aplicar_preguntas() { # json texto ronda
  local cid
  cid=$(comentar "$ID" "$(node "$REDACCION" preguntas "$3" <<<"$2")")
  if [ -z "$cid" ]; then
    est_set "$ID" estado ""
    etiquetas_del_pedido "" cola:corriendo "$1"
    log "$ID: no se pudo comentar las preguntas en el issue #$N: se redacta otra vez"
    return
  fi
  etiquetas_del_pedido cola:pregunta cola:corriendo "$1"
  est_set "$ID" estado esperando
  est_set "$ID" ronda "$3"
  avisar "P$N: preguntas" "La redacción del pedido #$N necesita tus respuestas (ronda $3 de $RONDAS_MAX): comenta en el issue." default question "$(enlace_issue "$ID")"
  log "$ID: preguntas de la ronda $3 en el issue #$N"
}

trabar_pedido() { # motivo [json] — cola:trabada y el comentario con qué hacer; no se relanza al recibir comentarios
  local j=${2:-}
  [ -n "$j" ] || j=$(api_issue "$N") || j=""
  if [ -n "$j" ]; then
    etiquetas_del_pedido cola:trabada "cola:corriendo cola:pregunta" "$j"
  else
    log "$ID: GitHub no respondió: el pedido #$N queda sin la etiqueta cola:trabada hasta la próxima redacción"
  fi
  est_set "$ID" estado trabado
  printf '%s\n' "$1" >"$EST/$ID/trabado.md"
  comentar "$ID" "no pude dejar este pedido como spec: $1

Escribe tú la spec en el cuerpo (un bloque \`\`\`yaml con titulo y rama y las secciones, como scripts/orquestador/plantilla-tarea.md) y cambia la etiqueta pedido por cola, o cierra el issue." >/dev/null
  avisar "P$N trabado" "$(head -c 200 <<<"$1" | tr '\n' ' ')" high warning "$(enlace_issue "$ID")"
  log "$ID: trabado: $(head -n 1 <<<"$1")"
}
