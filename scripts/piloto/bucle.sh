#!/usr/bin/env bash
# El piloto de UN carril: pide al coordinador el siguiente paso de su carril, lo corre en una sesión nueva de `claude -p` (o de
# `codex exec`, si el plan lo asigna a Codex), y el bucle —bash, sin modelo— verifica, publica el PR del paso y avisa al coordinador.
# Sólo le pregunta a la persona en las compuertas (al celular); las ámbar se eligen solas a los PILOTO_AUTO_MIN minutos.
#
# Viene del bucle de importadora (un paso por sesión, la copia de las piezas con su sha256, el cierre por el bucle, los topes, el
# límite de uso). Lo que cambia en el kit: no hay ruteo con Sonnet (el modelo, el effort y el riesgo vienen de plan.yaml, por el
# coordinador); la rama es `<carril>/<paso>` desde origin/main; las compuertas de datos salen del riesgo del paso, no de una lista de
# pasos escrita a mano; y hay un piloto por carril, cada uno con su carpeta común y sus sesiones de tmux (comun.sh).
#
#   bucle.sh [--una-vuelta]
#
# Cada vuelta: 0 la copia coincide con bin.sha256 · 1 hechos · 2 paradas (PARAR, árbol sucio sin paso en curso, disco) · 3 un cierre
# pendiente · 4 un paso a medias (se retoma con --resume de SU sesión) · 5 si no, `coordinador siguiente <carril>`: esperar (duerme
# PILOTO_ESPERA_S y vuelve), terminado (sale) o paso · 6 el paso · 7 su resultado: listo (cierre.sh: verificar y publicar), compuerta
# o falla. Variables (de piloto.config o el entorno): CLAUDE_BIN, CODEX_BIN, PILOTO_DISCO_MAX, PILOTO_TOPE_USD_PASO, PILOTO_TOPE_USD_MIN,
# PILOTO_AUTO_MIN, PILOTO_ESPERA_S (120), PILOTO_FABLE_OK, PILOTO_DORMIR, PILOTO_POLL. Se prueba en `piloto.test.mjs`.
set -uo pipefail
# shellcheck source=comun.sh
source "$(dirname "${BASH_SOURCE[0]}")/comun.sh"
# shellcheck source=compuerta.sh
source "$BIN/compuerta.sh"
# shellcheck source=cierre.sh
source "$BIN/cierre.sh"
# shellcheck source=gasto.sh
source "$BIN/gasto.sh"
cd "$RAIZ" || exit 1

UNA_VUELTA=0 EN_SECO=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --una-vuelta) UNA_VUELTA=1; shift ;;
    *) echo "uso: bucle.sh [--una-vuelta]" >&2; exit 64 ;;
  esac
done
[ -n "$CARRIL" ] || { echo "bucle: no sé el carril (PILOTO_CARRIL o CARRIL= en .env.carril: scripts/worktree/preparar.sh)." >&2; exit 1; }
DISCO_MAX="${PILOTO_DISCO_MAX:-90}" TOPE_PASO="${PILOTO_TOPE_USD_PASO:-60}" TOPE_MIN="${PILOTO_TOPE_USD_MIN:-5}"
DORMIR="${PILOTO_DORMIR:-sleep}" POLL="${PILOTO_POLL:-5}" ESPERA_S="${PILOTO_ESPERA_S:-120}"
CLAUDE=$(claude_bin)
[ -n "$CLAUDE" ] || { echo "bucle: no encuentro el binario de claude (CLAUDE_BIN)." >&2; exit 1; }

mkdir -p "$ESTADO/llamadas" "$ESTADO/sesiones" "$ESTADO/planes" "$ESTADO/informes" "$ESTADO/salidas" "$COMUN"
exec 8>"$ESTADO/bucle.lock"
flock -n 8 || { echo "bucle: ya corre otro bucle en este carril (flock sobre $ESTADO/bucle.lock)." >&2; exit 1; }

registro() {
  local linea
  linea="$(ahora_lapaz) [$CARRIL] $*"
  echo "$linea"
  echo "- $linea" >>"$ESTADO/registro.md"
}
consumo() { PILOTO_DIR="$ESTADO" bash "$BIN/consumo.sh" llamada "$@"; }
hecho() { jq -r "$1" "$ESTADO/hechos.json" 2>/dev/null; }
del_paso() { jq -r "$1" "$ESTADO/paso.json" 2>/dev/null; }

