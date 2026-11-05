#!/usr/bin/env bash
# Las compuertas del bucle (se hace `source` desde bucle.sh; no se corre solo). Una compuerta es lo único que el bucle le pregunta a la
# persona: escribe `<común>/piloto/compuerta.md` (con un id nuevo), abre la sesión corta de decidir (`decidir.sh abrir`, que deja la copia
# de lectura en `.piloto/`) y espera. Sólo acepta `decision.md` si: su id es el de la compuerta vigente, es posterior a `compuerta.md` y
# ningún paso vivía cuando apareció (`en-curso.json` y `pgrep`); si no, la borra y sigue esperando. Con la decisión aceptada cierra la
# sesión de decidir y, con `datos` aprobada, escribe `aprobado-<paso>`. Nada sigue sin respuesta, salvo la ámbar y PILOTO_AUTO (abajo).
# Se prueba en `piloto.test.mjs`.
#
# Ámbar (kit): una compuerta «producto» de un paso que no es rojo (RIESGO_PASO) es ámbar. Si nadie responde en PILOTO_AUTO_MIN minutos,
# el bucle elige la opción recomendada (la primera, de cada pregunta) y lo dice en la decisión («autoelección»); el paso la copia a
# docs/pasos/<PASO>/decisiones.md. Todas las demás compuertas, y cualquiera de un paso rojo, esperan a la persona.
#
# Solas (kit, como importadora): los tipos de PILOTO_AUTO (piloto.config; por omisión ninguno) se contestan al instante, sin abrir la
# sesión de decidir: `producto` con la recomendada de cada pregunta, `datos` y `guardas` con «aprobar» (en `guardas` queda el diff en
# `.piloto/guardas/<paso>.diff`). Cada una queda en `autoelecciones.md` igual que una ámbar. Nunca `parada`, `dependencia`, `afuera` ni
# `atasco`: son avisos de algo que el piloto no puede juzgar.
#
# Variables que espera: COMUN, ESTADO, BIN, POLL (segundos entre lecturas), EN_SECO y la función `registro`. PREGUNTAS (JSON, opcional):
# las de una compuerta «producto», una por decisión; compuerta.md las lleva con cuántas tandas de 4 son (CAL-1).
# Resultado de `compuerta`: 0 sigue, 1 reintentar, 2 seguir ignorando el aviso, 3 parar. La decisión queda en DECISION_OPCION y DECISION_TEXTO.

sanear() { printf '%s' "${1//[^A-Za-z0-9._-]/_}"; }

# Las opciones de la compuerta, como líneas «etiqueta — descripción» (la recomendada primero), según su tipo.
opciones_de() {
  case "$1" in
    parada) printf '%s\n' 'parado — no sigue (recomendado)' 'reintentar — vuelve a intentar esta vuelta' 'sigo — ignora este aviso una vez' ;;
    guardas) printf '%s\n' 'aprobar — el cambio a las guardas es legítimo' 'parar — no se verifica ni se publica' ;;
    datos) printf '%s\n' 'aprobar — el plan de datos o seguridad está bien' 'cambiar — escribe qué cambiar en «Other»' 'parar — no sigue' ;;
    *) printf '%s\n' 'seguir con la recomendación — el paso continúa' 'parar — no sigue' ;;
  esac
}

# La clave de lo que la persona respondió (el primer término de la opción, sin mayúsculas ni comillas).
clave_de() {
  local op="${1,,}"
  op="${op#[\"«\']}"
  case "$op" in
    aprobar* | aprobado* | "sí"* | si | "si "* | seguir* | continuar*) echo aprobar ;;
    parar* | parado* | no | "no "* | detener*) echo parar ;;
    reintentar*) echo reintentar ;;
    sigo* | ignorar*) echo sigo ;;
    cambiar*) echo cambiar ;;
    *) echo libre ;;
  esac
}

