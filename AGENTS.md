# {{NOMBRE}}

{{DESCRIPCION}}

Las reglas compartidas de este repo, para cualquier agente (Codex las lee de aquí; Claude Code, desde `CLAUDE.md`, que importa este
archivo). Sólo español, de tú, salvo que la semilla diga otro idioma o registro.

## Al empezar

1. Lee tu paso: `docs/semilla/plan.yaml` (ruteo, dependencias y criterio de terminado) y lo que ya dejaron los pasos de los que
   dependes en `docs/pasos/<PASO>/`. El producto, los permisos, los datos y el diseño están en `docs/semilla/semilla.md`.
2. `docs/MAPA.md` (generado: módulos, API, rutas, tablas). **El mapa antes que grep.** Si falta: `bash scripts/mapa.sh`.
3. La ficha `CLAUDE.md` de un módulo y `.claude/rules/*` rigen al tocar sus archivos. Con grep, bajo demanda: `docs/GLOSARIO.md`,
   `docs/UX.md`, `docs/RENDIMIENTO.md` (si existen) y `docs/KIT.md` (de dónde sale este repo y cómo corren los carriles).
4. **No hay `ESTADO`, `PLAN`, `DECISIONES` ni `BITACORA` compartidos, y nadie los crea**: cada paso escribe sólo en `docs/pasos/<PASO>/`
   (`decisiones.md`, `bitacora.md`); el tablero lo genera el coordinador.

## Comandos

`pnpm dev` · `test` · `lint` · `typecheck` · `test:e2e <spec>` · `test:e2e:completo` · `db:reset` · `db:types` · `db:probar` · `db:lint` ·
`env:check` · `mapa`. La base y el e2e van con candado (`scripts/candado.sh`); en un carril, siempre por `pnpm`, nunca `supabase` suelto.

## Arquitectura: monolito modular

- `src/modules/<dominio>/`: `entities/` (tipos, reglas puras, permisos; cero I/O), `features/<caso>/` (`components`, `hooks`, `actions`,
  `schemas`), `infra/` (Supabase, adaptadores). `features` no importa `infra`. Los módulos y sus dependencias salen de la semilla.
- Entradas: `index.ts` (servidor; sin componentes), `client.ts` (Client Components), `shell.ts` (sólo el layout `(app)`),
  `pantallas/<pantalla>.ts` (sólo `src/app`). Entre módulos sólo entradas; adentro, rutas relativas. `src/shared` sólo importa `shared`.
  Lo vigilan `eslint-plugin-boundaries` y `mapa.sh --check` (`src/modules/README.md`).
- `supabase/migrations/`: la base del kit (**no se edita nunca**) y una migración nueva por cambio (`supabase migration new`), con su RLS,
  grants, RPC y datos de catálogo (`.claude/rules/migraciones.md`).

## Reglas

- Código que se pide al usarse: `diferido()`, nunca `next/dynamic`. Un número que se muestra nunca es un total exacto. Toda lista para miles
  de filas, por cursor, probada con volumen (`.claude/rules/escala.md`).
- Un archivo, una responsabilidad (> 300 líneas: se parte). Toda función exportada de `entities/` lleva test.
- Zod en todo límite (formulario, action, params, RPC, respuesta externa); ids con `z.guid()`. Errores como valores (`{ ok: false, error }`).
- Ningún componente ni hook consulta Supabase: lecturas en `infra/`, mutaciones por Server Actions (`next-safe-action`), realtime en `*.client.ts`.
- Lo que otorga permisos o cambia de dueño se escribe por RPC, nunca con `.update()` (`.claude/rules/datos.md`).
- Cambio de base = una migración nueva, con `db:reset`, `db:types` y `db:probar` en el mismo commit.
- Unidad nueva = su `CLAUDE.md`. Término nuevo = su entrada en `docs/GLOSARIO.md`, y ese nombre en tipos, tablas y UI; nunca un sinónimo.
- Variables de entorno: sólo las de `src/shared/config/esquemas.ts` (y `.env.example`); el correo, sólo por `enviarEmail()`.
- Un módulo de otro carril no se toca: es una compuerta `afuera`. Nadie prueba a mano: toda verificación es un test.

## Stack: lo que muerde

- **Next 16:** `src/proxy.ts` (no `middleware.ts`); `params`, `searchParams`, `cookies()` y `headers()` son async; `revalidateTag('x', 'max')`.
  `cacheComponents`: nada de `export const dynamic`, `useSearchParams()` dentro de `<Suspense>`, y leer sesión o base va tras `<Suspense>`.
  Lee la guía de `node_modules/next/dist/docs/` antes de usar una API que no conoces: cambió.
- **Supabase:** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; en servidor `getClaims()`, nunca `getSession()`; cliente por request; cookies
  `getAll`/`setAll`. Puertos del bloque del proyecto (`supabase/config.toml`, `scripts/lib/stack-local.mjs`); un carril suma +100 por
  carril (`.env.carril`). `storage.objects`: sólo policies. Conflictos: `PT409` con mensaje humano, nunca `40001`.
- **Tailwind 4** sin config (loader en `next.config.ts`); tokens en `design/tokens.css`; propios con `bg-(--color-surface)`; shadcn en `src/shared/ui`.
- **Zod 4** (`z.email()`, `{ error }`, `z.record(k, v)`), **TypeScript 6**, `noUncheckedIndexedAccess`. Vitest no testea Server
  Components async (Playwright). Fechas cruzan como ISO y se muestran con `fechas.ts`; números con `formato.ts`.

## Commits

Conventional Commits: tipo en inglés, descripción en español, infinitivo y minúscula (`feat(shared): aceptar fechas sin hora`).
Scopes: {{SCOPES}}. Un commit = un cambio: si el mensaje necesita «y», son dos.

## Terminado significa

`lint` y `typecheck` sin warnings · `test` (lo nuevo con test) y `db:probar` si tocaste `supabase/` · los e2e del nivel que toca
(`.claude/rules/e2e.md`) · los estados de `docs/UX.md` y `.claude/rules/ui.md` · capas respetadas · `mapa.sh --check` · lo no obvio en
`docs/pasos/<PASO>/decisiones.md` y lo corrido en su `bitacora.md` · commit convencional.

## Nunca

`--no-verify` · versiones nuevas sin verificarlas hoy · la secret key fuera del servidor o en `NEXT_PUBLIC_*` · desactivar una regla de lint ·
una tabla sin RLS, un `security definer` sin `set search_path = ''`, `auth.uid()` suelto (va `(select auth.uid())`) · `if (rol === …)` en
la UI (va `puede(permisos, clave, alcance)`) · un número sin `formato.ts` o una fecha sin `fechas.ts` · editar una migración que ya entró
a `main` · tocar lo de otro paso o de otro carril · crear `ESTADO.md`, `PLAN.md` o cualquier doc compartido fuera de `docs/pasos/<PASO>/`.
