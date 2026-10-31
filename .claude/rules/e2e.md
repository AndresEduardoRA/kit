---
paths:
  - 'e2e/**'
  - 'scripts/**'
---

# e2e y capturas

Nadie prueba a mano: lo que no cubre una prueba automática no está verificado, y se dice.

## Fallos y base local

- Un e2e que falla no se reintenta (`retries: 0`): se busca la causa en la traza, el video y la
  captura que deja Playwright en cada corrida que falla. «La máquina estaba ocupada» no explica nada:
  se mide.
- La base local y el servidor de e2e de un stack son de una sola sesión a la vez: `db:reset`,
  `db:types`, `db:diff`, `db:medir*`, `db:carreras`, `db:sembrar-volumen`, `test:e2e` y
  `test:e2e:completo` toman `scripts/candado.sh` (no `db:probar`, que es PGlite). Hay un candado por
  stack: la principal y cada carril, que el candado reconoce por su `.env.carril`
  (`scripts/worktree/preparar.sh`). Ocupado falla con 75 (`CANDADO_ESPERA=<s>` espera);
  `bloquear-peligrosos.sh` rechaza `supabase` y el runner sueltos.
- `pnpm test:e2e <spec>` corre un spec sobre la base como esté; `--project=escritorio` o
  `--project=movil` elige el proyecto. `pnpm test:e2e:completo` resetea la base, corre las carreras
  (si hay) y todo; pasa sus argumentos a Playwright.

## Niveles de verificación

- **Nivel 1**, toda tarea: `pnpm lint`, `pnpm typecheck`, `pnpm test` y los e2e dirigidos a lo
  tocado, en `escritorio` y, si es interfaz (abajo), también en `movil`.
- **Nivel 2**, si la tarea toca uno de seis disparadores: (1) lo compartido, `src/shared`; (2) el
  proxy o middleware; (3) auth; (4) RLS: una migración que crea, cambia o borra una policy, un grant
  o un `security definer`, o enciende RLS; (5) un layout o el `_shell`; (6) la estructura: una
  migración que crea, cambia o borra una tabla o un índice. Además de lo dirigido corre
  `pnpm test:e2e:completo --project=escritorio`, después del último cambio de código. Lo decide
  `node scripts/piloto/nivel.mjs <archivos>`, no el ojo.
- **Nivel 3**, cuando el paso lo pide en su `verificacion` de `plan.yaml` (un cierre de carril o de
  entrega): `pnpm test:e2e:completo` con los dos proyectos. En CI, un PR corre el Nivel 1 y los
  dirigidos (`scripts/e2e-dirigidos.mjs`); cada noche, el completo.
- Rigor máximo (mutaciones, carreras, volumen, el auditor que bloquea) sólo en fórmulas y dinero
  (`docs/semilla/semilla.md` › Reglas y fórmulas), RLS y permisos; lo demás, con su nivel y sin
  pruebas de más.
- `docs/pasos/<PASO>/bitacora.md` dice cuál se corrió: `e2e completo: sí|no (<motivo>)`. Un nivel
  no corrido se dice; no se da por pasado.
- **Interfaz** (la aplica `nivel.mjs` como `toca_interfaz`; si cambias una, cambia la otra): un archivo
  es interfaz si no es una prueba (`*.test.*`, `*.spec.*`) y es un `.tsx` o `.css` de `src/`, o algo
  de `design/`, `public/`, `src/app/` o `src/shared/ui/`. No lo es `entities/`, `infra/`,
  `src/shared/lib`, `supabase/`, `scripts/`, `e2e/` ni docs. Sin interfaz, sólo `escritorio`.

## Escribir specs

- Cada spec prepara todo el estado que usa, no depende de otro (CI corre en shards, cada uno desde
  `db:reset`), limpia lo que crea y nombra sus pruebas con prefijo `E2E`.
- Antes de medir una caja o ver quién recibe un clic se espera el estado final, nunca un tiempo
  (`waitForTimeout` no). Tras un Esc que cierra un diálogo: `expect(dialogo).toBeHidden()`; entre un
  `fill` y el Esc, dos cuadros (`requestAnimationFrame` dos veces).
- Una prueba que baja de nivel (Vitest o `db:probar`) se prueba con una mutación: se rompe la
  conducta en el producto, cae la de abajo, se revierte y recién entonces se borra el e2e. Lo que
  exige dos conexiones a la vez va a las carreras (`pnpm db:carreras`).
- Cero pruebas saltadas nuevas (`.skip`, `.fixme`, `test.only`) sin motivo escrito al lado.

## Celular

- Todo spec corre en `escritorio` y `movil`. Salir del celular exige marcarlo con motivo de
  ≥ 40 caracteres: `// @sin-celular-archivo: <motivo>` para el archivo, o `// @sin-celular: <motivo>`
  justo encima de un `test('título', …)` de nivel superior (lo lee `playwright.config.ts`). No vale
  una prueba que pregunta por el ancho o el proyecto (`isMobile`, `project.name ===`,
  `setViewportSize`). Una prueba que alimenta a otra de un archivo `serial` no se marca.

## Capturas

- Una captura para mirar se toma con el ayudante de `e2e/soporte/`, nunca con `page.screenshot`
  suelto, y sólo con `E2E_CAPTURAS=<carpeta>`.
- «Mirar las capturas» es abrir todas con `Read`; el informe lista las abiertas y lo visto en cada una.
- Un defecto ajeno al paso no se arregla de paso: va como pendiente en `docs/pasos/<PASO>/bitacora.md`.
