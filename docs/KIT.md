# El kit de proyecto

La plantilla de la que `semilla-a-repo` crea cada proyecto nuevo. Sale de importadora: lo que allá ya está probado se reutiliza. Lo que
allá avanza de a un paso se rediseña para que **varios carriles trabajen a la vez**.

## Qué cambia respecto de importadora

|                      | Importadora                                                | El kit                                                                                                                                |
| -------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Carriles             | Dos escritos a mano (A con piloto, B a mano con Sonnet)    | Los de `plan.yaml`, todos con piloto, hasta `CARRILES_MAX`                                                                            |
| Qué hace cada carril | El ruteo (Sonnet) lee `PLAN.md` y elige                    | El coordinador entrega el paso cuyas dependencias ya están en `main`; el ruteo ya viene escrito en `plan.yaml` (sin llamada a Sonnet) |
| PR                   | Uno largo por carril; lo integras tú                       | Uno por paso (rama `<carril>/<paso>`): lo que depende de él se desbloquea apenas entra                                                |
| Integrar             | Siempre tú                                                 | El coordinador integra los verdes y ámbar con el CI en verde; **los rojos tú** (salvo `rojo` en `COORD_MERGE_AUTO`)                   |
| Docs compartidos     | Sólo el carril A edita ESTADO, PLAN, DECISIONES y BITACORA | Nadie los edita: cada paso escribe `docs/pasos/<PASO>/`; el tablero lo genera el coordinador                                          |
| Puertos              | 546xx; carriles +100 y +200                                | Un **bloque** por proyecto (`PILOTO_BLOQUE`) y +100 por carril: varios proyectos a la vez sin chocar                                  |
| Cuota                | Tope de USD por paso                                       | Además, la ventana de 5 h compartida entre **todos** los proyectos, con un tope por proyecto                                          |

## Lo que ya está (tanda 1)

| Archivo                                                                               | Qué hace                                                                                                                                                    | Probado                                                                                                    |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `scripts/coordinador/plan.mjs`                                                        | Lee y valida `plan.yaml`; decide el siguiente paso de un carril (camino crítico primero, cuota); transiciones; tablero                                      | 15 pruebas                                                                                                 |
| `scripts/coordinador/coordinador.mjs`                                                 | La CLI: `validar`, `siguiente`, `publicado`, `liberar`, `integrado`, `sincronizar`, `cuota`, `tablero`. Estado en `<común de git>/coordinador/` con candado | 6 pruebas con un repo real y un `gh` falso, incluidos pedidos simultáneos                                  |
| `scripts/lib/stack-local.mjs`                                                         | Puertos por bloque y por carril                                                                                                                             | 3 pruebas: dos proyectos con 9 carriles cada uno sin un puerto repetido, y ninguno toca los de importadora |
| `scripts/guardas/carriles.mjs`                                                        | En CI: un PR sólo toca lo de su paso; orden de migraciones                                                                                                  | 6 pruebas                                                                                                  |
| `scripts/worktree/preparar.sh`, `quitar.sh`, `con-carril.sh`, `scripts/lib/carril.sh` | El stack de un carril                                                                                                                                       | `bash -n` y shellcheck; **sin correr** (necesitan Docker y Supabase)                                       |
| `scripts/coordinador/abrir-carriles.sh`                                               | Un worktree por carril, preparado, y el proyecto anotado para la cuota                                                                                      | Igual: **sin correr**                                                                                      |
| `piloto.config`                                                                       | La configuración del proyecto                                                                                                                               | —                                                                                                          |

`pnpm test:kit` corre estas pruebas junto con las del piloto (abajo).

## Cómo fluye un paso

1. El piloto del carril pide `coordinador.mjs siguiente <carril>`. Recibe `paso` con su ruteo, `esperar` con el motivo o `terminado`.
2. Crea la rama `<carril>/<paso>` desde `origin/main` y corre el paso con el modelo, effort y modo de `plan.yaml`.
3. El bucle verifica y publica, igual que en importadora. El PR va contra `main` y después corre `coordinador.mjs publicado <paso> <pr>`.
4. `coordinador.mjs sincronizar`, cada pocos minutos, hace tres cosas:
   - Si el PR ya se integró, lo marca integrado.
   - Si el paso es verde o ámbar y el CI está en verde, lo integra (squash) y borra la rama.
   - Si el CI está en rojo o hay conflicto con `main`, se lo devuelve a su carril, y eso va antes que un paso nuevo.
