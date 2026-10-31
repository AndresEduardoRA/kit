#!/usr/bin/env bash
# Lo que comparten las piezas del piloto (se hace `source`, no se corre). Viene de importadora; aquí hay un piloto POR CARRIL y varios
# proyectos a la vez, así que cada uno tiene su carpeta común y sus sesiones de tmux. Define:
#
#   RAIZ      la raíz del árbol de trabajo (PILOTO_RAIZ, si no `git rev-parse --show-toplevel`)
#   CARRIL    el carril de este worktree: PILOTO_CARRIL, si no la línea CARRIL= de `.env.carril` (la escribe preparar.sh)
#   PROYECTO  el slug del proyecto (piloto.config)
#   COMUN     <carpeta común de git>/piloto/<carril>: lo que autoriza (compuerta.md, decision.md, aprobado-<paso>) y la copia de las
#             piezas (bin/). Fuera del árbol y uno por carril: dos pilotos nunca comparten una compuerta. Sólo la escribe bash.
#   ESTADO    RAIZ/.piloto: lo que escriben el bucle y las sesiones de ESTE carril (PILOTO_DIR para las pruebas)
#   BIN       la carpeta de esta pieza (la copia de <común>/piloto/<carril>/bin/ cuando corre el bucle)
#   TMUX_PRE  el prefijo de las sesiones de tmux de este piloto: <proyecto>-<carril>

RAIZ="${PILOTO_RAIZ:-$(git rev-parse --show-toplevel 2>/dev/null)}"
if [ -f "${RAIZ:-.}/piloto.config" ]; then
  # shellcheck source=../../piloto.config
  source "${RAIZ:-.}/piloto.config"
fi
PROYECTO="${PROYECTO:-proyecto}"
CARRIL="${PILOTO_CARRIL:-$(sed -n 's/^CARRIL=//p' "${RAIZ:-.}/.env.carril" 2>/dev/null | head -n 1)}"
COMUN="${PILOTO_COMUN:-$(git -C "${RAIZ:-.}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/piloto/${CARRIL:-sin-carril}}"
ESTADO="${PILOTO_DIR:-$RAIZ/.piloto}"
BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMUX_PRE="${PROYECTO}-${CARRIL:-sin-carril}"

ahora_lapaz() { TZ=America/La_Paz date +%Y-%m-%dT%H:%M:%S%:z; }

# El binario de Claude Code: CLAUDE_BIN, si no `claude` del PATH, si no el más nuevo de la extensión de VS Code.
claude_bin() {
  if [ -n "${CLAUDE_BIN:-}" ]; then
    printf '%s' "$CLAUDE_BIN"
  elif command -v claude >/dev/null 2>&1; then
    command -v claude
  else
    # shellcheck disable=SC2012
    ls -d "$HOME"/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | sort -V | tail -n 1
  fi
}

# El coordinador corre desde el árbol (necesita `yaml` de node_modules): está entre las guardas, así que un paso que lo cambie pide la
# compuerta «guardas» antes de que el bucle lo use. COORD_CLI se puede cambiar en las pruebas.
coordinador() { node "${COORD_CLI:-$RAIZ/scripts/coordinador/coordinador.mjs}" "$@"; }

# El contenido de un archivo si es JSON, si no `null`: para armar un JSON mayor con `jq --argjson`.
json_o_null() {
  if [ -s "$1" ] && jq -e . "$1" >/dev/null 2>&1; then jq -c . "$1"; else printf 'null'; fi
}
