# shellcheck shell=bash
# El orquestador se pone al día solo (scripts/orquestador/README.md › «Cómo decide»): al empezar cada vuelta, si la principal del repo
# está en main, sin cambios y detrás de origin/main, avanza con `merge --ff-only` (nunca empuja). Si eso cambió scripts/orquestador/,
# el bucle se relanza con la versión nueva (`bucle` en orquestador.sh). Lo carga orquestador.sh con `source`; usa su `REPO`, `EST` y
# `log`.

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