5. Un paso rojo con el CI en verde queda esperando que lo integres tú en GitHub. Lo que depende de él espera. Si sumas `rojo` a
   `COORD_MERGE_AUTO` (`piloto.config`), el coordinador también los integra solo.
6. Las compuertas esperan a la persona salvo la ámbar y los tipos de `PILOTO_AUTO` (`producto`, `datos`, `guardas`), que se contestan
   solos con la recomendada y quedan en `docs/pasos/<PASO>/decisiones.md`. Con `rojo` en `COORD_MERGE_AUTO` y `datos` en `PILOTO_AUTO`,
   un paso rojo corre de punta a punta sin nadie: es lo que hace importadora.

## Calibrar la cuota

La app muestra un %, pero `claude -p` solo da `total_cost_usd`, que es una estimación del cliente. Por eso la cuota se mide en USD
equivalentes y se calibra una vez por cuenta:

1. Al empezar una ventana de 5 h, anota el % que muestra Claude.
2. Corre uno o dos pasos y vuelve a anotar el %. Suma el `total_cost_usd` de esas filas en `.piloto/consumo.csv`.
3. `COORD_USD_VENTANA = USD sumados ÷ (puntos de % que subió) × 100`.
4. Escríbelo en `~/.config/kit/cuenta.config`:

```bash
mkdir -p ~/.config/kit
echo 'COORD_USD_VENTANA=<número>' > ~/.config/kit/cuenta.config
```

Mientras no esté calibrado, el coordinador no frena por cuota. Solo queda el aviso de límite de `claude -p`, con el que el piloto duerme
hasta que la ventana se reinicia, igual que en importadora.

## Tanda 2: el piloto por carril (hecho)

| Archivo                                                                                                                                                       | Qué hace                                                                                                                                                                                      | Probado                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `scripts/piloto/bucle.sh`                                                                                                                                     | Pide al coordinador, crea la rama `<carril>/<paso>` desde `origin/main`, corre el paso con el modelo y el effort de `plan.yaml` (Claude o Codex), verifica, publica y avisa                   | 7 pruebas de punta a punta (`piloto.test.mjs`) con un origin real y `claude`, `codex` y `gh` falsos |
| `scripts/piloto/compuerta.sh`                                                                                                                                 | Compuertas al celular. **Ámbar:** una de `producto` en un paso no rojo se elige sola a los `PILOTO_AUTO_MIN` min y queda anotada; las rojas esperan siempre                                   | Ámbar elegida sola, roja que no se elige sola, una compuerta por carril                             |
| `scripts/piloto/publicar.sh`                                                                                                                                  | Un PR por paso (`<PASO> · <título>`, con el riesgo y quién integra) y `coordinador.mjs publicado`                                                                                             | En la prueba de punta a punta                                                                       |
| `scripts/piloto/cierre.sh`, `verificar.sh`                                                                                                                    | Como en importadora: verifica lo mínimo (typecheck y mapa; nada con la huella verde) y el CI del PR es la autoridad; mide el diff contra `main` (un merge de arreglo no cuenta como del paso) | —                                                                                                   |
| `scripts/piloto/comun.sh`                                                                                                                                     | Una carpeta común y sesiones de tmux **por carril** (`<proyecto>-<carril>-…`): dos pilotos nunca comparten una compuerta                                                                      | En la prueba de la compuerta roja                                                                   |
| `scripts/piloto/nivel.mjs`                                                                                                                                    | Los seis disparadores del Nivel 2, genéricos                                                                                                                                                  | 3 pruebas                                                                                           |
| `scripts/piloto/arrancar.sh`, `parar.sh`                                                                                                                      | Por carril, o `--todos` desde la principal; arranca el coordinador del proyecto                                                                                                               | `bash -n` y shellcheck; **sin correr** (tmux, Remote Control)                                       |
| `scripts/coordinador/sincronizar.sh`                                                                                                                          | El coordinador en marcha: integra, devuelve y escribe el tablero cada 3 min                                                                                                                   | **Sin correr** (necesita GitHub)                                                                    |
| `.claude/hooks/*`, `.claude/settings.json`, `scripts/candado.sh`, `mapa.sh`, `ci-cambios.sh`, `e2e-dirigidos.mjs`, `lefthook.yml`, `.github/workflows/ci.yml` | Las guardas de importadora, sin lo propio de importadora                                                                                                                                      | Las 541 pruebas de las guardas de importadora pasan contra las copias del kit (`pnpm test:guardas`) |
| `.claude/skills/piloto/SKILL.md`, `codex.md`, `piloto-decidir`, `piloto-control`, reglas y agentes                                                            | El paso lee su ruteo, sus decisiones y su criterio de terminado del coordinador; notas en `docs/pasos/<PASO>/`                                                                                | —                                                                                                   |

