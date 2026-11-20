# shellcheck shell=bash
# El orquestador se pone al día solo (scripts/orquestador/README.md › «Cómo decide»): al empezar cada vuelta, si la principal del repo
# está en main, sin cambios y detrás de origin/main, avanza con `merge --ff-only` (nunca empuja). Si eso cambió scripts/orquestador/,
# el bucle se relanza con la versión nueva (`bucle` en orquestador.sh). Lo carga orquestador.sh con `source`; usa su `ORQ`, `REPO`,
# `EST` y `log`.

motivo_para_no_tocar_la_principal() { # imprime por qué no se pone al día la principal y devuelve 0; si se puede, nada y 1
  local rama
  if ! rama=$(git -C "$REPO" symbolic-ref -q --short HEAD 2>/dev/null); then
    echo "la principal tiene el HEAD suelto: el orquestador no la pone al día"
  elif [ "$rama" != main ]; then
    echo "la principal está en «$rama», no en main: el orquestador no la pone al día"
  elif [ -n "$(git -C "$REPO" status --porcelain 2>/dev/null)" ]; then
    echo "la principal tiene cambios sin commitear: el orquestador no la pone al día"
  elif git -C "$REPO" rev-parse -q --verify origin/main >/dev/null &&
    ! git -C "$REPO" merge-base --is-ancestor HEAD origin/main; then
    echo "main local tiene commits que origin/main no tiene: el orquestador no la pone al día"
  else
    return 1
  fi
}

motivo_al_log() { # un motivo para no ponerse al día va al log una vez (vacío: ya no hay motivo)
  if [ -z "$1" ]; then rm -f "$EST/.al-dia-motivo"; return 0; fi
  [ "$(cat "$EST/.al-dia-motivo" 2>/dev/null)" = "$1" ] && return 0
  printf '%s\n' "$1" >"$EST/.al-dia-motivo"
  log "$1"
}

ponerse_al_dia() { # 3 si avanzó y cambió algo de scripts/orquestador/; 0 si no (al día, sin red o sin tocarla)
  local motivo antes salida
  if motivo=$(motivo_para_no_tocar_la_principal); then
    motivo_al_log "$motivo"
    return 0
  fi
  git -C "$REPO" fetch -q origin main 2>/dev/null || return 0 # sin red: la vuelta siguiente
  antes=$(git -C "$REPO" rev-parse HEAD)
  [ "$antes" = "$(git -C "$REPO" rev-parse origin/main)" ] && { motivo_al_log ""; return 0; }
  if motivo=$(motivo_para_no_tocar_la_principal); then
    motivo_al_log "$motivo"
    return 0
  fi
  if ! salida=$(git -C "$REPO" merge -q --ff-only origin/main 2>&1); then
    log "no pude poner al día la principal con origin/main: ${salida:0:300}"
    return 0
  fi
  motivo_al_log ""
  log "la principal se puso al día con origin/main ($(git -C "$REPO" rev-parse --short HEAD))"
  git -C "$REPO" diff --quiet "$antes" HEAD -- scripts/orquestador/ || return 3
  return 0
}

# -------------------------------------------------------------------------------------------------------- relanzarse (bucle)

# Al empezar la vuelta, antes de lanzar nada con el código viejo: si la principal avanzó y cambió scripts/orquestador/ (o ya tiene
# otra versión que la cargada), el bucle se reemplaza a sí mismo por la versión nueva (mismo PID, mismo candado). Sólo si corre desde
# la principal.
# La versión de scripts/orquestador/ en la principal: el árbol de git en HEAD. El bucle anota con cuál arrancó (ORQ_CARGADA): si la
# principal avanzó por otro lado (alguien la trajo a mano), ponerse_al_dia no ve nada que traer, pero el código cargado es el viejo.
version_del_orquestador() { git -C "$REPO" rev-parse -q --verify "HEAD:scripts/orquestador" 2>/dev/null; }

al_dia_y_relanzar() {
  local rc=0 ahora
  ponerse_al_dia || rc=$?
  if [ "$rc" != 3 ]; then
    ahora=$(version_del_orquestador)
    [ -n "${ORQ_CARGADA:-}" ] && [ -n "$ahora" ] && [ "$ahora" != "$ORQ_CARGADA" ] || return 0
  fi
  if [ "$(cd "$ORQ" && pwd -P)" != "$(cd "$REPO/scripts/orquestador" 2>/dev/null && pwd -P)" ]; then
    [ -f "$EST/.no-me-relanzo" ] || { touch "$EST/.no-me-relanzo" && log "scripts/orquestador/ cambió en main, pero corro desde $ORQ y no desde la principal: no me relanzo"; }
    return 0
  fi
  log "scripts/orquestador/ cambió en main: me relanzo con la versión nueva"
  exec env ORQ_RELANZADO=1 bash "$ORQ/orquestador.sh" bucle
}