# escribir_compuerta <tipo> <paso> <motivo> <pregunta> [opciones…] (sin opciones, las de su tipo); CONTEXTO (arreglo) = rutas.
# Con PREGUNTAS no hay opciones generales: cada decisión trae las suyas.
escribir_compuerta() {
  local tipo="$1" paso="$2" motivo="$3" pregunta="$4"
  shift 4
  local opciones=("$@") o
  [ "${#opciones[@]}" -gt 0 ] || [ -n "${PREGUNTAS:-}" ] || mapfile -t opciones < <(opciones_de "$tipo")
  mkdir -p "$COMUN" "$ESTADO"
  rm -f "$COMUN/decision.md"
  COMPUERTA_ID="g-$(date +%s)-$RANDOM"
  {
    echo "id: $COMPUERTA_ID"
    echo "creada: $(date +%s)"
    echo "tipo: $tipo"
    echo "paso: $paso"
    echo "motivo: ${motivo//$'\n'/ }"
    echo "pregunta: ${pregunta//$'\n'/ }"
    [ "${COMPUERTA_AMBAR:-0}" = 1 ] && echo "ambar: si no responde en ${PILOTO_AUTO_MIN:-5} min, el piloto elige la opción recomendada"
    echo "opciones:"
    for o in "${opciones[@]:-}"; do [ -n "$o" ] && echo "- $o"; done
    echo "contexto:"
    for o in "${CONTEXTO[@]:-}"; do [ -n "$o" ] && echo "- $o"; done
    if [ -n "${PREGUNTAS:-}" ]; then
      jq -r 'def una_linea: gsub("\n"; " ");
        "preguntas: \(length)", "tandas: \((length + 3) / 4 | floor)",
        (.[] | "- \(.id): \(.pregunta | una_linea)", (.opciones[] | "  - \(.etiqueta | una_linea) — \(.descripcion | una_linea)"))' <<<"$PREGUNTAS"
    fi
  } >"$COMUN/compuerta.md.tmp"
  mv -f "$COMUN/compuerta.md.tmp" "$COMUN/compuerta.md"
}

paso_vivo() {
  local pid sid
  pid=$(jq -r '.pid // empty' "$ESTADO/en-curso.json" 2>/dev/null)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && return 0
  # Kit: con varios pilotos en la máquina, `pgrep` busca la sesión de ESTE paso (su session_id), no cualquier `/piloto`: el paso de otro
  # carril u otro proyecto no cuenta. `pgrep -f` sólo se excluye a sí mismo: se descartan las líneas de otro `pgrep`.
  sid=$(jq -r '.session_id // empty' "$ESTADO/en-curso.json" 2>/dev/null)
  [ -n "$sid" ] || return 1
  pgrep -af -- "${PILOTO_PGREP_PATRON:-$sid}" 2>/dev/null | awk '$2 != "pgrep" { vivo = 1 } END { exit !vivo }'
}

rechazar_decision() {
  registro "decisión rechazada: $1; se borra y se sigue esperando."
  rm -f "$COMUN/decision.md"
  return 1
}

decision_valida() {
  [ -s "$COMUN/decision.md" ] || return 1
  [ "$(sed -n 's/^id: *//p' "$COMUN/decision.md" | head -n 1)" = "$COMPUERTA_ID" ] || { rechazar_decision "el id es de otra compuerta"; return 1; }
  [ "$COMUN/decision.md" -nt "$COMUN/compuerta.md" ] || { rechazar_decision "es anterior a la compuerta"; return 1; }
  if paso_vivo; then rechazar_decision "apareció con un paso vivo"; return 1; fi
  return 0
}

# anotar_autoeleccion <cómo>: el registro para el paso, que lo copia a docs/pasos/<PASO>/decisiones.md (el bucle no escribe en el árbol
# a mitad de un paso).
anotar_autoeleccion() {
  echo "- $(ahora_lapaz) · $(sed -n 's/^paso: *//p' "$COMUN/compuerta.md" | head -n 1) · $1: $(sed -n 's/^opcion: *//p' "$COMUN/decision.md" | head -n 1)" >>"$ESTADO/autoelecciones.md"
}

