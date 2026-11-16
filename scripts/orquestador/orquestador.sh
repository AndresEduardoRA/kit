#!/usr/bin/env bash
# El orquestador de ESTE proyecto: corre solo, durante días, una cola de tareas (scripts/orquestador/README.md).
# Cada proyecto lleva el suyo dentro de su repo y no sabe de los otros: su cola, su estado, su servicio y su lock son propios.
#
# Lee la cola (.orquestador/cola/T*.md), y por cada tarea lista (dependencias integradas, área libre, carril libre):
#   1. crea su worktree desde origin/main (en .orquestador/worktrees/) y lo vuelve un carril (scripts/worktree/preparar.sh);
#   2. si la spec lo pide, una sesión de `claude -p` en modo plan escribe el plan (Opus);
#   3. una sesión nueva de `claude -p` implementa, verifica y publica el PR con auto-merge (`publicar.sh --sin-esperar`);
#   4. suelta el carril y vigila el PR: integrado → borra el worktree y sigue la cola; CI rojo o choque → sesión de arreglo.
# Cada sesión arranca desde cero (nada de contexto heredado). Si se corta (límite del plan, reinicio, tiempo), se retoma desde lo
# commiteado en la rama. El estado vive en .orquestador/estado/<ID>/ como archivos de texto: sobrevive a reinicios.
#
#   bash scripts/orquestador/orquestador.sh                 el bucle (lo que corre el servicio)
#   … verificar        comprueba herramientas, cuentas, Docker, la cola y el aviso de prueba
#   … nueva <ID> <tema> crea .orquestador/cola/<ID>-<tema>.md desde la plantilla, para escribir la spec
#   … estado           la tabla de la cola
#   … plan             qué lanzaría ahora y por qué espera cada una (no lanza nada)
#   … ver <ID>         lo que va diciendo la sesión en curso de esa tarea (Ctrl+C para salir)
#   … reintentar <ID>  vuelve a poner en marcha una trabada (retoma desde su rama)
#   … omitir <ID>      la da por hecha sin hacerla (sus dependientes pueden seguir)
#   … parar <ID>       corta la sesión en curso de esa tarea (queda para retomar)
#   … pausar | reanudar   no lanza sesiones nuevas (las que corren terminan)
#   … instalar | desinstalar   el servicio de usuario de systemd de este proyecto (orquestador-<PROYECTO>)
set -uo pipefail
shopt -u patsub_replacement 2>/dev/null || true # bash ≥ 5.2: que «&» en una spec no se reemplace al armar el prompt

ORQ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# La principal del repo, aunque esto se corra desde un worktree: el padre del directorio común de git.
REPO="$(dirname "$(git -C "$ORQ" rev-parse --path-format=absolute --git-common-dir)")"
# shellcheck source=config.env
source "$ORQ/config.env"
# Lo de esta máquina (tema de ntfy, paralelo, rutas): ignorado por git. Pisa lo de config.env.
DATOS="${ORQ_DATOS:-$REPO/.orquestador}"
# shellcheck disable=SC1091
[ -f "$DATOS/config.local.env" ] && source "$DATOS/config.local.env"
COLA="$DATOS/cola"
EST="$DATOS/estado"
WTS="$DATOS/worktrees"
PROMPTS="$ORQ/prompts"
mkdir -p "$COLA" "$EST" "$WTS"

export PATH="${PATH_EXTRA:+$PATH_EXTRA:}$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  [ -f "$REPO/.nvmrc" ] && nvm use --silent "$(cat "$REPO/.nvmrc")" >/dev/null 2>&1
fi

# El repo propio, de su manifiesto (.proyecto/proyecto.yaml): PROYECTO si config.env o config.local.env no lo fijan, y la cuenta del
# token. Sin manifiesto, ni lo uno ni lo otro: PROYECTO tiene que venir fijado y la cuenta es la del remoto, como antes.
MANIFIESTO="$REPO/scripts/proyecto/manifiesto.mjs"
# Un campo del repo propio, o nada: sin manifiesto, o con uno inválido (el motivo sale por stderr: no se traga).
manifiesto() { [ -f "$REPO/.proyecto/proyecto.yaml" ] && node "$MANIFIESTO" "$1" "$REPO" || true; }
[ -n "${PROYECTO:-}" ] || PROYECTO=$(manifiesto nombre)
SERVICIO="orquestador-${PROYECTO:?falta PROYECTO: fíjalo en config.env o dalo en .proyecto/proyecto.yaml (node scripts/proyecto/manifiesto.mjs nombre)}"

# ------------------------------------------------------------------------------------------------------------------ utilidades

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$EST/orquestador.log"; printf '%s %s\n' "$(date '+%T')" "$*" >&2; }

avisar() { # titulo mensaje [prioridad: min|low|default|high|urgent] [etiquetas]
  log "AVISO · $1 · $2"
  [ -n "${NTFY_TEMA:-}" ] || return 0
  # El título lleva el proyecto: varios orquestadores pueden avisar al mismo celular.
  curl -fsS -m 15 -H "Title: [$PROYECTO] $1" -H "Priority: ${3:-default}" -H "Tags: ${4:-robot}" -d "$2" \
    "${NTFY_SERVIDOR:-https://ntfy.sh}/$NTFY_TEMA" >/dev/null 2>&1 || log "no se pudo mandar el aviso a ntfy"
}

# Frontmatter de una spec: `clave: valor` entre las dos primeras líneas `---`.
campo() {
  awk -v k="$2" 'NR==1 && $0!="---" {exit} NR>1 && $0=="---" {exit}
    NR>1 { i=index($0,":"); if (i && substr($0,1,i-1)==k) { v=substr($0,i+1); sub(/^[ \t]+/,"",v); sub(/[ \t]+$/,"",v); print v; exit } }' "$1"
}
cuerpo() { awk 'BEGIN{s=0} s<2 && $0=="---" {s++; next} s>=2' "$1"; }