`pnpm test` corre todo (ver la tanda 3 para el total).

### Cosas que cambian en el día a día

- **Ya no hay ruteo con Sonnet** antes de cada paso. El modelo, el effort y el modo los fija la semilla. Si un paso falla dos veces, se sube el modelo en `plan.yaml` con una versión nueva de la semilla, no a mano.
- **Rojo o modo `…→manual`:** el paso corre hasta el plan auditado y te pregunta (compuerta `datos`). Con tu «aprobar» sigue solo, y su PR lo integras tú.
- **Fable:** con `claude -p` puede cobrar créditos sin preguntar, así que el bucle te pide permiso una vez por paso. Con `PILOTO_FABLE_OK=1` no lo pide.
- **Codex:** su paso deja los cambios sin commit, y el commit lo hace el bucle. Su consumo se anota en tokens y no cuenta para la cuota de Claude.
  - `-c model_reasoning_effort=…` usa `-c, --config <key=value>`, que `codex exec --help` lista (comprobado el 2026-10-30 en la máquina de Andrés). Que la clave `model_reasoning_effort` tenga efecto se ve en el primer paso real de Codex.

## Tanda 3: la app base (hecho)

El esqueleto de la app, sin nada del dominio de importadora:

- **Configuración:** Next 16, TypeScript 6, ESLint con boundaries, Vitest, Playwright con los proyectos `escritorio` y `movil`, prettier, commitlint y lefthook.
- **`supabase/`:** `config.toml` con el bloque 5 y una migración base (privilegios de `anon` y `_acotar_pagina`).
- **Pruebas de la base:** `rls-en-todo`, `privilegios-de-anon`, `escala` y `humo`. Corren con `pnpm db:probar` (PGlite).
- **`src/shared`:**
  - `config`: el entorno validado con Zod.
  - `lib`: los clientes de Supabase, `safe-action`, `errores`, `paginacion`, `conteo`, `fechas` y `formato`.
  - `lib/email`: el correo, con el adaptador de Mailpit.
  - `ui/diferido`.
- **`design/tokens.css`:** OKLCH claro y oscuro, entre las marcas `semilla:inicio` y `semilla:fin`.
- **`e2e/`:** los soportes y un spec de humo.
- **Plantillas:** `AGENTS.md`, con las reglas para todos los agentes, y `CLAUDE.md`, que es `@AGENTS.md` más lo propio de Claude.

Verificado en el contenedor el 2026-10-30:

| Comando                                             | Resultado                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm lint` y `pnpm typecheck`                      | Sin errores ni warnings                                                        |
| `pnpm build`, con las variables públicas de relleno | Compila                                                                        |
| `pnpm db:probar`                                    | Pasa                                                                           |
| `bash scripts/mapa.sh --check`                      | Pasa                                                                           |
| `prettier --check .`                                | Pasa                                                                           |
| `pnpm test`                                         | 702 pruebas de Vitest (las 541 de las guardas incluidas) y 40 de `node --test` |

**No se corrió:** `db:reset` y los e2e, porque en el contenedor no hay Docker. Corren en tu máquina.

### Lo que `semilla-a-repo` tiene que reemplazar

| Dónde                                | Qué                                                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `piloto.config`                      | `PROYECTO`, `PILOTO_BLOQUE`, `CARRILES_MAX`, `COORD_TOPE_PCT`, `PILOTO_AUTO_MIN` y `PILOTO_FUNCIONES`, desde el frontmatter de la semilla    |
| `supabase/config.toml`               | `project_id` y los puertos, con `baseDelBloque(PILOTO_BLOQUE)` de `scripts/lib/stack-local.mjs`                                              |
| `.github/workflows/ci.yml`           | `{{API_PORT}}`, `{{DB_PORT}}` y `{{FUNCIONES}}`                                                                                              |
| `AGENTS.md`                          | `{{NOMBRE}}`, `{{DESCRIPCION}}` y `{{SCOPES}}`                                                                                               |
| `commitlint.config.mjs`              | `// {{SCOPES_MODULOS}}`, por los módulos de la semilla **y los ids de los carriles**, porque los commits de un paso van con `tipo(<carril>)` |
| `design/tokens.css`                  | El bloque entre `semilla:inicio` y `semilla:fin`, por el CSS del sistema de diseño de la semilla                                             |
| `docs/semilla/`                      | `semilla.md` y `plan.yaml`. También genera `docs/UX.md`, `GLOSARIO.md` y `RENDIMIENTO.md` desde sus secciones                                |
| `src/shared/types/database.types.ts` | Hoy está escrito a mano. El primer arranque con Docker corre `pnpm db:types` y lo commitea; si no, el job `base` del CI cae                  |

## Entregable 2: `semilla-a-repo` (hecho)

Una semilla validada se convierte en un repo con dos piezas:

- **La skill** `.claude/skills/semilla-a-repo/SKILL.md`, que vive en el kit y no viaja a los proyectos. Abres Claude Code en la carpeta del kit, en Orca o en la terminal, con Opus 5.5 · medium, y escribes `/semilla-a-repo <slug>`.
  - Comprueba las guardas: el modelo, el kit limpio, las herramientas y que la semilla esté auditada.
  - Hace un ensayo y una sola ronda de preguntas: si hace falta la auditoría, si crea el repo privado en GitHub y cuántos carriles abrir.
  - Crea el repo, lo verifica, genera los tipos con Docker, lo publica y abre los carriles.
  - **No arranca los pilotos:** te deja el comando para que lo decidas tú.
- **El script** `scripts/kit/nuevo-proyecto.mjs` (`pnpm kit:nuevo <semilla> <destino> [--en-seco]`) hace la parte determinista.
  - Valida con el validador de idea-a-semilla y con el del coordinador, y exige el contrato de tokens.
  - Elige un bloque de puertos libre, copia el kit sin lo que es solo del kit, hace todos los reemplazos de la tabla de arriba, genera los docs derivados y hace el primer commit.
  - Se niega si queda algún marcador sin reemplazar.

Probado (`pnpm test:generador`: 7 pruebas, con el validador real de idea-a-semilla). Además, un proyecto generado desde una semilla de prueba pasó en el contenedor, desde cero:

| Comando                                                    | Resultado                                   |
| ---------------------------------------------------------- | ------------------------------------------- |
| `pnpm install`, `lint`, `typecheck`, `db:probar` y `build` | En verde                                    |
| `pnpm test`                                                | 702 pruebas de Vitest y 40 de `node --test` |
| `prettier --check` y `mapa.sh --check`                     | En verde                                    |
| `coordinador validar`                                      | En verde                                    |

El contrato con idea-a-semilla (v2.1):

- Los títulos de las secciones van exactos.
- Un solo bloque ` ```css ` con `:root` y `.dark`, que incluye todos los nombres de token de `design/tokens.css`.
- `slug` y los ids de carril con su formato.
- Opcionales: `descripcion`, `funciones_edge` y `carriles_max`.

Si la semilla no cumple, `semilla-a-repo` para y el arreglo vuelve a la semilla.

## Lo que no está verificado

- **Si Orca muestra los worktrees que crea `git worktree add`** (los de `abrir-carriles.sh`). Si no los muestra, se abren desde Orca con la misma rama y después se corre `preparar.sh`. Se prueba en el entregable 4.
- **Si los costos de Codex aparecen en algún JSON:** sin eso, su cuota no entra en el cálculo.
- **El techo de RAM** con más de 3 carriles en tu máquina: importadora llegó a 19,6 de 30 GB con 3 stacks y un e2e en cada uno.