# autoelegir <nota> <dicho> <anotado>: la decisión sin la persona, con la primera opción (la recomendada) de la compuerta o de cada
# pregunta. <nota> va en `notas:`, <dicho> encabeza «me respondió» y <anotado> el renglón de autoelecciones.md.
autoelegir() {
  local nota="$1" dicho="$2" anotado="$3" tmp
  tmp=$(mktemp "$COMUN/decision.XXXXXX") || return 1
  awk -v id="$COMPUERTA_ID" -v nota="$nota" -v dicho="$dicho" -v creada="$(date +%s)" '
    function corta(s) { sub(/ — .*/, "", s); return s }
    /^opciones:/ { seccion = "opciones"; next }
    /^preguntas:/ { seccion = "preguntas"; next }
    /^tandas:/ { next }
    /^(contexto|ambar):/ { seccion = "otra"; next }
    seccion == "opciones" && /^- / && unica == "" { unica = corta(substr($0, 3)) }
    seccion == "preguntas" && /^- [^ ]+: / { pid = substr($2, 1, length($2) - 1); orden[++n] = pid; next }
    seccion == "preguntas" && /^  - / && pid != "" && !(pid in r) { r[pid] = corta(substr($0, 5)) }
    END {
      if (n > 0) { for (i = 1; i <= n; i++) { linea = linea (i > 1 ? "; " : "") orden[i] ": " r[orden[i]] } }
      else linea = unica
      print "id: " id
      print "opcion: " (n > 0 ? linea : unica)
      print "notas: autoelección: " nota
      print "creada: " creada
      if (n > 0) { print "respuestas:"; for (i = 1; i <= n; i++) print "- " orden[i] ": " r[orden[i]] }
      print "me respondió: «" dicho ": " linea "»"
    }' "$COMUN/compuerta.md" >"$tmp" || { rm -f "$tmp"; return 1; }
  mv -f "$tmp" "$COMUN/decision.md"
  anotar_autoeleccion "$anotado"
}

# ¿Este tipo de compuerta se contesta solo? (PILOTO_AUTO). Una `datos` o `guardas` con preguntas no: no es la aprobación de siempre.
auto_contesta() { # <tipo>
  [ "${EN_SECO:-0}" != 1 ] || return 1
  [[ ",${PILOTO_AUTO:-}," == *",$1,"* ]] || return 1
  case "$1" in
    producto) return 0 ;;
    datos | guardas) [ -z "${PREGUNTAS:-}" ] ;;
    *) return 1 ;;
  esac
}

# contestar_solo <tipo>: la decisión de PILOTO_AUTO. `datos` y `guardas` siempre «aprobar» (la opción del modelo podría no serlo, y sin
# `aprobado-<paso>` el paso volvería a correr hasta el plan); `producto`, la recomendada de cada pregunta.
contestar_solo() {
  local tipo="$1" tmp diff=""
  [ "$tipo" = guardas ] && diff="${GUARDAS_DIFF:-}"
  case "$tipo" in
    datos | guardas)
      tmp=$(mktemp "$COMUN/decision.XXXXXX") || return 1
      {
        echo "id: $COMPUERTA_ID"
        echo "opcion: aprobar"
        echo "notas: autoelección: PILOTO_AUTO aprueba las compuertas $tipo${diff:+ (diff: $diff)}"
        echo "creada: $(date +%s)"
        echo "me respondió: «autoelección por PILOTO_AUTO: aprobar»"
      } >"$tmp"
      mv -f "$tmp" "$COMUN/decision.md"
      anotar_autoeleccion "compuerta $tipo contestada sola (PILOTO_AUTO)${diff:+, diff en $diff}"
      ;;
    *) autoelegir "PILOTO_AUTO contesta las compuertas $tipo" "autoelección por PILOTO_AUTO" "compuerta $tipo contestada sola (PILOTO_AUTO)" ;;
  esac
}

leer_decision() {
  DECISION_OPCION=$(sed -n 's/^opcion: *//p' "$COMUN/decision.md" | head -n 1)
  DECISION_TEXTO=$(sed -n 's/^me respondió: *//p' "$COMUN/decision.md" | head -n 1)
}

