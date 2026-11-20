# shellcheck shell=bash
# Un e2e que cae en `main` y no es de la rama (README.md › «Un e2e roto en main»): la sesión de arreglo no lo arregla ni se traba, termina
# con `RESULTADO: AJENO — <spec>:<línea> [<proyecto>] — <evidencia>` y el orquestador hace el resto sin que nadie conteste:
#   1. `ajeno_de_la_sesion`: la tarea queda `esperando_ci` con lo que dijo la sesión (`ajeno_spec`, `ajeno_proyecto`, `ajeno_evidencia`)
#      y el intento de arreglo no se gasta (no cuenta para MAX_ARREGLOS; MAX_AJENOS acota los AJENO de una tarea).
#   2. `ajeno_resolver`: si no hay una tarea viva de la cola para ese `<spec>:<línea>`, crea la urgente desde
#      plantillas/e2e-roto-en-main.md (rama `fix/e2e-main-<slug>`, urgente); suma su T<m> al `depende` de la tarea que la
#      encontró y la deja esperando (`espera_a`). Una urgente por `<spec>:<línea>`: dos tareas con el mismo spec esperan a la misma.
#      Sin red, la tarea sigue esperando y `vigilar_prs` lo reintenta en la vuelta siguiente.
#   3. `esperar_al_arreglo_de_main` (en cada vuelta de `vigilar_prs`): mientras la urgente no se integre, el rojo del PR no abre sesión;
#      al integrarse, la rama se pone al día con main sin sesión (la API de GitHub, un merge) y vuelve a esperar al CI. Si
#      después cae otra cosa, sigue el camino de siempre.
# Lo carga orquestador.sh con `source`; usa sus `EST`, `WTS`, `ORQ`, `PREVIO`, `log`, `avisar`, `campo`, `cuerpo`, `ids`, `spec_de`,
# `estado_de`, `est_get`, `est_set`, `est_del`, `num`, `sumar`, `urgente`, `ghr`, `comentar`, `con_issues`, `dep_lista`, `trabar` y
# `publicar_entrada`; y `poner_al_dia_sin_sesion` si el proyecto la tiene (si no, la API).

# `RESULTADO: AJENO — <spec>:<línea> [<proyecto>] — <evidencia>`: el spec con su ruta, la línea y la evidencia son obligatorios.
AJENO_FORMA='^RESULTADO: AJENO — ([A-Za-z0-9_./-]+\.spec\.ts):([0-9]+)( \[[A-Za-z0-9_-]+\])? — (.+)$'
# Cuántos AJENO puede decir una tarea antes de trabarse: si el spec sigue cayendo tras integrarse su urgente, algo no cierra.
MAX_AJENOS=${MAX_AJENOS:-3}
# Tras ponerse al día, GitHub todavía muestra unos minutos el rojo de la punta vieja (segundos).
AJENO_VENTANA_S=600

