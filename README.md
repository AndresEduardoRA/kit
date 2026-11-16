# {{NOMBRE}}

{{DESCRIPCION}}

Next 16 + Supabase + Tailwind 4, armado desde el kit de proyecto (`docs/KIT.md`). Antes de tocar código: `AGENTS.md` (o `CLAUDE.md`),
`docs/semilla/` y `docs/MAPA.md` (si falta: `bash scripts/mapa.sh`).

## Arrancar en local

```bash
pnpm install                      # dependencias y hooks de git (lefthook)
cp .env.example .env.local        # y completa las claves (pnpm env:check dice qué falta)
pnpm exec supabase start          # Postgres + Auth + Storage locales (Docker), en los puertos del bloque del proyecto
pnpm db:reset && pnpm db:types    # las migraciones + el seed, y los tipos generados
pnpm dev                          # http://localhost:8000 (el puerto del bloque: scripts/lib/stack-local.mjs)
```

Un carril (un worktree con su propio stack) se prepara con `bash scripts/worktree/preparar.sh`; una tanda de tareas la corre sola el
orquestador (`scripts/orquestador/README.md`, `docs/FLUJO.md`).

## Verificar

`pnpm lint` · `pnpm typecheck` · `pnpm test` (Vitest y las pruebas del kit) · `pnpm db:probar` (el esquema en Postgres embebido; `db:probar:rapido` sin los bloques lentos) ·
`pnpm test:e2e:completo` (Playwright, escritorio y móvil, contra la app compilada y Supabase local) · `bash scripts/mapa.sh --check`.
Los hooks de git y de Claude Code corren esto solos.