verificar_copia() {
  [ -s "$BIN/bin.sha256" ] || return 1
  (cd "$BIN" && sha256sum -c --quiet bin.sha256 >/dev/null 2>&1) || return 1
  [ "$(awk '{print $2}' "$BIN/bin.sha256" | sed 's/^\*//' | sort)" = "$(cd "$BIN" && find . -mindepth 1 ! -name bin.sha256 -printf '%P\n' | sort)" ]
}

# El límite de uso: `api_error: usage_limit_reached`, o el texto («You've hit your session limit · resets 3:45pm», «You've hit your
# 5-hour limit · resets 9:30pm»): los segundos hasta esa hora y 5 min más.
segundos_de_limite() {
  local texto hora objetivo ahora
  texto="$(jq -r '(.result // "") + " " + (.error // "")' "$1" 2>/dev/null) $(cat "$2" 2>/dev/null)"
  if ! jq -e '.api_error == "usage_limit_reached"' "$1" >/dev/null 2>&1; then
    [[ "$texto" =~ hit\ your[A-Za-z0-9\ -]*limit ]] || return 1
  fi
  if [[ "$texto" =~ resets\ ([0-9]{1,2}(:[0-9]{2})?\ ?[apAP][mM]) ]]; then
    hora="${BASH_REMATCH[1]}"
    ahora=$(date +%s)
    objetivo=$(TZ=America/La_Paz date -d "$hora" +%s 2>/dev/null) || objetivo=$((ahora - 1))
    [ "$objetivo" -gt "$ahora" ] || objetivo=$((objetivo + 86400))
    echo $((objetivo - ahora + 300))
  else
    echo 3600
  fi
}

chequeo() {
  local clave="$1" motivo="$2" rc
  if [ -f "$ESTADO/ignorar-$clave" ]; then rm -f "$ESTADO/ignorar-$clave"; return 0; fi
  parada "$motivo"
  rc=$?
  [ "$rc" = 2 ] && touch "$ESTADO/ignorar-$clave"
  [ "$rc" = 1 ] && return 1
  return 0
}
paradas_deterministas() {
  [ -f "$ESTADO/PARAR" ] && { registro "PARAR: el bucle se detiene entre pasos."; exit 0; }
  local disco
  if [ "$(hecho .arbol_limpio)" != true ] && [ ! -f "$ESTADO/en-curso.json" ]; then
    chequeo arbol "el árbol del carril $CARRIL está sucio y no hay un paso en curso" || return 1
  fi
  disco=$(hecho .disco_pct)
  if [ -n "$disco" ] && [ "$disco" != null ] && [ "$disco" -gt "$DISCO_MAX" ]; then
    chequeo disco "el disco está al ${disco} % (tope ${DISCO_MAX} %)" || return 1
  fi
  return 0
}

en_curso_vivo() {
  local pid
  pid=$(jq -r '.pid // empty' "$ESTADO/en-curso.json" 2>/dev/null)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}
anotar_en_curso() { # <paso> <session_id> <head> <modelo> <effort> <agente>
  jq -nc --arg paso "$1" --arg sid "$2" --arg head "$3" --arg modelo "$4" --arg effort "$5" --arg agente "$6" --arg hora "$(ahora_lapaz)" \
    '{paso: $paso, session_id: $sid, pid: null, head_arranque: $head, hora: $hora, modelo: $modelo, effort: $effort, agente: $agente, estado: "corriendo", guardas_aprobadas: false}' \
    >"$ESTADO/en-curso.json"
}
marcar() { jq -c "$1" "$ESTADO/en-curso.json" >"$ESTADO/en-curso.json.tmp" && mv -f "$ESTADO/en-curso.json.tmp" "$ESTADO/en-curso.json"; }
fallas() { echo "$(($(cat "$ESTADO/fallas" 2>/dev/null || echo 0) + 1))" >"$ESTADO/fallas"; }

