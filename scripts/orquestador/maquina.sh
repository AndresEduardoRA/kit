# shellcheck shell=bash
# Lo que comparten todos los orquestadores de una máquina (scripts/orquestador/README.md › «Uno por proyecto»): los turnos de sesión.
# Cada proyecto tiene su orquestador, pero la RAM es de la máquina y el límite del plan, de la cuenta de Claude: un hijo sólo
# corre su sesión con un turno tomado (`flock` sobre ~/.local/state/orquestador/turno-<k>.lock, k = 1…TURNOS_MAQUINA), y el
# kernel lo suelta si el proceso muere. Lo carga orquestador.sh con `source`; usa su `PROYECTO`, `ID` y `log`.
#
# Las rutas no siguen XDG a propósito: el servicio de systemd y una terminal con otro XDG tienen que ver los mismos archivos.

MAQUINA_ENV="$HOME/.config/orquestador/maquina.env"
MAQUINA_EST="$HOME/.local/state/orquestador"
TURNOS_POR_DEFECTO=3

# TURNOS_MAQUINA de maquina.env (se lee sin `source`: un valor roto no rompe el bucle). Deja TURNOS y, si el valor no sirve,
# TURNOS_AVISO. Sin archivo o sin la línea: 3, sin aviso. Se relee en cada vuelta: editarlo vale sin reiniciar.
leer_turnos() {
  local linea v
  TURNOS=$TURNOS_POR_DEFECTO
  TURNOS_AVISO=""
  [ -f "$MAQUINA_ENV" ] || return 0
  linea=$(grep -E '^[[:space:]]*TURNOS_MAQUINA=' "$MAQUINA_ENV" 2>/dev/null | tail -n 1)
  [ -n "$linea" ] || return 0
  v=$(cut -d= -f2- <<<"$linea" | sed 's/#.*//' | tr -d "\"' \t\r")
  if [[ "$v" =~ ^[1-9][0-9]?$ ]]; then
    TURNOS=$v
  else
    TURNOS_AVISO="${MAQUINA_ENV/#"$HOME"/\~}: TURNOS_MAQUINA=«$v» no es un número de 1 a 99: uso $TURNOS_POR_DEFECTO."
  fi
}

asegurar_maquina_env() { # lo crea si falta (y lo dice)
  [ -f "$MAQUINA_ENV" ] && return 0
  mkdir -p "$(dirname "$MAQUINA_ENV")"
  cat >"$MAQUINA_ENV" <<EOF
# Lo de esta máquina, para todos los orquestadores que corren en ella (scripts/orquestador/README.md › «Uno por proyecto»).
# Sesiones de claude a la vez entre todos los proyectos (de 1 a 99): la RAM es de la máquina y el límite del plan, de la cuenta.
TURNOS_MAQUINA=$TURNOS_POR_DEFECTO
EOF
  echo "✓ creé ~/.config/orquestador/maquina.env (TURNOS_MAQUINA=$TURNOS_POR_DEFECTO)"
}

# Un turno está libre si se puede tomar ahora: se toma y se suelta en el acto (`flock -n lock true`).
turno_libre() { mkdir -p "$MAQUINA_EST" && flock -n "$MAQUINA_EST/turno-$1.lock" true 2>/dev/null; }

turnos_libres() { # cuántos de los TURNOS de la máquina están libres
  local k n=0
  leer_turnos
  for ((k = 1; k <= TURNOS; k++)); do turno_libre "$k" && n=$((n + 1)); done
  echo "$n"
}

turnos_ocupados_por() { # «calesa-app T12, kit T6» (quién tiene cada turno ocupado)
  local k quien lista=""
  leer_turnos
  for ((k = 1; k <= TURNOS; k++)); do
    turno_libre "$k" && continue
    quien=$(cat "$MAQUINA_EST/turno-$k.quien" 2>/dev/null)
    lista="$lista${lista:+, }${quien:-?}"
  done
  echo "$lista"
}

# Toma el primer turno libre en el fd 9 y lo sostiene hasta que este proceso termine. Deja TURNO=k; 1 si no hay ninguno libre.
# Nunca dentro de `$(…)`: la subshell se llevaría el fd. Lo que este proceso lance y pueda sobrevivirlo va con `9>&-`.
tomar_turno() {
  local k
  leer_turnos
  TURNO=""
  mkdir -p "$MAQUINA_EST"
  for ((k = 1; k <= TURNOS; k++)); do
    exec 9>>"$MAQUINA_EST/turno-$k.lock"
    if flock -n 9; then
      TURNO=$k
      printf '%s %s\n' "$PROYECTO" "${ID:-}" >"$MAQUINA_EST/turno-$k.quien"
      return 0
    fi
    exec 9>&-
  done
  return 1
}
