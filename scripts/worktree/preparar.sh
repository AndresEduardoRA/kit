#!/usr/bin/env bash
# Deja el worktree de un carril listo para trabajar, con su propio stack de Supabase, sin pisar a la principal, a otro carril ni a otro
# proyecto. Idempotente. Se corre en el worktree del carril, nunca en la principal. Viene de importadora (scripts/worktree/preparar.sh);
# aquí los carriles salen de plan.yaml y los puertos del bloque del proyecto (piloto.config).
#
#   bash scripts/worktree/preparar.sh [<carril>]     (sin carril: lo saca de la rama, `<carril>/…`)
#
# 1) `pnpm install` si falta. 2) `.env.carril`: project_id `<proyecto>-<carril>` y sus puertos (scripts/lib/stack-local.mjs).
# 3) `supabase start` del carril, sin Studio, imgproxy ni logs. 4) `.env.local`: lo de Supabase sale de `supabase status`; lo demás, de la
# `.env.local` de la principal. Nada se imprime. 5) La base: datos de demo si hay `scripts/demo/restaurar.sh` y credenciales; si no,
# `pnpm db:reset`. 6) El mapa. Quitarlo: scripts/worktree/quitar.sh.
set -euo pipefail
RAIZ=$(git rev-parse --show-toplevel)
cd "$RAIZ"
falta() { echo "✗ $1" >&2; exit 64; }

if [ "$(git rev-parse --path-format=absolute --git-dir)" = "$(git rev-parse --path-format=absolute --git-common-dir)" ]; then
  falta "esto es la principal: preparar.sh va en el worktree de un carril (scripts/coordinador/abrir-carriles.sh los crea)."
fi
[ -f piloto.config ] || falta "falta piloto.config en la raíz."
# shellcheck source=../../piloto.config
source piloto.config
PRINCIPAL=$(git worktree list --porcelain | sed -n '1s/^worktree //p')

CARRIL="${1:-}"
[ -n "$CARRIL" ] || CARRIL=$(git symbolic-ref --quiet --short HEAD | sed -n 's#^\([a-z][a-z0-9-]*\)/.*#\1#p')
[ -n "$CARRIL" ] || falta "no sé el carril: pásalo o usa una rama <carril>/…"

# 1) Dependencias, antes que nada: lo de abajo corre node con paquetes del repo (pnpm las enlaza desde el store: no se bajan de nuevo).
[ -d node_modules ] || pnpm install --frozen-lockfile --prefer-offline >/dev/null
echo "✓ dependencias"

# 2) .env.carril (falla con la lista de carriles si éste no está en plan.yaml).
node --input-type=module -e "
import { writeFileSync } from 'node:fs'
import { variablesDelCarril, desfasesDelRepo } from './scripts/lib/stack-local.mjs'
const [proyecto, carril, bloque] = process.argv.slice(1)
const v = variablesDelCarril(proyecto, carril, desfasesDelRepo(), bloque)
const lineas = Object.entries(v).map(([k, x]) => k + '=' + String(x))
writeFileSync('.env.carril', '# Carril ' + carril + ': lo escribe scripts/worktree/preparar.sh. No se edita a mano.\nCARRIL=' + carril + '\n' + lineas.join('\n') + '\n')
" "$PROYECTO" "$CARRIL" "$PILOTO_BLOQUE" || falta "no pude escribir .env.carril (arriba, por qué)."
# shellcheck source=../lib/carril.sh
source scripts/lib/carril.sh
echo "✓ carril $CARRIL: stack $SUPABASE_PROJECT_ID, API $SUPABASE_API_PORT, base $SUPABASE_DB_PORT, app $PUERTO_APP, e2e $E2E_PORT"

# 3) El stack del carril.
sb() { pnpm exec supabase "$@" 2> >(grep -v -i -E 'new version|recommend updating|^We recommend' >&2); }
if sb status >/dev/null 2>&1; then
  echo "✓ stack $SUPABASE_PROJECT_ID ya estaba arriba"
else
  sb start -x studio,imgproxy,logflare,vector >/dev/null
  echo "✓ stack $SUPABASE_PROJECT_ID arriba"
fi

# 4) .env.local: lo de Supabase de este stack y lo demás de la principal, sin imprimir valores.
estado=$(sb status -o env)
leer() { printf '%s\n' "$estado" | sed -nE "s/^$1=\"?([^\"]*)\"?$/\1/p"; }
PROPIAS='^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY|MAILPIT_URL)='
{
  echo "# Carril $CARRIL: lo escribe scripts/worktree/preparar.sh (lo de Supabase, de su stack; lo demás, de la principal)."
  echo "NEXT_PUBLIC_SUPABASE_URL=$(leer API_URL)"
  echo "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$(leer PUBLISHABLE_KEY)"
  echo "SUPABASE_SECRET_KEY=$(leer SECRET_KEY)"
  echo "MAILPIT_URL=$E2E_MAILPIT_URL"
  if [ -f "$PRINCIPAL/.env.local" ]; then grep -vE "$PROPIAS" "$PRINCIPAL/.env.local" | grep -vE '^# Carril ' || true; fi
} >.env.local.nuevo
chmod 600 .env.local.nuevo
mv .env.local.nuevo .env.local
if grep -q '"env:check"' package.json; then
  pnpm --silent env:check local >/dev/null || { pnpm --silent env:check local >&2; falta ".env.local incompleta (arriba, lo que falta)."; }
fi
echo "✓ .env.local"

# 5) La base.
if [ -f scripts/demo/restaurar.sh ] && { [ -f .env.demo ] || [ -n "${DEMO_DUENO_EMAIL:-}" ]; }; then
  bash scripts/demo/restaurar.sh --local
else
  pnpm db:reset >/dev/null 2>&1 || pnpm db:reset >/dev/null
  echo "✓ base reseteada"
fi

# 6) El mapa de este árbol.
[ -f scripts/mapa.sh ] && bash scripts/mapa.sh >/dev/null && echo "✓ mapa"
echo
echo "Listo. App: pnpm dev (http://localhost:$PUERTO_APP) · e2e: pnpm test:e2e <spec> (puerto $E2E_PORT)"