# La rama del paso: nueva desde origin/main, o la que ya existe (un arreglo de CI o de conflicto, o un paso que se retoma).
preparar_rama() { # <rama> <nueva|existente>
  local rama="$1" base=origin/main
  git fetch --quiet origin main 2>/dev/null || base=main
  if [ "$2" = nueva ]; then
    git checkout --quiet -B "$rama" "$base" || return 1
  elif git show-ref --verify --quiet "refs/heads/$rama"; then
    git checkout --quiet "$rama" || return 1
  elif git ls-remote --exit-code --heads origin "$rama" >/dev/null 2>&1; then
    git fetch --quiet origin "$rama" && git checkout --quiet -B "$rama" FETCH_HEAD || return 1
  else
    git checkout --quiet -B "$rama" "$base" || return 1
  fi
}

# --- Claude ---
lanzar_paso() { # <modo: nueva|resume> <session_id> <prompt> <modelo> <effort>
  local modo="$1" sid="$2" prompt="$3" modelo="$4" effort="$5" sesion=(--session-id "$2") rc
  [ "$modo" = resume ] && sesion=(--resume "$sid")
  mv -f "$ESTADO/ultimo.json" "$ESTADO/ultimo-anterior.json" 2>/dev/null
  PILOTO=1 PILOTO_SESION=paso "$CLAUDE" -p "$prompt" --model "$modelo" --effort "$effort" --permission-mode auto \
    --permission-prompts none --disallowedTools "mcp__*" --max-budget-usd "$(restante)" --output-format json "${sesion[@]}" \
    >"$SALIDA_PASO" 2>"$ESTADO/llamadas/paso.err" 8>&- &
  marcar ".pid = $! | .estado = \"corriendo\""
  wait "$!"
  rc=$?
  marcar '.pid = null'
  return "$rc"
}

correr_paso() { # <paso> <modo> <session_id> <prompt> <modelo> <effort>
  local paso="$1" modo="$2" sid="$3" prompt="$4" modelo="$5" effort="$6" rc espera limite=0 reintento=0 resultado inicio dur
  while :; do
    le_queda || return 3
    inicio=$SECONDS
    lanzar_paso "$modo" "$sid" "$prompt" "$modelo" "$effort"
    rc=$?
    dur=$((SECONDS - inicio))
    anotar_gasto "$SALIDA_PASO"
    if espera=$(segundos_de_limite "$SALIDA_PASO" "$ESTADO/llamadas/paso.err"); then
      consumo paso "$paso" "$modelo" "$effort" limite "$SALIDA_PASO" "$dur"
      [ "$limite" = 1 ] && { registro "el límite de uso volvió tras dormir: aviso."; return 2; }
      limite=1
      registro "límite de uso en $paso: duermo $espera s y retomo con --resume."
      $DORMIR "$espera"
      modo=resume prompt="/piloto $paso continuar"
      continue
    fi
    if jq -e '.subtype == "error_max_budget_usd"' "$SALIDA_PASO" >/dev/null 2>&1; then
      consumo paso "$paso" "$modelo" "$effort" tope "$SALIDA_PASO" "$dur"
      return 3
    fi
    if [ "$rc" = 0 ] && ultimo_valido && [ "$(jq -r .paso "$ESTADO/ultimo.json")" = "$paso" ]; then
      resultado=$(jq -r .resultado "$ESTADO/ultimo.json")
      consumo paso "$paso" "$modelo" "$effort" "$resultado" "$SALIDA_PASO" "$dur"
      return 0
    fi
    consumo paso "$paso" "$modelo" "$effort" fallo-proceso "$SALIDA_PASO" "$dur"
    [ "$reintento" = 1 ] && return 1
    reintento=1
    registro "el paso $paso falló (rc=$rc o sin ultimo.json válido): un reintento con --resume $sid."
    modo=resume prompt="/piloto $paso continuar"
  done
}

