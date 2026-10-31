#!/usr/bin/env bash
# Arranca (o re-arranca) el piloto de ESTE carril. Lo corre la persona, en el worktree del carril:  bash scripts/piloto/arrancar.sh
# Viene de importadora. En el kit hay un piloto por carril (sus sesiones de tmux llevan el proyecto y el carril) y, una por proyecto,
# la sesión del coordinador que integra y lleva el tablero (scripts/coordinador/sincronizar.sh).
#
# 1. Copia las piezas de `scripts/piloto/` (`*.sh`, `*.mjs`, `*.json`; ninguna prueba) a `<común de git>/piloto/<carril>/bin/`, anota un
#    sha256 por archivo en `bin.sha256` y la deja de sólo lectura: un paso no puede cambiar el código con que se lo verifica y publica.
# 2. Lanza `bin/bucle.sh` en tmux (`<proyecto>-<carril>-bucle`) y una sesión ociosa de control con Remote Control
#    (`<proyecto>-<carril>-control`: desde el celular «¿cómo va?», «para», «para ya»; sin turnos no gasta).
# 3. Si no corre, lanza el coordinador del proyecto (`<proyecto>-coordinador`).
#
#   bash scripts/piloto/arrancar.sh            todo lo de arriba
#   bash scripts/piloto/arrancar.sh --todos    en la principal: arranca el piloto de cada worktree de carril (<repo>.carriles/*)
set -uo pipefail
# shellcheck source=comun.sh
source "$(dirname "${BASH_SOURCE[0]}")/comun.sh"
cd "$RAIZ" || exit 1
falta() { echo "arrancar: $1" >&2; exit 1; }

if [ "${1:-}" = --todos ]; then
  DESTINO="$(dirname "$RAIZ")/$(basename "$RAIZ").carriles"
  [ -d "$DESTINO" ] || falta "no hay carriles en $DESTINO: bash scripts/coordinador/abrir-carriles.sh"
  for dir in "$DESTINO"/*/; do (cd "$dir" && bash scripts/piloto/arrancar.sh) || echo "arrancar: falló en $dir" >&2; done
  exit 0
fi

for programa in git jq flock tmux node; do command -v "$programa" >/dev/null || falta "falta $programa en el PATH."; done
[ -n "$CARRIL" ] || falta "esto no es el worktree de un carril (falta CARRIL= en .env.carril: scripts/worktree/preparar.sh)."
CLAUDE=$(claude_bin)
[ -n "$CLAUDE" ] || falta "no encuentro el binario de claude (CLAUDE_BIN, o la extensión de VS Code)."
gh auth status >/dev/null 2>&1 || falta "gh no está autenticado (gh auth login): sin él no se publica ni se integra."
coordinador validar >/dev/null || { coordinador validar; falta "el plan no es válido."; }

# 1. La copia.
NUEVA="$COMUN/bin.nueva"
mkdir -p "$COMUN"
rm -rf "$NUEVA"
mkdir -p "$NUEVA"
find scripts/piloto -maxdepth 1 -type f \( -name '*.sh' -o -name '*.mjs' -o -name '*.json' \) ! -name '*.test.*' -exec cp {} "$NUEVA"/ \;
(cd "$NUEVA" && sha256sum -- * >bin.sha256 2>/dev/null; grep -v ' bin.sha256$' bin.sha256 >bin.tmp && mv bin.tmp bin.sha256)
chmod a-w "$NUEVA"/*
chmod -R u+w "$COMUN/bin" 2>/dev/null
rm -rf "${COMUN:?}/bin"
mv "$NUEVA" "$COMUN/bin"
echo "arrancar: copia en $COMUN/bin ($(wc -l <"$COMUN/bin/bin.sha256") archivos, sha256 anotado)."

# 2. El bucle y el control de este carril.
mkdir -p "$ESTADO"
tmux has-session -t "$TMUX_PRE-bucle" 2>/dev/null && falta "ya corre «$TMUX_PRE-bucle»: tmux attach -t $TMUX_PRE-bucle (o bash scripts/piloto/parar.sh)."
tmux new-session -d -s "$TMUX_PRE-bucle" -c "$RAIZ" "bash '$COMUN/bin/bucle.sh' $* 2>&1 | tee -a '$ESTADO/bucle.log'; echo; echo 'El bucle terminó (¿PARAR, terminado, una compuerta o un error?). Enter para cerrar.'; read -r"
if ! tmux has-session -t "$TMUX_PRE-control" 2>/dev/null; then
  tmux new-session -d -s "$TMUX_PRE-control" -c "$RAIZ" \
    "env PILOTO_SESION=control ENABLE_CLAUDEAI_MCP_SERVERS=false '$CLAUDE' --remote-control 'piloto · $PROYECTO $CARRIL · control' --model sonnet --effort low --tools 'Read,Bash' --disallowedTools 'mcp__*' --no-chrome --allowedTools 'Read' 'Bash(touch .piloto/PARAR)' 'Bash(bash scripts/piloto/parar.sh*)' 'Bash(cat .piloto/*)' 'Bash(tail *)' 'Bash(node scripts/coordinador/coordinador.mjs tablero)' '/piloto-control'"
fi
echo "arrancar: bucle en «tmux attach -t $TMUX_PRE-bucle»; control en «$TMUX_PRE-control» (Remote Control)."

# 3. El coordinador del proyecto (uno solo, aunque haya varios carriles).
if ! tmux has-session -t "$PROYECTO-coordinador" 2>/dev/null; then
  tmux new-session -d -s "$PROYECTO-coordinador" -c "$RAIZ" "bash scripts/coordinador/sincronizar.sh 2>&1 | tee -a '$ESTADO/coordinador.log'"
  echo "arrancar: coordinador en «tmux attach -t $PROYECTO-coordinador»."
fi