# Los ids de la cola. Una spec cuyo `id` no es T<número> o no es el de su archivo no existe para el bucle: la nombra `cola_invalida`.
id_valido() { [[ "$(campo "$1" id)" =~ ^T[0-9]+$ ]] && [[ "$(basename "$1")" == "$(campo "$1" id)"[-.]* ]]; }
ids() { local f; for f in "$COLA"/T*.md; do [ -e "$f" ] && id_valido "$f" && campo "$f" id; done; }
cola_invalida() { # imprime lo que está mal en la cola; devuelve 1 si hay algo
  local f id ok=0 vistos=" "
  for f in "$COLA"/*.md; do
    [ -e "$f" ] || continue
    id=$(campo "$f" id)
    if ! id_valido "$f"; then
      echo "✗ $(basename "$f"): su «id: ${id:-(vacío)}» no es T<número> o no es el de su nombre (T07-tema.md lleva «id: T07»). No se lanza."; ok=1
      continue
    fi
    if [[ "$vistos" == *" $id "* ]]; then echo "✗ $(basename "$f"): el id $id está repetido en la cola."; ok=1; fi
    vistos="$vistos$id "
  done
  return $ok
}
spec_de() { local f; for f in "$COLA/$1"-*.md "$COLA/$1".md; do [ -e "$f" ] && { echo "$f"; return 0; }; done; return 1; }

est_get() { cat "$EST/$1/$2" 2>/dev/null || true; }
est_set() { mkdir -p "$EST/$1"; printf '%s\n' "$3" >"$EST/$1/$2.tmp" && mv "$EST/$1/$2.tmp" "$EST/$1/$2"; }
est_del() { rm -f "$EST/$1/$2"; }
estado_de() { local e; e=$(est_get "$1" estado); echo "${e:-pendiente}"; }
num() { local n; n=$(est_get "$1" "$2"); echo "${n:-0}"; }
sumar() { est_set "$1" "$2" $(($(num "$1" "$2") + 1)); }

vivo() { local p; p=$(est_get "$1" pid); [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

dueno_del_repo() { # la cuenta del manifiesto; sin manifiesto, la del remoto
  local d; d=$(manifiesto cuenta)
  [ -n "$d" ] || d=$(git -C "$REPO" remote get-url origin | sed -nE 's#.*github\.com[:/]([^/]+)/.*#\1#p')
  echo "$d"
}
token_gh() { # la cuenta dueña del repo, aunque la activa sea otra (igual que publicar.sh)
  [ -n "${GH_TOKEN:-}" ] && return 0
  local d t
  d=$(dueno_del_repo)
  if [ -n "$d" ] && t=$(gh auth token --user "$d" 2>/dev/null) && [ -n "$t" ]; then export GH_TOKEN="$t"; fi
}
ghr() { (cd "$REPO" && gh "$@"); }

pausado() {
  [ -f "$EST/.pausa-manual" ] && return 0
  local h
  h=$(cat "$EST/.pausa-hasta" 2>/dev/null || echo 0)
  [ "$(date +%s)" -lt "${h:-0}" ]
}

# ------------------------------------------------------------------------------------------------------------- cola y llaves

borrador() { [ "$(campo "$1" borrador)" = si ]; } # la spec todavía se está escribiendo: no se lanza

deps_listas() { # todas sus dependencias integradas u omitidas (y la spec misma no es un borrador)
  local d s
  borrador "$1" && return 1
  for d in $(campo "$1" depende); do
    s=$(estado_de "$d")
    case "$s" in integrado | omitida) ;; *) return 1 ;; esac
  done
}

retiene_llaves() {
  case "$1" in
    corriendo | esperando_ci | por_arreglar | por_retomar) return 0 ;;
    trabada) [ "${TRABADA_RETIENE_LLAVES:-no}" = si ] ;;
    *) return 1 ;;
  esac
}

llave_ocupada_por() { # imprime la tarea que retiene alguna llave de $1, si hay
  local id=$1 mias otra s k
  mias=$(campo "$(spec_de "$id")" conflicto)
  [ -n "$mias" ] || return 1
  for otra in $(ids); do
    [ "$otra" = "$id" ] && continue
    s=$(estado_de "$otra")
    retiene_llaves "$s" || continue
    for k in $(campo "$(spec_de "$otra")" conflicto); do
      if [[ " $mias " == *" $k "* ]]; then echo "$otra ($k)"; return 0; fi
    done
  done
  return 1
}

corriendo_ahora() { local n=0 id; for id in $(ids); do [ "$(estado_de "$id")" = corriendo ] && n=$((n + 1)); done; echo $n; }

# ------------------------------------------------------------------------------------------------------------------- el bucle

bucle() {
  exec 8>"$EST/.orquestador.lock"
  flock -n 8 || { echo "Ya hay un orquestador corriendo (.orquestador/estado/.orquestador.lock)." >&2; exit 75; }
  token_gh
  log "orquestador arriba · paralelo $PARALELO · $(ids | wc -w) tareas en la cola"
  while :; do
    revisar_procesos
    vigilar_prs
    if ! pausado; then
      lanzar
      cola_terminada
    fi
    sleep "${INTERVALO:-60}"
  done
}

# Una tarea «corriendo» cuyo proceso ya no existe (reinicio de la máquina, kill): se retoma.
revisar_procesos() {
  local id
  for id in $(ids); do
    [ "$(estado_de "$id")" = corriendo ] || continue
    vivo "$id" && continue
    log "$id: su proceso ya no está (¿reinicio?): queda para retomar"
    est_set "$id" motivo_retomar "La sesión anterior se cortó sin terminar (se reinició la máquina o el orquestador)."
    est_set "$id" estado por_retomar
  done
}

lanzar() {
  local libres id s quien
  libres=$((PARALELO - $(corriendo_ahora)))
  [ "$libres" -gt 0 ] || return 0
  # Primero lo que ya tiene trabajo hecho (arreglar y retomar), después lo nuevo en el orden de la cola.
  for pasada in arreglos nuevas; do
    for id in $(ids); do
      [ "$libres" -gt 0 ] || return 0
      s=$(estado_de "$id")
      case "$pasada:$s" in
        arreglos:por_arreglar | arreglos:por_retomar) ;;
        nuevas:pendiente)
          deps_listas "$(spec_de "$id")" || continue
          quien=$(llave_ocupada_por "$id") && continue
          ;;
        *) continue ;;
      esac
      [ -n "$(est_get "$id" espera_carril_hasta)" ] && [ "$(date +%s)" -lt "$(est_get "$id" espera_carril_hasta)" ] && continue
      est_set "$id" previo "$s"
      est_set "$id" estado corriendo
      rm -f "$EST/.terminada-avisada"
      setsid bash "$ORQ/orquestador.sh" correr "$id" >>"$EST/$id/correr.log" 2>&1 </dev/null &
      est_set "$id" pid "$!"
      log "$id: lanzada ($s → corriendo)"
      libres=$((libres - 1))
    done
  done
}

cola_terminada() {
  local id s activos=0 listas=0 bloqueadas="" trab="" hechas=0
  for id in $(ids); do
    s=$(estado_de "$id")
    case "$s" in
      integrado | omitida) hechas=$((hechas + 1)) ;;
      trabada) trab="$trab $id" ;;
      pendiente)
        if deps_listas "$(spec_de "$id")"; then listas=$((listas + 1)); else bloqueadas="$bloqueadas $id"; fi
        ;;
      *) activos=$((activos + 1)) ;;
    esac
  done
  # Sigue habiendo trabajo posible: nada que avisar.
  [ "$activos" = 0 ] && [ "$listas" = 0 ] || return 0
  [ -f "$EST/.terminada-avisada" ] && return 0
  touch "$EST/.terminada-avisada"
  if [ -n "$trab" ]; then
    avisar "Cola detenida" "$hechas integradas. Trabadas:$trab.${bloqueadas:+ Esperando a esas:$bloqueadas.} bash scripts/orquestador/orquestador.sh estado" high warning
  else
    avisar "Cola terminada" "Las $hechas tareas están integradas en main." default tada
  fi
}

# -------------------------------------------------------------------------------------------------------------- vigilar los PR

vigilar_prs() {
  local id pr j state mergeable merge_state listo
  for id in $(ids); do
    [ "$(estado_de "$id")" = esperando_ci ] || continue
    pr=$(est_get "$id" pr)
    [ -n "$pr" ] || continue
    j=$(ghr pr view "$pr" --json state,mergeable,mergeStateStatus,statusCheckRollup,headRefOid 2>/dev/null) || continue
    state=$(jq -r .state <<<"$j")
    mergeable=$(jq -r .mergeable <<<"$j")
    merge_state=$(jq -r .mergeStateStatus <<<"$j")
    listo=$(jq -r '[.statusCheckRollup[]? | select(.__typename == "CheckRun" and (.name | startswith("Listo"))) | .conclusion] | last // ""' <<<"$j")
    case "$state" in
      MERGED) integrada "$id" "$pr"; continue ;;
      CLOSED) trabar "$id" "El PR #$pr se cerró sin integrarse."; continue ;;
    esac
    if [ "$mergeable" = CONFLICTING ]; then
      a_arreglar "$id" "El PR #$pr choca con main (conflicto de merge). Lo integrado mientras tanto en main tocó lo mismo."
    elif [ "$listo" = FAILURE ] || [ "$listo" = CANCELLED ]; then
      a_arreglar "$id" "$(motivo_ci "$pr" "$j")"
    elif [ "$merge_state" = BEHIND ]; then
      # main exige la rama al día: GitHub la pone al día con un merge (nunca fuerza). Una vez cada 15 min como mucho.
      local ult
      ult=$(est_get "$id" puesta_al_dia)
      if [ "$(date +%s)" -gt $((${ult:-0} + 900)) ]; then
        est_set "$id" puesta_al_dia "$(date +%s)"
        # gh 2.46 no trae `pr update-branch`: va la API (merge, nunca fuerza; expected_head_sha evita pisar un push nuevo).
        local sha salida
        sha=$(jq -r .headRefOid <<<"$j")
        if salida=$(ghr api -X PUT "repos/{owner}/{repo}/pulls/$pr/update-branch" -f expected_head_sha="$sha" 2>&1); then
          log "$id: PR #$pr puesto al día con main"
        else
          log "$id: no se pudo poner al día el PR #$pr: $(head -c 300 <<<"$salida")"
        fi
      fi
    fi
  done
}

motivo_ci() { # pr json → texto con los jobs caídos y el final de su log
  local pr=$1 j=$2 runs r
  echo "El CI del PR #$pr cayó. Jobs en rojo:"
  jq -r '.statusCheckRollup[]? | select(.__typename == "CheckRun" and (.conclusion == "FAILURE" or .conclusion == "CANCELLED") and ((.name | startswith("Listo")) | not)) | "- \(.name) (\(.conclusion)): \(.detailsUrl)"' <<<"$j"
  runs=$(jq -r '.statusCheckRollup[]? | select(.__typename == "CheckRun" and .conclusion == "FAILURE") | .detailsUrl' <<<"$j" |
    sed -nE 's#.*/actions/runs/([0-9]+).*#\1#p' | sort -u | head -n 3)
  for r in $runs; do
    echo
    echo "### Final del log de lo que falló (run $r; completo: gh run view $r --log-failed)"
    echo '```'
    ghr run view "$r" --log-failed 2>/dev/null | tail -n 150 | cut -c1-400
    echo '```'
  done
}