# --- Codex (un paso con `agente: codex` en plan.yaml) ---
# `codex exec` no carga las skills de Claude: el prompt es `.claude/skills/piloto/codex.md` con el paso pegado. Corre con
# `--sandbox workspace-write`, deja los cambios sin commit, y su último mensaje (con `--output-schema`) es el resultado; el commit lo
# hace el bucle (así no depende de si el sandbox deja escribir `.git/`). Codex no informa dólares: su consumo se anota en tokens, y su
# cuota no entra en la del coordinador (es otro fondo). Las banderas `--json`, `--sandbox`, `-o`, `--output-schema` y el prompt por
# stdin están en la doc de `codex exec`; `-c model_reasoning_effort=…` no estaba en esa página: verificar con `codex exec --help`.
correr_codex() { # <paso> <effort> <head de arranque>
  local paso="$1" effort="$2" desde="$3" codex="${CODEX_BIN:-codex}" salida="$ESTADO/llamadas/codex-ultimo.jsonl" final="$ESTADO/codex-final.json" rc inicio
  command -v "$codex" >/dev/null 2>&1 || { registro "no encuentro codex (CODEX_BIN)."; return 1; }
  mv -f "$ESTADO/ultimo.json" "$ESTADO/ultimo-anterior.json" 2>/dev/null
  rm -f "$final"
  inicio=$SECONDS
  {
    cat "$RAIZ/.claude/skills/piloto/codex.md"
    echo
    echo '## El paso (del coordinador)'
    echo '```json'
    jq . "$ESTADO/paso.json"
    echo '```'
    if [ -n "$(hecho '.decision // empty')" ]; then
      echo '## La decisión de la persona (o la autoelección ámbar)'
      hecho .decision
    fi
  } | PILOTO=1 PILOTO_SESION=paso "$codex" exec --json --sandbox workspace-write -c "model_reasoning_effort=$effort" \
    --output-schema "$BIN/codex-final.schema.json" -o "$final" - >"$salida" 2>"$ESTADO/llamadas/codex.err" 8>&- &
  marcar ".pid = $! | .estado = \"corriendo\""
  wait "$!"
  rc=$?
  marcar '.pid = null'
  # El consumo, en tokens (la suma de `usage` de cada `turn.completed`), con el formato de una llamada de Claude para consumo.sh.
  jq -s --arg ef "$effort" '[.[] | select(.type == "turn.completed") | .usage // {}] as $u | {
      session_id: (first(.[] | select(.type == "thread.started") | .thread_id) // "codex"), total_cost_usd: 0, duration_ms: 0,
      modelUsage: {codex: {inputTokens: ($u | map(.input_tokens // 0) | add // 0), outputTokens: ($u | map((.output_tokens // 0) + (.reasoning_output_tokens // 0)) | add // 0),
      cacheReadInputTokens: ($u | map(.cached_input_tokens // 0) | add // 0), cacheCreationInputTokens: 0, costUSD: 0}}}' "$salida" \
    >"$ESTADO/llamadas/codex-consumo.json" 2>/dev/null
  [ "$rc" = 0 ] && jq -e '.resultado | IN("listo", "compuerta", "falla")' "$final" >/dev/null 2>&1 || {
    consumo paso "$paso" codex "$effort" fallo-proceso "$ESTADO/llamadas/codex-consumo.json" "$((SECONDS - inicio))"
    return 1
  }
  local resultado
  resultado=$(jq -r .resultado "$final")
  if [ "$resultado" = listo ]; then
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit --quiet -F <(printf '%s(%s): %s\n\nPaso %s del plan, hecho por Codex. %s\n' \
        "$(jq -r '.tipo_commit // "feat"' "$final")" "$CARRIL" "$(del_paso .titulo | head -c 60)" "$paso" "$(jq -r .resumen "$final")") ||
        { resultado=falla; jq '.resultado = "falla" | .resumen = "el commit de los cambios de Codex falló (pre-commit): ver el log"' "$final" >"$final.tmp" && mv -f "$final.tmp" "$final"; }
    fi
    [ -n "$(git rev-list --first-parent "$desde..HEAD")" ] || { resultado=falla; jq '.resultado = "falla" | .resumen = "Codex dijo «listo» sin cambios"' "$final" >"$final.tmp" && mv -f "$final.tmp" "$final"; }
  fi
  jq -c --arg paso "$paso" --argjson commits "$(git rev-list --first-parent --reverse "$desde..HEAD" | jq -Rnc '[inputs]')" \
    '{paso: $paso, resultado, resumen, commits: $commits, e2e_dirigidos: (.e2e_dirigidos // []), compuerta: (.compuerta // null)}' "$final" >"$ESTADO/ultimo.json"
  consumo paso "$paso" codex "$effort" "$resultado" "$ESTADO/llamadas/codex-consumo.json" "$((SECONDS - inicio))"
  return 0
}

compuerta_del_paso() { # <paso>
  local paso="$1" opciones=() rc
  mapfile -t opciones < <(jq -r '.compuerta.opciones[]? | "\(.etiqueta) — \(.descripcion)"' "$ESTADO/ultimo.json")
  mapfile -t CONTEXTO < <(jq -r '.compuerta.contexto[]? // empty' "$ESTADO/ultimo.json")
  PREGUNTAS=$(jq -c '.compuerta.preguntas // empty | select(length > 0)' "$ESTADO/ultimo.json")
  marcar '.estado = "compuerta"'
  compuerta "$(jq -r .compuerta.tipo "$ESTADO/ultimo.json")" "$paso" \
    "$(jq -r '.compuerta.motivo // ""' "$ESTADO/ultimo.json") (el paso lleva $(dinero "$(gastado)") de $(dinero "$(tope_del_paso)") USD)" \
    "$(jq -r '.compuerta.pregunta // .compuerta.motivo // ""' "$ESTADO/ultimo.json")" "${opciones[@]}"
  rc=$?
  PREGUNTAS=""
  [ "$rc" = 3 ] && { registro "parado por la persona en la compuerta de $paso."; exit 0; }
  return 0
}

ULTIMO_ESPERA=""
vuelta() {
  local paso modelo effort agente modo sid prompt desde rama modo_plan respuesta accion
  verificar_copia || { parada "la copia de los scripts del piloto no coincide con bin.sha256 (alterada o con archivos de más)"; return 0; }
  bash "$BIN/hechos.sh" >"$ESTADO/hechos.json.tmp" 2>"$ESTADO/hechos.err" && mv -f "$ESTADO/hechos.json.tmp" "$ESTADO/hechos.json" ||
    { parada "hechos.sh falló: $(tail -n 2 "$ESTADO/hechos.err" | tr '\n' ' ')"; return 0; }
  paradas_deterministas || return 0

  # 3. Un cierre pendiente (el paso quedó «listo» y no se verificó o publicó): sin modelo.
  if [ "$(jq -r '.estado // empty' "$ESTADO/en-curso.json" 2>/dev/null)" = listo ]; then
    paso=$(jq -r .paso "$ESTADO/en-curso.json")
    RIESGO_PASO=$(del_paso '.riesgo // "rojo"')
    cerrar_listo "$paso" "$(jq -r .head_arranque "$ESTADO/en-curso.json")" "$(jq -r '.guardas_aprobadas // false' "$ESTADO/en-curso.json")"
    return 0
  fi

  if [ -f "$ESTADO/en-curso.json" ]; then
    # 4. Un paso a medias: se retoma con --resume de SU sesión; nunca una sesión nueva sobre un árbol a medias.
    en_curso_vivo && { parada "el paso $(jq -r .paso "$ESTADO/en-curso.json") sigue vivo (pid $(jq -r .pid "$ESTADO/en-curso.json"))"; return 0; }
    paso=$(jq -r .paso "$ESTADO/en-curso.json") sid=$(jq -r .session_id "$ESTADO/en-curso.json") desde=$(jq -r .head_arranque "$ESTADO/en-curso.json")
    modelo=$(jq -r .modelo "$ESTADO/en-curso.json") effort=$(jq -r .effort "$ESTADO/en-curso.json") agente=$(jq -r '.agente // "claude"' "$ESTADO/en-curso.json")
    modo=resume prompt="/piloto $paso continuar"
  else
    # 5. El coordinador dice qué toca.
    respuesta=$(coordinador siguiente "$CARRIL" 2>"$ESTADO/coordinador.err") ||
      { parada "el coordinador falló: $(tail -n 2 "$ESTADO/coordinador.err" | tr '\n' ' ')"; return 0; }
    accion=$(jq -r .accion <<<"$respuesta")
    case "$accion" in
      terminado) registro "el carril $CARRIL terminó: todos sus pasos están integrados."; exit 0 ;;
      esperar)
        local motivo
        motivo=$(jq -r .motivo <<<"$respuesta")
        [ "$motivo" != "$ULTIMO_ESPERA" ] && registro "espero: $motivo"
        ULTIMO_ESPERA="$motivo"
        $DORMIR "$ESPERA_S"
        return 0 ;;
      paso) ;;
      *) parada "el coordinador respondió algo que no entiendo: ${respuesta:0:200}"; return 0 ;;
    esac
    ULTIMO_ESPERA=""
    jq . <<<"$respuesta" >"$ESTADO/paso.json"
    paso=$(del_paso .paso) rama=$(del_paso .rama)
    modelo=$(del_paso .ruteo.modelo) effort=$(del_paso .ruteo.effort) agente=$(del_paso .ruteo.agente)
    if [ "$(del_paso '.arreglar // empty')" != "" ] || [ "$(del_paso .retomar)" = true ]; then
      preparar_rama "$rama" existente || { parada "no pude cambiar a la rama $rama"; return 0; }
    else
      preparar_rama "$rama" nueva || { parada "no pude crear la rama $rama desde origin/main"; return 0; }
    fi

    # Fable con `claude -p` cobra créditos de uso sin preguntar: la persona lo aprueba una vez por paso (o PILOTO_FABLE_OK=1).
    if [ "$modelo" = fable ] && [ "${PILOTO_FABLE_OK:-0}" != 1 ] && [ ! -f "$ESTADO/fable-ok-$paso" ]; then
      parada "el paso $paso va con Fable: en «claude -p» puede cobrar créditos de uso sin preguntar" "$paso" \
        'parado — no sigue (recomendado)' 'sigo — usa Fable en este paso' 'reintentar — vuelve a preguntar al coordinador'
      case "$?" in
        2) touch "$ESTADO/fable-ok-$paso" ;;
        *) coordinador liberar "$paso" "fable sin aprobar" >/dev/null 2>&1; return 0 ;;
      esac
    fi
    modo=nueva sid=$(cat /proc/sys/kernel/random/uuid) desde=$(git rev-parse HEAD) prompt="/piloto $paso"
    anotar_en_curso "$paso" "$sid" "$desde" "$modelo" "$effort" "$agente"
  fi

  RIESGO_PASO=$(del_paso '.riesgo // "rojo"')
  export RIESGO_PASO
  # Rojo, o un modo que termina en manual: el paso corre hasta el plan auditado y la persona lo aprueba (compuerta «datos») antes de
  # ejecutar. Con la aprobación (`aprobado-<paso>`), el paso sigue solo.
  modo_plan=$(del_paso '.ruteo.modo // "auto"')
  if { [ "$RIESGO_PASO" = rojo ] || [[ "$modo_plan" =~ (manual|^plan$) ]]; } && [ ! -f "$COMUN/aprobado-$(sanear "$paso")" ]; then
    prompt="$prompt --hasta-plan"
  fi

  SALIDA_PASO="$ESTADO/llamadas/paso-ultimo.json"
  registro "paso $paso ($agente · $modelo · $effort · riesgo $RIESGO_PASO, $modo ${sid:0:8})."
  if [ "$agente" = codex ]; then
    correr_codex "$paso" "$effort" "$desde"
  else
    correr_paso "$paso" "$modo" "$sid" "$prompt" "$modelo" "$effort"
  fi
  case "$?" in
    1) fallas; parada "el paso $paso falló dos veces (el proceso o sin ultimo.json válido); su salida queda en .piloto/llamadas/" "$paso"; return 0 ;;
    2) parada "el límite de uso volvió tras dormir en $paso" "$paso"; return 0 ;;
    3) parada_tope "$paso"; return 0 ;;
  esac
  case "$(jq -r .resultado "$ESTADO/ultimo.json")" in
    listo)
      registro "$paso listo: $(jq -r .resumen "$ESTADO/ultimo.json" | head -c 300)"
      cerrar_listo "$paso" "$desde" false
      ;;
    compuerta) compuerta_del_paso "$paso" ;;
    falla)
      fallas
      parada "el paso $paso terminó en falla: $(jq -r .resumen "$ESTADO/ultimo.json" | head -c 300)" "$paso"
      ;;
  esac
  return 0
}

registro "bucle en marcha (carril $CARRIL, copia $BIN)."
while :; do
  vuelta
  [ "$UNA_VUELTA" = 1 ] && exit 0
  [ "$(cat "$ESTADO/fallas" 2>/dev/null || echo 0)" -ge 3 ] && { parada "tres fallas seguidas"; echo 0 >"$ESTADO/fallas"; }
done
