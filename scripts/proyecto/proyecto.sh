#!/usr/bin/env bash
# El estado de un proyecto entero y su resumen diario al celular (docs/KIT.md › «El estado de un proyecto»). Sólo prepara node; todo lo
# demás está en proyecto.mjs. Se corre desde `proyectos/`, o desde donde sea (se ubica por su propia carpeta):
#
#   bash _herramientas/kit/scripts/proyecto/proyecto.sh estado <z_carpeta>|--todos
#   bash _herramientas/kit/scripts/proyecto/proyecto.sh sincronizar <z_carpeta>|--todos
#   bash _herramientas/kit/scripts/proyecto/proyecto.sh reconstruir <z_carpeta> [--forzar]
#   bash _herramientas/kit/scripts/proyecto/proyecto.sh resumen --todos
#   bash _herramientas/kit/scripts/proyecto/proyecto.sh instalar-resumen
set -uo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# La principal del kit, aunque esto se corra desde un worktree: el padre del directorio común de git.
KIT="$(dirname "$(git -C "$AQUI" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "$AQUI/../../.git")")"

# El servicio de systemd arranca sin nvm en el PATH: se carga igual que lo hace el orquestador.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  [ -f "$KIT/.nvmrc" ] && nvm use --silent "$(cat "$KIT/.nvmrc")" >/dev/null 2>&1
fi
command -v node >/dev/null 2>&1 || { echo "falta node en el PATH" >&2; exit 1; }

exec node "$AQUI/proyecto.mjs" "$@"