a_arreglar() {
  local id=$1 motivo=$2
  sumar "$id" arreglos
  if [ "$(num "$id" arreglos)" -gt "${MAX_ARREGLOS:-4}" ]; then
    trabar "$id" "Se intentó arreglar el PR $(est_get "$id" pr) ${MAX_ARREGLOS} veces y sigue sin integrarse. Último motivo: $(head -n 3 <<<"$motivo" | tr '\n' ' ')"
    return
  fi
  printf '%s\n' "$motivo" >"$EST/$id/motivo.md"
  est_set "$id" estado por_arreglar
  log "$id: a arreglar (intento $(num "$id" arreglos)): $(head -n 1 <<<"$motivo")"
  avisar "$id: CI rojo" "Va el intento $(num "$id" arreglos) de arreglo. $(head -n 1 <<<"$motivo")" low wrench
}

integrada() {
  local id=$1 pr=$2 wt rama
  wt="$WTS/$id"
  rama=$(campo "$(spec_de "$id")" rama)
  if [ -d "$wt" ]; then
    [ -f "$wt/.env.carril" ] && (cd "$wt" && bash scripts/worktree/quitar.sh >>"$EST/$id/preparar.log" 2>&1)
    git -C "$REPO" worktree remove --force "$wt" >>"$EST/$id/correr.log" 2>&1 || log "$id: no se pudo borrar el worktree $wt (bórralo a mano)"
  fi
  git -C "$REPO" worktree prune >/dev/null 2>&1
  git -C "$REPO" branch -D "$rama" >/dev/null 2>&1 || true
  est_set "$id" estado integrado
  est_set "$id" integrado_en "$(date '+%F %T')"
  avisar "$id integrada ✓" "PR #$pr en main: $(campo "$(spec_de "$id")" titulo)" default white_check_mark
}