esperar_decision() {
  local inicio=$SECONDS auto_s
  auto_s=$(( ${PILOTO_AUTO_SEG:-$(( ${PILOTO_AUTO_MIN:-5} * 60 ))} ))
  until decision_valida; do
    if [ "${COMPUERTA_AMBAR:-0}" = 1 ] && [ $((SECONDS - inicio)) -ge "$auto_s" ] && ! paso_vivo; then
      autoelegir "nadie respondió en ${PILOTO_AUTO_MIN:-5} min (compuerta ámbar)" "autoelección a los ${PILOTO_AUTO_MIN:-5} min" \
        "autoelección ámbar a los ${PILOTO_AUTO_MIN:-5} min" && registro "compuerta ámbar sin respuesta en ${PILOTO_AUTO_MIN:-5} min: autoelección de la recomendada."
      continue
    fi
    [ -f "$ESTADO/PARAR" ] && { registro "PARAR mientras se esperaba una decisión."; "$BIN/decidir.sh" cerrar 8>&-; exit 0; }
    if [ "${PILOTO_ESPERA_MAX:-0}" -gt 0 ] && [ $((SECONDS - inicio)) -ge "$PILOTO_ESPERA_MAX" ]; then
      registro "nadie respondió en ${PILOTO_ESPERA_MAX} s."
      "$BIN/decidir.sh" cerrar 8>&-
      exit 3
    fi
    sleep "$POLL"
  done
  leer_decision
}

# compuerta <tipo> <paso> <motivo> <pregunta> [opciones…]
compuerta() {
  local tipo="$1" paso="$2" clave
  COMPUERTA_AMBAR=0
  if auto_contesta "$tipo"; then
    escribir_compuerta "$@"
    registro "compuerta $tipo ($paso): $3"
    contestar_solo "$tipo" || { registro "no pude contestar sola la compuerta $tipo."; exit 3; }
    leer_decision
  else
    [ "$tipo" = producto ] && [ "${RIESGO_PASO:-rojo}" != rojo ] && COMPUERTA_AMBAR=1
    escribir_compuerta "$@"
    registro "compuerta $tipo ($paso): $3"
    "$BIN/decidir.sh" abrir 8>&- || { registro "no se pudo abrir la sesión de decidir."; exit 3; }
    esperar_decision
    "$BIN/decidir.sh" cerrar 8>&-
  fi
  clave=$(clave_de "$DECISION_OPCION")
  registro "me respondió: $DECISION_TEXTO"
  case "$clave" in
    parar) return 3 ;;
  esac
  # Varias decisiones: «parar» (o «parado», «detener») en cualquiera para. «no …» no: «no partir» es una respuesta.
  if [ -n "${PREGUNTAS:-}" ] && sed -n 's/^- [^:]*: *//p' "$COMUN/decision.md" | sed -E 's/^(«|"|'"'"')//' |
    grep -qiE '^(parar|parado|detener)'; then
    return 3
  fi
  case "$tipo" in
    parada)
      case "$clave" in reintentar) return 1 ;; sigo) return 2 ;; *) return 3 ;; esac ;;
    guardas)
      [ "$clave" = aprobar ] && return 0
      return 3 ;;
    datos)
      [ "$clave" = aprobar ] && echo "aprobado $(ahora_lapaz)" >"$COMUN/aprobado-$(sanear "$paso")"
      return 0 ;;
  esac
  return 0
}

# parada <motivo> [paso] [opciones…]: un aviso. Toda parada llega al celular; en el ensayo en seco sólo se dice (y sigue).
# Devuelve 1 (reintentar) o 2 (sigo); «parado» sale del bucle.
parada() {
  local motivo="$1" paso="${2:-}" rc
  shift $(($# > 2 ? 2 : $#))
  if [ "${EN_SECO:-0}" = 1 ]; then
    echo "AVISO (ensayo en seco, sigo): $motivo"
    registro "aviso en seco: $motivo"
    return 2
  fi
  compuerta parada "$paso" "$motivo" "Paró por $motivo: ¿sigo, reintento o lo dejo parado?" "$@"
  rc=$?
  case "$rc" in
    1 | 2) return "$rc" ;;
  esac
  registro "parado por la persona: $motivo"
  exit 0
}
