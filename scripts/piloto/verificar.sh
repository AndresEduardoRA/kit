#!/usr/bin/env bash
# La verificación del bucle, después de un paso «listo» (el modelo no verifica por él: este script no le cree al «listo»).
#
#   verificar.sh <HEAD de arranque> <ultimo.json>
#
# En orden y parando en el primer rojo: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `mapa.sh --check`, `pnpm db:probar` si el rango
# `<HEAD de arranque>..HEAD` toca `supabase/`, y los e2e dirigidos que lista `ultimo.json` (`pnpm test:e2e <specs…>`, que toma el
# candado de la base) en escritorio y, sólo si `nivel.mjs` dice que el rango toca interfaz, también en móvil. Kit: además corre el
# comando de terminado del plan (`verificacion.comando`) y, si el plan o el rango piden Nivel 2, `pnpm test:e2e:completo`; los scripts
# que el proyecto no tenga (db:probar, test:e2e:completo, mapa.sh) se saltan. Si todo pasó deja la huella verde (`huella.sh --escribir`) para que el hook Stop
# no repita la suite. Sale con 1 y dice qué falló; sin la base libre, o sin una función que un spec llama, es un rojo, no un verde.
# Un rojo termina con la cola de su salida y, en la última línea, «verificar: <nombre> falló: <causa>»: con esa línea arma el bucle
# el aviso (`cierre.sh`). Cada salida queda en `.piloto/salidas/<paso>/verificar-<nombre>.log`. Se prueba en `verificar.test.ts`.
set -uo pipefail
# shellcheck source=comun.sh
source "$(dirname "${BASH_SOURCE[0]}")/comun.sh"
cd "$RAIZ" || exit 1

DESDE="${1:-}"
ULTIMO="${2:-}"
[ -n "$DESDE" ] || { echo "verificar: falta el HEAD de arranque." >&2; exit 1; }
jq -e 'type == "object"' "$ULTIMO" >/dev/null 2>&1 || { echo "verificar: $ULTIMO no es un ultimo.json legible." >&2; exit 1; }

PASO=$(jq -r '.paso // "sin-paso"' "$ULTIMO")
SALIDAS="$ESTADO/salidas/${PASO//[^A-Za-z0-9._-]/_}"
mkdir -p "$SALIDAS"

# Por qué cayó, en una línea del log. Un e2e rojo: la cabecera de la prueba que Playwright imprime antes de su error
# («  1) [escritorio] › e2e/x.spec.ts:33:5 › título ───»), sin la numeración ni los ─, y la primera «Error:» que la sigue, cortada en
# 300 caracteres (el aviso del 4.13-3b no decía qué prueba había caído). Si no: la primera «Error:»; si no hay, la primera con ✘, FAIL
# o error; si tampoco, el log, cortada en 200. Sin colores ni sangría, por caracteres y no bytes (`LC_ALL` local). La cola del log
# termina en el pie de la herramienta, no en esto.
causa() {
  local log="$1" linea cabecera n error LC_ALL=C.UTF-8
  cabecera=$(grep -m1 -nE '^[[:space:]]*[0-9]+\) \[[^]]+\] › ' < <(sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$log"))
  if [ -n "$cabecera" ]; then
    n="${cabecera%%:*}"
    linea=$(sed -E 's/^[[:space:]]*[0-9]+\) //; s/[[:space:]]*(─)+[[:space:]]*$//; s/[[:space:]]+$//' <<<"${cabecera#*:}")
    error=$(grep -m1 -F 'Error:' < <(sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$log" | tail -n +"$((n + 1))"))
    error="${error#"${error%%[![:space:]]*}"}"
    [ -n "$error" ] && linea="$linea — $error"
    printf '%s' "${linea:0:300}"
    return
  fi
  # grep lee por sustitución de proceso: con `pipefail`, un `sed | grep -m1` que corta temprano daría el SIGPIPE de sed como falla.
  linea=$(grep -m1 -F 'Error:' < <(sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$log")) ||
    linea=$(grep -m1 -E '✘|FAIL|error' < <(sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$log")) ||
    linea="ver $log"
  linea="${linea#"${linea%%[![:space:]]*}"}"
  printf '%s' "${linea:0:200}"
}

correr() {
  local nombre="$1" log
  shift
  log="$SALIDAS/verificar-$nombre.log"
  echo "verificar: $nombre…" >&2
  if ! "$@" >"$log" 2>&1; then
    echo "verificar: $nombre falló (salida completa: $log):" >&2
    tail -n 30 "$log" >&2
    echo "verificar: $nombre falló: $(causa "$log")" >&2
    exit 1
  fi
}

tiene_script() { jq -e --arg s "$1" '.scripts[$s] != null' package.json >/dev/null 2>&1; }

correr lint pnpm lint
correr typecheck pnpm typecheck
correr test pnpm test
[ -f scripts/mapa.sh ] && correr mapa bash scripts/mapa.sh --check

if git diff --name-only "$DESDE..HEAD" | grep -q '^supabase/' && tiene_script db:probar; then
  correr db-probar pnpm db:probar
fi

# Kit: el criterio de terminado del plan (`verificacion.comando` del paso, de .piloto/paso.json). Lo corre el bucle, no el modelo.
PASO_JSON="$ESTADO/paso.json"
COMANDO=$(jq -r '.verificacion.comando // empty' "$PASO_JSON" 2>/dev/null)
[ -n "$COMANDO" ] && correr terminado bash -c "$COMANDO"

mapfile -t SPECS < <(jq -r '.e2e_dirigidos[]? // empty' "$ULTIMO")
if [ "${#SPECS[@]}" -gt 0 ]; then
  INTERFAZ=$(node "$BIN/nivel.mjs" --rango "$DESDE..HEAD" | jq -r '.toca_interfaz') || {
    echo "verificar: nivel.mjs no pudo leer el rango." >&2
    exit 1
  }
  PROYECTOS=(--project=escritorio)
  [ "$INTERFAZ" = true ] && PROYECTOS+=(--project=movil)
  correr e2e pnpm test:e2e "${SPECS[@]}" "${PROYECTOS[@]}"
fi

# El Nivel 2 que pide el plan (o el que dispara el rango: nivel.mjs): el e2e completo desde la base reseteada.
NIVEL_PLAN=$(jq -r '.verificacion.nivel // 1' "$PASO_JSON" 2>/dev/null)
NIVEL_RANGO=$(node "$BIN/nivel.mjs" --rango "$DESDE..HEAD" | jq -r '.nivel' 2>/dev/null || echo 1)
if { [ "${NIVEL_PLAN:-1}" -ge 2 ] || [ "${NIVEL_RANGO:-1}" -ge 2 ]; } && tiene_script test:e2e:completo; then
  correr e2e-completo pnpm test:e2e:completo
fi

bash "$BIN/huella.sh" --escribir
echo "verificar: todo en verde." >&2