trabar() {
  local id=$1 motivo=$2 wt
  wt="$WTS/$id"
  [ -f "$wt/.env.carril" ] && (cd "$wt" && bash scripts/worktree/quitar.sh >>"$EST/$id/preparar.log" 2>&1)
  est_set "$id" estado trabada
  printf '%s\n' "$motivo" >"$EST/$id/trabada.md"
  avisar "$id trabada" "$motivo — revisa .orquestador/estado/$id/ y luego bash scripts/orquestador/orquestador.sh reintentar $id" high warning
}

# ----------------------------------------------------------------------------------------------------- correr una tarea (hijo)

correr() {
  ID=$1
  SPEC=$(spec_de "$ID") || { echo "no existe la spec de $ID" >&2; exit 64; }
  RAMA=$(campo "$SPEC" rama)
  TITULO=$(campo "$SPEC" titulo)
  WT="$WTS/$ID"
  PREVIO=$(est_get "$ID" previo)
  est_set "$ID" pid "$$"
  token_gh
  log "$ID: empieza ($PREVIO) en $WT"

  preparar_worktree || exit 0
  preparar_carril || exit 0

  case "$PREVIO" in
    por_arreglar) sesion arreglar || exit 0 ;;
    *)
      if [ "$(campo "$SPEC" planificar)" = si ] && [ ! -s "$EST/$ID/plan.md" ]; then
        planificar || exit 0
      fi
      if [ "$PREVIO" = por_retomar ]; then sesion retomar || exit 0; else sesion tarea || exit 0; fi
      ;;
  esac
  despues_de_la_sesion
}

volver() { # deja la tarea como estaba antes de lanzarla (sin gastar intentos)
  est_set "$ID" estado "${PREVIO:-pendiente}"
  log "$ID: vuelve a $PREVIO ($1)"
}

preparar_worktree() {
  if [ -e "$WT/.git" ]; then return 0; fi
  if ! git -C "$REPO" fetch -q origin main 2>>"$EST/$ID/correr.log"; then
    est_set "$ID" espera_carril_hasta $(($(date +%s) + 300))
    volver "no se pudo hacer git fetch (¿sin red?)"
    return 1
  fi
  git -C "$REPO" worktree prune >/dev/null 2>&1
  if git -C "$REPO" show-ref -q --verify "refs/heads/$RAMA"; then
    git -C "$REPO" worktree add -q "$WT" "$RAMA"
  elif git -C "$REPO" fetch -q origin "$RAMA" 2>/dev/null; then
    git -C "$REPO" worktree add -q -b "$RAMA" "$WT" FETCH_HEAD
  else
    git -C "$REPO" worktree add -q -b "$RAMA" "$WT" origin/main
  fi || { trabar "$ID" "No se pudo crear el worktree $WT para la rama $RAMA (mira .orquestador/estado/$ID/correr.log)."; return 1; }
  local f d
  for f in $INCLUIR; do [ -f "$REPO/$f" ] && cp -p "$REPO/$f" "$WT/$f"; done
  for d in $COMPARTIDAS; do
    if [ -e "$REPO/$d" ] && [ ! -e "$WT/$d" ]; then mkdir -p "$(dirname "$WT/$d")" && ln -s "$REPO/$d" "$WT/$d"; fi
  done
  log "$ID: worktree creado en la rama $RAMA"
}