# spec línea → el nombre de la rama y del archivo: `e2e/plantilla-postgrest.spec.ts` 59 → `plantilla-postgrest-59`.
ajeno_slug() {
  local s=${1#./}
  s=${s#e2e/}
  s=${s%.spec.ts}
  s=$(tr '[:upper:]' '[:lower:]' <<<"$s" | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')
  echo "${s:-spec}-$2"
}

# Algo de la cola (viva o no) con esa rama.
ajeno_rama_usada() {
  local otra
  for otra in $(ids); do [ "$(campo "$(spec_de "$otra")" rama)" = "$1" ] && return 0; done
  return 1
}

# id spec línea → imprime la tarea viva de la cola que ya arregla ese spec: la de su rama, o una urgente que nombra `<spec>:<línea>`
# (la del e2e de la noche, por ejemplo).
ajeno_urgente_viva() {
  local propia=$1 otra f rama
  rama="fix/e2e-main-$(ajeno_slug "$2" "$3")"
  for otra in $(ids); do
    [ "$otra" = "$propia" ] && continue
    case "$(estado_de "$otra")" in integrado | omitida) continue ;; esac
    f=$(spec_de "$otra") || continue
    if [ "$(campo "$f" rama)" = "$rama" ] || { urgente "$f" && cuerpo "$f" | grep -qF -- "$2:$3"; }; then
      echo "$otra"
      return 0
    fi
  done
  return 1
}

# id spec línea proyecto evidencia → imprime T<m>, la urgente nueva. 1: GitHub no respondió (se reintenta); 2: la plantilla no se lee o la
# cola no está en los issues (no hay con qué crearla).
ajeno_crear_urgente() {
  local id=$1 spec=$2 linea=$3 proyecto=$4 evidencia=$5 slug n=1 t f pr evid
  con_issues || return 2
  slug=$(ajeno_slug "$spec" "$linea")
  while ajeno_rama_usada "fix/e2e-main-$slug"; do
    n=$((n + 1))
    slug="$(ajeno_slug "$spec" "$linea")-$n"
  done
  pr=$(est_get "$id" pr)
  evid=$(tr '\r\n' '  ' <<<"$evidencia" | cut -c1-600)
  f="$EST/e2e-roto-$slug.md"
  t=$(<"$ORQ/plantillas/e2e-roto-en-main.md")
  t=${t//'{{SLUG}}'/$slug}
  t=${t//'{{SPEC}}'/$spec}
  t=${t//'{{LINEA}}'/$linea}
  t=${t//'{{PROYECTO}}'/${proyecto:-escritorio}}
  t=${t//'{{TAREA}}'/$id}
  t=${t//'{{PR}}'/$pr}
  printf '%s\n' "${t//'{{EVIDENCIA}}'/$evid}" >"$f"
  publicar_entrada "$f" || return 1
  if [ -n "${PUBLICADA:-}" ]; then
    echo "$PUBLICADA"
    return 0
  fi
  [ -f "$f.error" ] && log "✗ la tarea del e2e roto en main no se publica: plantillas/e2e-roto-en-main.md no se lee ($(cat "$f.error"))"
  return 2
}

# id T<m> → suma m al `depende` de la spec de id (sin repetirlo). El espejo sube el cambio al issue.
ajeno_sumar_depende() {
  local f tmp
  f=$(spec_de "$1") || return 1
  [[ " $(campo "$f" depende) " == *" $2 "* ]] && return 0
  tmp=$(mktemp)
  awk -v d="$2" '
    NR == 1 { print; next }
    !fin && $0 == "---" { if (!visto) print "depende: " d; fin = 1; print; next }
    !fin && /^depende:/ { visto = 1; v = $0; sub(/^depende:[ \t]*/, "", v); print (v == "" ? "depende: " d : $0 " " d); next }
    { print }' "$f" >"$tmp" && cat "$tmp" >"$f"
  rm -f "$tmp"
}

# id → olvida la espera (lo que dijo la sesión y la urgente de la que se esperaba).
ajeno_olvidar() {
  local k
  for k in ajeno_spec ajeno_proyecto ajeno_evidencia espera_a; do est_del "$1" "$k"; done
}

# id → la tarea espera a la urgente de su `ajeno_spec`: la busca o la crea, la suma a su `depende` y avisa. 0 si ya espera a una
# (o se trabó); 1 si GitHub no respondió: sigue esperando y se reintenta en la vuelta siguiente.
ajeno_resolver() {
  local id=$1 clave spec linea m rc=0 aviso
  clave=$(est_get "$id" ajeno_spec)
  spec=${clave%:*}
  linea=${clave##*:}
  [ -z "$(est_get "$id" espera_a)" ] || return 0
  if m=$(ajeno_urgente_viva "$id" "$spec" "$linea"); then
    aviso="ya la arregla $m"
  else
    m=$(ajeno_crear_urgente "$id" "$spec" "$linea" "$(est_get "$id" ajeno_proyecto)" "$(cat "$EST/$id/ajeno_evidencia" 2>/dev/null)") || rc=$?
    if [ "$rc" = 1 ]; then
      log "$id: no pude crear la tarea del e2e roto en main ($clave): sigue esperando y reintento en la vuelta siguiente"
      return 1
    fi
    if [ "$rc" != 0 ]; then
      ajeno_olvidar "$id"
      trabar "$id" "El CI del PR $(est_get "$id" pr) cae en $clave, que también cae en main, pero no pude crear su tarea urgente (la cola no está en los issues o plantillas/e2e-roto-en-main.md no se lee). Evidencia: $(cat "$EST/$id/ajeno_evidencia" 2>/dev/null)"
      return 0
    fi
    aviso="creé $m"
  fi
  ajeno_sumar_depende "$id" "$m"
  est_set "$id" espera_a "$m"
  log "$id: espera a $m (e2e roto en main: $clave; $aviso)"
  avisar "$id espera a $m" "$id espera a $m (e2e roto en main: $spec)" low hourglass "$(enlace_issue "$m")"
  comentar "$id" "el rojo de este PR es \`$clave\`, que también cae en main y la rama no toca: espero a $m, que lo arregla, y después pongo la rama al día con main sin abrir sesión." >/dev/null
  return 0
}

# id línea → 0 si dejó a la tarea esperando (una sesión de arreglo dijo AJENO); 1 si no vale: deja en AJENO_MOTIVO el motivo para trabarla.
ajeno_de_la_sesion() {
  local id=$1 linea=$2 spec fila proyecto evidencia veces
  AJENO_MOTIVO=""
  if [ "${PREVIO:-}" != por_arreglar ] || [ -z "$(est_get "$id" pr)" ]; then
    AJENO_MOTIVO="La sesión dijo AJENO (${linea#RESULTADO: AJENO — }) sin ser un arreglo de un PR: sólo un arreglo con su PR puede esperar a main."
    return 1
  fi
  if ! [[ "$linea" =~ $AJENO_FORMA ]]; then
    AJENO_MOTIVO="La sesión dijo AJENO sin «<spec>:<línea>» válido ($linea): va RESULTADO: AJENO — <spec>.spec.ts:<línea> [<proyecto>] — <evidencia>. Se trata como trabada."
    return 1
  fi
  spec=${BASH_REMATCH[1]#./}
  fila=${BASH_REMATCH[2]}
  proyecto=${BASH_REMATCH[3]# \[}
  proyecto=${proyecto%\]}
  evidencia=${BASH_REMATCH[4]}
  veces=$(num "$id" ajenos)
  if [ "$veces" -ge "$MAX_AJENOS" ]; then
    AJENO_MOTIVO="Ya se esperó $veces veces a un e2e roto en main y el PR $(est_get "$id" pr) sigue sin integrarse. Último: $spec:$fila — $evidencia"
    return 1
  fi
  sumar "$id" ajenos
  # El arreglo no se gastó: la causa no es de la tarea.
  veces=$(num "$id" arreglos)
  [ "$veces" -le 0 ] || est_set "$id" arreglos $((veces - 1))
  est_set "$id" ajeno_spec "$spec:$fila"
  est_set "$id" ajeno_proyecto "$proyecto"
  printf '%s\n' "$evidencia" >"$EST/$id/ajeno_evidencia"
  est_del "$id" espera_a
  est_del "$id" espera_sha
  est_del "$id" espera_hasta
  est_del "$id" motivo_retomar
  est_set "$id" estado esperando_ci
  log "$id: la sesión de arreglo dice que $spec:$fila cae también en main: espera a su tarea urgente"
  ajeno_resolver "$id" || true
  return 0
}

# id pr json-del-pr → 0 si esta vuelta ya está resuelta para el PR (espera a la urgente, o recién puesto al día y GitHub todavía muestra
# el rojo de la punta vieja); 1 si el rojo (o el verde) se atiende como siempre.
esperar_al_arreglo_de_main() {
  local id=$1 j=$3 sha m merge_state rc
  sha=$(jq -r .headRefOid <<<"$j")
  if [ -z "$(est_get "$id" ajeno_spec)" ]; then
    [ -n "$sha" ] && [ "$(est_get "$id" espera_sha)" = "$sha" ] && [ "$(date +%s)" -lt "$(num "$id" espera_hasta)" ] && return 0
    return 1
  fi
  if [ -z "$(est_get "$id" espera_a)" ]; then
    ajeno_resolver "$id" || return 0
    [ "$(estado_de "$id")" = esperando_ci ] || return 0
  fi
  m=$(est_get "$id" espera_a)
  dep_lista "$m" || return 0 # sigue esperando: `plan` dice a quién
  # La urgente se integró (o la persona la dio por hecha): la rama se pone al día con main y vuelve a esperar al CI.
  est_set "$id" espera_sha "$sha"
  merge_state=$(jq -r .mergeStateStatus <<<"$j")
  rc=0
  ajeno_al_dia "$id" "$2" "$sha" || rc=$?
  if [ "$rc" = 0 ]; then
    est_set "$id" espera_hasta $(($(date +%s) + AJENO_VENTANA_S))
    ajeno_olvidar "$id"
    log "$id: $m integrada: el PR #$2 se puso al día con main sin abrir una sesión; vuelve a esperar al CI"
    return 0
  fi
  if [ "$rc" = 1 ] && [[ "$merge_state" == BEHIND || "$merge_state" == UNKNOWN ]]; then
    log "$id: $m integrada pero no pude poner al día el PR #$2: reintento en la vuelta siguiente"
    return 0
  fi
  # Ya al día (o con un choque, que atiende vigilar_prs): lo que caiga ahora se atiende como siempre.
  ajeno_olvidar "$id"
  est_del "$id" espera_sha
  return 1
}

# id pr sha → 0 puesta al día (hay una punta nueva en camino); 1 no se pudo; 2 la rama ya tenía todo main.
ajeno_al_dia() {
  local id=$1 pr=$2 sha=$3
  # Un proyecto que pone al día la rama desde el worktree de la tarea (`poner_al_dia_sin_sesion`) lo usa primero.
  if declare -F poner_al_dia_sin_sesion >/dev/null && poner_al_dia_sin_sesion "$id" "$pr"; then
    [ "$(git -C "$WTS/$id" rev-parse HEAD 2>/dev/null)" != "$sha" ] && return 0
    return 2
  fi
  # La API (o, sin worktree limpio, después de intentarlo) hace el merge, nunca fuerza, y no pisa un push nuevo (expected_head_sha).
  ghr api -X PUT "repos/{owner}/{repo}/pulls/$pr/update-branch" -f expected_head_sha="$sha" >/dev/null 2>&1
}

# id → « · espera a T<m> (e2e roto en main: <spec>:<línea>; <estado de T<m>>)» para `plan` y `estado`, o nada.
linea_de_espera() {
  local m
  m=$(est_get "$1" espera_a)
  [ -n "$m" ] || { [ -n "$(est_get "$1" ajeno_spec)" ] && echo " · espera crear la tarea del e2e roto en main ($(est_get "$1" ajeno_spec))"; return 0; }
  echo " · espera a $m (e2e roto en main: $(est_get "$1" ajeno_spec); $m está $(estado_de "$m"))"
}
