#!/usr/bin/env bash
# La verificación entera de una sesión (docs/FLUJO.md › «Qué se verifica y dónde»): `pnpm lint`, `pnpm typecheck`, `pnpm test` y
# `bash scripts/mapa.sh --check`, los cuatro en paralelo, con la salida de cada uno en `$TMPDIR` y una línea de resumen por comando (y
# las últimas líneas del que cayó). Si pasan todos, recuerda el árbol verificado (lo commiteado más lo que haya sin commitear; lo
# ignorado no cuenta) en `verificado-<rama>` dentro del `.git` del worktree: con el mismo árbol dice «ya verificado» y sale en 0 sin
# correr nada; si cambió un archivo, corre otra vez. Un comando que cae no guarda el árbol (y borra el guardado).
#
#   bash scripts/flujo/verificar.sh            una vez, al final, en segundo plano
#   bash scripts/flujo/verificar.sh --forzar   lo corre igual aunque el árbol sea el verificado
#
# El CI sigue siendo la autoridad: corre todo, sin mirar este recuerdo. Sale con 0 si todo pasó (o ya estaba verificado) y con 1 si
# cayó algo. Se ubica por la carpeta del propio guion.
set -uo pipefail

FORZAR=0
case "${1:-}" in
  '') ;;
  --forzar) FORZAR=1 ;;
  *) echo "uso: bash scripts/flujo/verificar.sh [--forzar]" >&2; exit 2 ;;
esac

cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)" || exit 2

# El árbol de lo que hay ahora: un índice temporal con HEAD más todo lo no ignorado, sin tocar el índice de verdad.
arbol() {
  local tmp idx tree
  tmp=$(mktemp -d) || return 1
  idx="$tmp/index"
  tree=$(GIT_INDEX_FILE="$idx" git read-tree HEAD 2>/dev/null && GIT_INDEX_FILE="$idx" git add -A >/dev/null 2>&1 && GIT_INDEX_FILE="$idx" git write-tree 2>/dev/null)
  rm -rf "$tmp"
  [ -n "$tree" ] || return 1
  echo "$tree"
}

RAMA=$(git symbolic-ref --quiet --short HEAD || echo 'HEAD-suelto')
MEMORIA=$(git rev-parse --git-path "verificado-${RAMA//\//-}")
ARBOL=$(arbol) || ARBOL=""

if [ "$FORZAR" = 0 ] && [ -n "$ARBOL" ] && [ -f "$MEMORIA" ] && [ "$(cat "$MEMORIA")" = "$ARBOL" ]; then
  echo "✓ ya verificado (árbol ${ARBOL:0:10}): nada cambió desde la última vez que pasó todo; --forzar lo corre igual"
  exit 0
fi

SALIDA=$(mktemp -d "${TMPDIR:-/tmp}/verificar-XXXXXX") || exit 2
NOMBRES=(lint typecheck test mapa)
ORDEN=("pnpm lint" "pnpm typecheck" "pnpm test" "bash scripts/mapa.sh --check")

for i in "${!NOMBRES[@]}"; do
  (
    inicio=$SECONDS
    # shellcheck disable=SC2086 # cada comando es palabras sueltas a propósito
    ${ORDEN[$i]} >"$SALIDA/${NOMBRES[$i]}.log" 2>&1
    echo "$? $((SECONDS - inicio))" >"$SALIDA/${NOMBRES[$i]}.fin"
  ) &
done
wait

CAIDOS=0
for i in "${!NOMBRES[@]}"; do
  n=${NOMBRES[$i]}
  read -r codigo segundos <"$SALIDA/$n.fin" 2>/dev/null || { codigo=1; segundos=0; }
  if [ "$codigo" = 0 ]; then
    echo "✓ ${ORDEN[$i]} (${segundos} s)"
  else
    CAIDOS=$((CAIDOS + 1))
    echo "✗ ${ORDEN[$i]}: salió con $codigo (${segundos} s); salida completa en $SALIDA/$n.log"
    tail -n 15 "$SALIDA/$n.log" | sed 's/^/    /'
  fi
done

if [ "$CAIDOS" != 0 ]; then
  rm -f "$MEMORIA"
  echo "✗ cayeron $CAIDOS de ${#NOMBRES[@]}: arréglalos y vuelve a correr el guion (no se guardó el árbol)"
  exit 1
fi

[ -n "$ARBOL" ] && echo "$ARBOL" >"$MEMORIA"
echo "✓ todo verificado (árbol ${ARBOL:0:10})"