preparar_carril() {
  local salida rc
  salida=$(cd "$WT" && bash scripts/worktree/preparar.sh 2>&1)
  rc=$?
  printf '%s\n%s\n' "--- $(date '+%F %T')" "$salida" >>"$EST/$ID/preparar.log"
  [ "$rc" = 0 ] && { est_del "$ID" fallos_carril; return 0; }
  if grep -q 'tres carriles' <<<"$salida"; then
    est_set "$ID" espera_carril_hasta $(($(date +%s) + 180))
    volver "los tres carriles están ocupados (¿tienes uno abierto con Orca?)"
    return 1
  fi
  sumar "$ID" fallos_carril
  if [ "$(num "$ID" fallos_carril)" -ge 3 ]; then
    trabar "$ID" "preparar.sh falló 3 veces (Docker, Supabase o pnpm). Mira .orquestador/estado/$ID/preparar.log."
  else
    est_set "$ID" espera_carril_hasta $(($(date +%s) + 300))
    volver "preparar.sh falló (intento $(num "$ID" fallos_carril)); se reintenta en 5 min"
  fi
  return 1
}

soltar_carril() { [ -f "$WT/.env.carril" ] && (cd "$WT" && bash scripts/worktree/quitar.sh >>"$EST/$ID/preparar.log" 2>&1); return 0; }

