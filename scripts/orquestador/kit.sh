# shellcheck shell=bash
# Las mejoras del flujo entre el kit y este proyecto (docs/KIT.md › «El flujo entre el kit y los proyectos»; README.md › «La tarea
# semanal del flujo del kit» y «Lo que sube al kit»):
#   - del kit al proyecto: una vez por semana (UTC), si `.kit/version` está atrás del main del kit en algún archivo de flujo y no hay
#     un issue `kit` abierto, la tarea «traer el flujo del kit» (plantillas/traer-flujo-del-kit.md, que corre scripts/kit/actualizar.mjs);
#   - del proyecto al kit: al integrar un PR que toca flujo (scripts/kit/flujo.txt), un issue `cola` «traer de <repo> el PR #<n>» en el
#     kit (plantillas/traer-de-proyecto.md), con el token de la cuenta dueña del kit.
# El kit mismo no hace ninguno de los dos. Lo carga orquestador.sh con `source`, después de al-integrar.sh; usa sus `REPO`, `ORQ`, `EST`,
# `log`, y de github.sh y cola-entrada.sh `ghc`, `REPO_GH`, `publicar_entrada` y `PUBLICADA`.

# Sin acceso al kit, la revisión semanal se vuelve a intentar a las 6 h (sin aviso: si la tarea falla al correr, ahí sí se traba).
KIT_REINTENTO_S=21600

es_el_kit() { [ -f "$REPO/.kit/plantilla" ]; }
# El proyecto puede traer el flujo: tiene la versión del kit de la que salió y el guion que trae.
kit_aplica() { ! es_el_kit && [ -f "$REPO/.kit/version" ] && [ -f "$REPO/scripts/kit/actualizar.mjs" ]; }

# ------------------------------------------------------------------------------------------------ del kit al proyecto, cada semana

# Devuelve 1 sólo si GitHub no respondió al listar los issues de este repo (el espejo lo trata como sin red). La marca de la semana
# resuelta queda en estado/.kit-semana; la espera tras un fallo al mirar el kit, en estado/.kit-reintento (epoch).
kit_semanal() {
  [ "${KIT_SEMANAL:-si}" = si ] || return 0
  kit_aplica || return 0
  local semana salida rc f
  semana=$(date -u +%G-W%V)
  [ "$(cat "$EST/.kit-semana" 2>/dev/null)" = "$semana" ] && return 0
  [ "$(date +%s)" -lt "$(cat "$EST/.kit-reintento" 2>/dev/null || echo 0)" ] && return 0
  salida=$(ghc api --paginate "repos/{owner}/{repo}/issues?labels=kit&state=open&per_page=100") || return 1
  if jq -s -e '[add[]? | select(has("pull_request") | not)] | length > 0' <<<"$salida" >/dev/null; then
    echo "$semana" >"$EST/.kit-semana"
    return 0
  fi
  salida=$(cd "$REPO" && KIT_GITHUB="${KIT_GITHUB:-}" node scripts/kit/actualizar.mjs --revisar 2>&1)
  rc=$?
  case "$rc" in
    0)
      echo "$semana" >"$EST/.kit-semana"
      log "el flujo sigue al día con el kit ($(tail -n 1 <<<"$salida"))"
      return 0
      ;;
    10) ;;
    *)
      echo $(($(date +%s) + KIT_REINTENTO_S)) >"$EST/.kit-reintento"
      log "✗ no pude mirar el kit: $(tail -n 1 <<<"$salida") (se vuelve a mirar en 6 h)"
      return 0
      ;;
  esac
  f="$EST/traer-kit-$semana.md"
  [ -e "$f" ] || sed -e "s/{{SEMANA}}/$semana/g" -e "s/{{RAMA_SEMANA}}/${semana,,}/g" "$ORQ/plantillas/traer-flujo-del-kit.md" >"$f"
  publicar_entrada "$f" kit || return 1
  if [ -n "$PUBLICADA" ]; then
    echo "$semana" >"$EST/.kit-semana"
    log "$PUBLICADA: la tarea de traer el flujo del kit ($(tail -n 1 <<<"$salida")), a la cola"
  elif [ -f "$f.error" ]; then
    # Una plantilla que no se lee es del repo: se dice una vez y no se reintenta hasta la semana siguiente.
    echo "$semana" >"$EST/.kit-semana"
    log "✗ la tarea de traer el flujo del kit no se publica: plantillas/traer-flujo-del-kit.md no se lee ($(cat "$f.error"))"
  fi
}