reemplazar() { # plantilla → prompt (las llaves {{X}} se reemplazan)
  local t
  t=$(<"$1")
  t=${t//'{{ID}}'/$ID}
  t=${t//'{{TITULO}}'/$TITULO}
  t=${t//'{{RAMA}}'/$RAMA}
  t=${t//'{{WT}}'/$WT}
  t=${t//'{{PR}}'/$(est_get "$ID" pr)}
  t=${t//'{{FECHA}}'/$(TZ=America/La_Paz date +%F)}
  t=${t//'{{CONTEXTO}}'/${CONTEXTO:-}}
  t=${t//'{{PLAN}}'/$(if [ -s "$EST/$ID/plan.md" ]; then cat "$EST/$ID/plan.md"; else echo "(Esta tarea no lleva plan previo: planifica tú mismo antes de tocar código.)"; fi)}
  t=${t//'{{MOTIVO}}'/$(cat "$EST/$ID/motivo.md" 2>/dev/null)}
  t=${t//'{{SPEC}}'/$(cuerpo "$SPEC")}
  printf '%s\n' "$t"
}

# Corre `claude -p` y deja la salida (stream-json) en estado/<ID>/. Devuelve 0 si la sesión terminó; 1 si hay que cortar aquí
# (límite del plan o tiempo agotado: la tarea ya quedó en el estado que corresponde).
claude_en_el_worktree() { # nombre modelo effort modo prompt_archivo [args extra…]
  local nombre=$1 modelo=$2 effort=$3 modo=$4 prompt=$5
  shift 5
  local salida="$EST/$ID/$nombre.jsonl" rc
  ln -sfn "$salida" "$EST/$ID/sesion-actual.jsonl"
  log "$ID: sesión $nombre ($modelo · $effort · $modo)"
  (cd "$WT" && timeout --kill-after=120 "${TIEMPO_MAX_SESION:-5h}" \
    claude -p --model "$modelo" --effort "$effort" --permission-mode "$modo" \
    --output-format stream-json --verbose "$@" <"$prompt") >"$salida" 2>"$salida.err"
  rc=$?
  RESULTADO_JSON=$(jq -c 'select(.type == "result")' "$salida" 2>/dev/null | tail -n 1)
  local rj=${RESULTADO_JSON:-'{}'} es_error
  RESULTADO_TEXTO=$(jq -r '.result // ""' <<<"$rj" 2>/dev/null)
  es_error=$(jq -r '.is_error // false' <<<"$rj" 2>/dev/null)

  if [ "$rc" = 124 ] || [ "$rc" = 137 ]; then
    soltar_carril
    retomar_luego "La sesión anterior ($nombre) se pasó de ${TIEMPO_MAX_SESION} y se cortó."
    return 1
  fi
  if { [ "$rc" != 0 ] || [ "$es_error" = true ] || [ -z "$RESULTADO_JSON" ]; } &&
    grep -qiE 'usage limit|limit reached|hit your limit|limit will reset|resets at|out of (extra )?usage|rate[ _-]?limit' "$salida.err" <(tail -n 5 "$salida"); then
    soltar_carril
    local hasta=$(($(date +%s) + ${PAUSA_POR_LIMITE_MIN:-30} * 60))
    echo "$hasta" >"$EST/.pausa-hasta"
    est_set "$ID" motivo_retomar "La sesión anterior ($nombre) se cortó por el límite del plan de Claude."
    est_set "$ID" estado "$([ "$PREVIO" = por_arreglar ] && echo por_arreglar || echo por_retomar)"
    avisar "Pausa: límite del plan" "$ID se cortó por el límite de Claude. Reintento a las $(date -d "@$hasta" '+%H:%M')." low hourglass
    return 1
  fi
  if [ "$rc" != 0 ] && [ -z "$RESULTADO_JSON" ]; then
    soltar_carril
    retomar_luego "La sesión anterior ($nombre) terminó con error $rc sin resultado: $(tail -n 3 "$salida.err" | tr '\n' ' ')"
    return 1
  fi
  return 0
}

retomar_luego() {
  sumar "$ID" retomas
  if [ "$(num "$ID" retomas)" -gt "${MAX_RETOMAS:-3}" ]; then
    trabar "$ID" "Se retomó ${MAX_RETOMAS} veces sin publicar. Último motivo: $1"
  else
    est_set "$ID" motivo_retomar "$1"
    est_set "$ID" estado por_retomar
    log "$ID: para retomar ($(num "$ID" retomas)/${MAX_RETOMAS}): $1"
  fi
}

planificar() {
  local p="$EST/$ID/prompt-plan.md" modelo effort
  modelo=$(campo "$SPEC" modelo_plan); modelo=${modelo:-$MODELO_PLANIFICAR}
  effort=$(campo "$SPEC" effort_plan); effort=${effort:-$EFFORT_PLANIFICAR}
  reemplazar "$PROMPTS/planificar.md" >"$p"
  claude_en_el_worktree plan "$modelo" "$effort" plan "$p" --disallowedTools ExitPlanMode || return 1
  if [ "${#RESULTADO_TEXTO}" -lt 800 ]; then
    soltar_carril
    retomar_luego "La sesión de plan devolvió un plan vacío o demasiado corto."
    return 1
  fi
  printf '%s\n' "$RESULTADO_TEXTO" >"$EST/$ID/plan.md"
  log "$ID: plan escrito (${#RESULTADO_TEXTO} caracteres)"
}

sesion() { # tarea | retomar | arreglar
  local tipo=$1 p modelo effort n
  n=$(($(num "$ID" sesiones) + 1))
  est_set "$ID" sesiones "$n"
  p="$EST/$ID/prompt-$n-$tipo.md"
  modelo=$(campo "$SPEC" modelo); modelo=${modelo:-$MODELO_EJECUTAR}
  effort=$(campo "$SPEC" effort); effort=${effort:-$EFFORT_EJECUTAR}
  CONTEXTO=""
  case "$tipo" in
    retomar)
      CONTEXTO=$(MOTIVO_R=$(est_get "$ID" motivo_retomar) && t=$(<"$PROMPTS/retomar.md") && printf '%s' "${t//'{{MOTIVO_RETOMAR}}'/$MOTIVO_R}")
      reemplazar "$PROMPTS/tarea.md" >"$p"
      ;;
    arreglar)
      if [ "$(num "$ID" arreglos)" -ge 3 ]; then modelo=$MODELO_ARREGLAR_DIFICIL; effort=$EFFORT_ARREGLAR_DIFICIL; fi
      reemplazar "$PROMPTS/arreglar.md" >"$p"
      ;;
    *) reemplazar "$PROMPTS/tarea.md" >"$p" ;;
  esac
  local extra=()
  [ -n "${HERRAMIENTAS_EXTRA:-}" ] && extra=(--allowedTools "$HERRAMIENTAS_EXTRA")
  claude_en_el_worktree "sesion-$n-$tipo" "$modelo" "$effort" "${MODO_EJECUTAR:-auto}" "$p" "${extra[@]}"
}

despues_de_la_sesion() {
  local linea pr local_head remoto
  linea=$(grep -oE 'RESULTADO: (PUBLICADO #[0-9]+|TRABADA.*)' <<<"$RESULTADO_TEXTO" | tail -n 1)
  soltar_carril

  if [[ "$linea" == "RESULTADO: TRABADA"* ]]; then
    trabar "$ID" "${linea#RESULTADO: }"
    return
  fi

  pr=$(ghr pr list --head "$RAMA" --state open --json number --jq '.[0].number // empty' 2>/dev/null)
  git -C "$WT" fetch -q origin "$RAMA" 2>/dev/null
  local_head=$(git -C "$WT" rev-parse HEAD 2>/dev/null)

  # Un PR chico puede integrarse antes de que esta función mire: ya no está abierto y GitHub borró su rama. Si el PR integrado
  # es el de esta punta y no quedó nada sin commitear, la tarea terminó: no se retoma.
  if [ -z "$pr" ] && [ -n "$local_head" ] && [ -z "$(git -C "$WT" status --porcelain 2>/dev/null)" ]; then
    local hecho
    hecho=$(ghr pr list --head "$RAMA" --state merged --json number,headRefOid \
      --jq "[.[] | select(.headRefOid == \"$local_head\")][0].number // empty" 2>/dev/null)
    if [ -n "$hecho" ]; then
      est_set "$ID" pr "$hecho"
      est_del "$ID" motivo_retomar
      log "$ID: el PR #$hecho ya estaba integrado al terminar la sesión"
      integrada "$ID" "$hecho"
      return
    fi
  fi
  remoto=$(git -C "$WT" rev-parse "origin/$RAMA" 2>/dev/null || true)

  if [ -n "$pr" ] && [ "$local_head" = "$remoto" ] && [ -z "$(git -C "$WT" status --porcelain 2>/dev/null)" ]; then
    est_set "$ID" pr "$pr"
    est_set "$ID" estado esperando_ci
    est_del "$ID" motivo_retomar
    log "$ID: publicado, PR #$pr esperando al CI"
    return
  fi
  local por_que="La sesión anterior terminó sin dejar el PR publicado y al día."
  [ -z "$pr" ] && por_que="$por_que No hay PR abierto para $RAMA."
  [ -n "$pr" ] && [ "$local_head" != "$remoto" ] && por_que="$por_que La rama local tiene commits sin empujar."
  [ -n "$(git -C "$WT" status --porcelain 2>/dev/null)" ] && por_que="$por_que Quedaron cambios sin commitear."
  [ -n "$pr" ] && est_set "$ID" pr "$pr"
  if [ "$PREVIO" = por_arreglar ]; then
    printf '%s\n\n(%s)\n' "$(cat "$EST/$ID/motivo.md" 2>/dev/null)" "$por_que" >"$EST/$ID/motivo.md"
    sumar "$ID" arreglos
    if [ "$(num "$ID" arreglos)" -gt "${MAX_ARREGLOS:-4}" ]; then trabar "$ID" "$por_que"; else est_set "$ID" estado por_arreglar; fi
  else
    retomar_luego "$por_que"
  fi
}

# --------------------------------------------------------------------------------------------------------------- comandos

cmd_estado() {
  local id s pr extra
  cola_invalida
  printf '%-4s %-13s %-6s %-5s %s\n' ID ESTADO PR INT TÍTULO
  for id in $(ids); do
    s=$(estado_de "$id")
    pr=$(est_get "$id" pr)
    extra=""
    [ "$s" = corriendo ] && ! vivo "$id" && extra=" (proceso muerto)"
    printf '%-4s %-13s %-6s %-5s %s%s\n' "$id" "$s" "${pr:+#$pr}" "$(num "$id" retomas)/$(num "$id" arreglos)" \
      "$(campo "$(spec_de "$id")" titulo | cut -c1-70)" "$extra"
  done
  echo
  if [ -f "$EST/.pausa-manual" ]; then echo "⏸  En pausa manual (bash scripts/orquestador/orquestador.sh reanudar)."; fi
  if pausado && [ ! -f "$EST/.pausa-manual" ]; then echo "⏸  En pausa por el límite del plan hasta las $(date -d "@$(cat "$EST/.pausa-hasta")" '+%H:%M')."; fi
  echo "INT = retomas/arreglos. Trabadas: el motivo está en .orquestador/estado/<ID>/trabada.md"
}

cmd_plan() {
  local id s quien d faltan
  cola_invalida
  for id in $(ids); do
    s=$(estado_de "$id")
    case "$s" in
      pendiente)
        faltan=""
        for d in $(campo "$(spec_de "$id")" depende); do
          case "$(estado_de "$d")" in integrado | omitida) ;; *) faltan="$faltan $d" ;; esac
        done
        if borrador "$(spec_de "$id")"; then echo "$id  borrador (quita «borrador: si» cuando la spec esté lista)"
        elif [ -n "$faltan" ]; then echo "$id  espera dependencias:$faltan"
        elif quien=$(llave_ocupada_por "$id"); then echo "$id  espera el área que ocupa $quien"
        else echo "$id  LISTA para lanzar"; fi
        ;;
      *) echo "$id  $s" ;;
    esac
  done
}

cmd_ver() {
  local f="$EST/$1/sesion-actual.jsonl"
  [ -e "$f" ] || { echo "$1 no tiene sesión todavía." >&2; exit 1; }
  echo "Siguiendo $(readlink -f "$f") (Ctrl+C para salir)…"
  tail -n +1 -F "$f" | jq --unbuffered -r '
    if .type == "assistant" then (.message.content[]? | if .type == "text" then "💬 " + .text elif .type == "tool_use" then "🔧 " + .name + " " + ((.input.command // .input.file_path // .input.pattern // .input.description // "") | tostring | .[0:160]) else empty end)
    elif .type == "result" then "🏁 " + (.result // "" | .[-400:])
    else empty end' 2>/dev/null
}

cmd_reintentar() {
  local id=$1
  spec_de "$id" >/dev/null || { echo "no existe $id" >&2; exit 64; }
  est_set "$id" retomas 0
  est_set "$id" arreglos 0
  est_del "$id" fallos_carril
  est_del "$id" espera_carril_hasta
  rm -f "$EST/$id/trabada.md"
  if [ -n "$(est_get "$id" pr)" ] && [ -s "$EST/$id/motivo.md" ]; then
    est_set "$id" estado por_arreglar
  elif [ -e "$WTS/$id/.git" ]; then
    est_set "$id" motivo_retomar "La persona pidió reintentar esta tarea después de que quedó trabada. Revisa qué quedó hecho y termínala."
    est_set "$id" estado por_retomar
  else
    est_set "$id" estado pendiente
  fi
  echo "$id → $(estado_de "$id")"
}

cmd_parar() {
  local id=$1 p
  p=$(est_get "$id" pid)
  # setsid le dio su propia sesión: se corta todo lo que cuelga de ella (timeout y claude incluidos).
  [ -n "$p" ] && pkill -TERM -s "$p" 2>/dev/null
  sleep 3
  [ -n "$p" ] && pkill -KILL -s "$p" 2>/dev/null
  [ -f "$WTS/$id/.env.carril" ] && (cd "$WTS/$id" && bash scripts/worktree/quitar.sh)
  est_set "$id" motivo_retomar "La persona cortó la sesión anterior a mano."
  est_set "$id" estado por_retomar
  echo "$id cortada; queda para retomar (bash scripts/orquestador/orquestador.sh pausar si no quieres que vuelva a arrancar)."
}

cmd_verificar() {
  local ok=1 c d id f
  echo "== Herramientas"
  for c in git gh jq claude pnpm node docker flock timeout setsid curl; do
    if command -v "$c" >/dev/null; then echo "✓ $c"; else echo "✗ falta $c"; ok=0; fi
  done
  claude --version 2>/dev/null | sed 's/^/  claude /'
  claude --help 2>/dev/null | grep -q -- '--effort' || { echo "✗ tu claude no tiene --effort: claude update"; ok=0; }
  echo "== Repo ($PROYECTO)"
  [ -d "$REPO/.git" ] && echo "✓ $REPO" || { echo "✗ no hay repo en $REPO"; ok=0; }
  git -C "$REPO" check-ignore -q "$DATOS/estado" 2>/dev/null || [ "${DATOS#"$REPO"/}" = "$DATOS" ] ||
    { echo "✗ $DATOS está dentro del repo y git no lo ignora (.gitignore)"; ok=0; }
  echo "✓ datos en $DATOS"
  for f in $INCLUIR; do [ -f "$REPO/$f" ] && echo "✓ $f" || echo "· falta $f en la principal (preparar.sh puede quejarse)"; done
  echo "== GitHub"
  token_gh
  if ghr api user --jq .login >/dev/null 2>&1; then echo "✓ gh con la cuenta $(ghr api user --jq .login)"; else echo "✗ gh sin sesión para $(dueno_del_repo) (gh auth login)"; ok=0; fi
  [ "$(ghr api 'repos/{owner}/{repo}' --jq .allow_auto_merge 2>/dev/null)" = true ] && echo "✓ auto-merge permitido en el repo" || { echo "✗ el repo no permite auto-merge"; ok=0; }
  echo "== Docker"
  docker info >/dev/null 2>&1 && echo "✓ docker responde" || { echo "✗ docker no responde"; ok=0; }
  free -g 2>/dev/null | awk '/Mem:/ {print "  RAM: " $2 " GB en total, " $7 " GB disponibles (cada carril con Supabase y un e2e ronda 3-4 GB)"}'
  echo "== Claude (una llamada mínima)"
  if echo 'Responde exactamente: ok' | claude -p --model sonnet --effort low --permission-mode "${MODO_EJECUTAR:-auto}" --output-format json 2>/dev/null | jq -e '.result | test("ok"; "i")' >/dev/null; then
    echo "✓ claude -p responde en modo ${MODO_EJECUTAR:-auto}"
  else
    echo "✗ claude -p no respondió en modo ${MODO_EJECUTAR:-auto} (¿sesión iniciada? ¿tu versión tiene ese modo? prueba MODO_EJECUTAR=acceptEdits)"; ok=0
  fi
  echo "== Cola"
  cola_invalida || ok=0
  for id in $(ids); do
    f=$(spec_de "$id")
    [ -n "$(campo "$f" rama)" ] && [ -n "$(campo "$f" titulo)" ] || { echo "✗ $id sin rama o título"; ok=0; }
    for d in $(campo "$f" depende); do spec_de "$d" >/dev/null || { echo "✗ $id depende de $d, que no existe"; ok=0; }; done
  done
  echo "✓ $(ids | wc -w) tareas leídas"
  echo "== Estado del repo (scripts/flujo/estado.sh: un PR abierto o un CI en rojo van antes que la cola)"
  (cd "$REPO" && bash scripts/flujo/estado.sh 2>&1 | sed 's/^/  /') || true
  echo "== Aviso de prueba"
  avisar "Orquestador $PROYECTO" "Aviso de prueba: si lo ves en el celular, ntfy funciona." low test_tube
  echo "  (mira el celular)"
  echo
  [ "$ok" = 1 ] && echo "Todo listo." || { echo "Hay cosas que arreglar arriba."; exit 1; }
}

cmd_nueva() { # ID tema
  local id=${1:-} tema=${2:-} f
  [[ "$id" =~ ^T[0-9]+$ ]] && [ -n "$tema" ] || { echo "uso: nueva T23 tema-en-kebab" >&2; exit 64; }
  spec_de "$id" >/dev/null && { echo "ya existe $(spec_de "$id")" >&2; exit 64; }
  f="$COLA/$id-$tema.md"
  [[ "$tema" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "el tema va en kebab (minúsculas, números y guiones): $tema" >&2; exit 64; }
  sed -e "s/{{ID}}/$id/g" -e "s/{{TEMA}}/$tema/g" "$ORQ/plantilla-tarea.md" >"$f"
  # La plantilla tiene que haber dejado una spec que el bucle lea: si un formateador le tocó los marcadores, se dice aquí y no al lanzar.
  if ! id_valido "$f" || grep -q '{{' "$f"; then
    rm -f "$f"
    echo "✗ scripts/orquestador/plantilla-tarea.md está dañada: no dejó «id: $id» o le quedaron marcadores {{…}} sin reemplazar." >&2
    exit 70
  fi
  echo "Escribe la spec en $f y quita la línea «borrador: si»: recién entonces el orquestador la toma."
}

cmd_instalar() {
  local u="$HOME/.config/systemd/user/$SERVICIO.service"
  mkdir -p "$(dirname "$u")"
  cat >"$u" <<UNIT
# Lo escribe \`bash scripts/orquestador/orquestador.sh instalar\` en $REPO. No se edita: se vuelve a instalar.
[Unit]
Description=Orquestador de la cola de tareas de $PROYECTO (claude -p)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO
ExecStart=/usr/bin/env bash $ORQ/orquestador.sh
Restart=on-failure
RestartSec=60
# Al parar el servicio se cortan también las sesiones en curso; al volver, se retoman desde su rama.
KillMode=control-group
TimeoutStopSec=30
Environment=HOME=$HOME
Environment=PATH=${PATH_EXTRA:+$PATH_EXTRA:}/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now "$SERVICIO"
  echo "✓ $SERVICIO instalado y en marcha. Su log: journalctl --user -u $SERVICIO -f"
  echo "  Para que siga sin sesión abierta y arranque al encender (una vez por máquina): loginctl enable-linger \"\$USER\""
}

cmd_desinstalar() {
  systemctl --user disable --now "$SERVICIO" 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/$SERVICIO.service"
  systemctl --user daemon-reload
  echo "✓ $SERVICIO quitado. La cola y el estado siguen en $DATOS."
}

case "${1:-bucle}" in
  bucle) bucle ;;
  correr) correr "$2" ;;
  estado) cmd_estado ;;
  plan) cmd_plan ;;
  ver) cmd_ver "$2" ;;
  reintentar) cmd_reintentar "$2" ;;
  omitir) est_set "$2" estado omitida && echo "$2 omitida" ;;
  parar) cmd_parar "$2" ;;
  pausar) touch "$EST/.pausa-manual" && echo "En pausa: no lanza nuevas; las que corren terminan." ;;
  reanudar) rm -f "$EST/.pausa-manual" "$EST/.pausa-hasta" && echo "Reanudado." ;;
  verificar) cmd_verificar ;;
  nueva) cmd_nueva "${2:-}" "${3:-}" ;;
  instalar) cmd_instalar ;;
  desinstalar) cmd_desinstalar ;;
  *) sed -n '2,24p' "$0"; exit 64 ;;
esac
