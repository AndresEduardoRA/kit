# El kit de proyecto

La plantilla de la que se crea cada proyecto nuevo: una app Next 16 + Supabase + Tailwind 4 sin dominio, con el flujo de trabajo de
`calesa-app` ya armado. Un proyecto nace con **una sola forma de trabajar**: una rama, un PR con auto-merge que decide el CI y, para una
tanda de tareas que corre sola, el orquestador (`docs/FLUJO.md`, `scripts/orquestador/README.md`).

**Se quitó (K04):** el piloto (`scripts/piloto/`), el coordinador (`scripts/coordinador/`), las compuertas, `piloto.config`, `docs/pasos/`
y los agentes `planificador` y `auditor`. Un proyecto generado no trae nada de eso. El reparto del límite de Claude entre orquestadores
es de K06.

## Qué trae

| Qué                                                                           | Para qué                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/flujo/` (`estado.sh`, `publicar.sh`, `limpiar-ramas.mjs`)            | Mirar el estado, publicar el PR con auto-merge y limpiar las ramas integradas                                                                                                                                               |
| `scripts/orquestador/`                                                        | La cola de tareas en los issues `cola` (copia en `.orquestador/`): un carril, una sesión de `claude -p` y un PR por tarea                                                                                                   |
| `.github/workflows/ci.yml`, `.github/acciones/`                               | El CI por niveles; `Listo · todo en verde` es el único check que `main` exige                                                                                                                                               |
| `.claude/` (settings, hooks, reglas, skills `entregar`, `feature`, `revisar`) | Los hooks bloquean lo peligroso, lintean cada archivo y verifican al terminar; el agente `revisor` revisa sin poder editar                                                                                                  |
| `scripts/guardas/`, `scripts/nivel.mjs`, `scripts/e2e-dirigidos.mjs`          | Las guardas que corren con `pnpm test` y la elección de qué e2e corre un PR                                                                                                                                                 |
| `scripts/lib/stack-local.mjs`, `scripts/worktree/`                            | Los puertos por bloque y por carril (a, b, c), y el worktree con su propio stack de Supabase                                                                                                                                |
| `.proyecto/proyecto.yaml`, `scripts/proyecto/manifiesto.mjs`                  | Quién es el repo: el manifiesto (abajo)                                                                                                                                                                                     |
| `src/shared`, `design/tokens.css`, `supabase/`, `e2e/`                        | La app base: entorno con Zod, clientes de Supabase, `safe-action`, paginación, fechas y formato, correo; tokens OKLCH; una migración base y las pruebas de la base (`rls-en-todo`, `privilegios-de-anon`, `escala`, `humo`) |
| `scripts/kit/` (`nuevo-proyecto.mjs`, `flujo.txt`, fixtures)                  | El generador de proyectos y la lista de lo que es flujo; no viajan a un proyecto                                                                                                                                            |

Lo que es flujo, y por eso se lleva entre el kit y los proyectos (K12), está en `scripts/kit/flujo.txt`.

## De dónde sale

El flujo viene de `calesa-app`, copiado en K02 desde `origin/main` `499b26a9` (2026-11-16) y puesto al día en K04 con tres piezas que K02
dejó anotadas:

| Pieza                                    | Qué se trajo de `calesa-app`                                                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lefthook.yml`                           | El hook `pre-push`: el esquema en PGlite corre una vez al empujar SQL y en su modo rápido (`PROBAR_RAPIDO=1`); el commit ya no lo corre                                                 |
| `scripts/mapa.sh`                        | Un `export * from '<relativo>'` se sigue hasta los nombres del archivo (las entradas que sólo reexportan); se fue la revisión de fechas de DECISIONES y BITACORA                        |
| `db:probar:rapido`                       | El script de `package.json` y `PROBAR_RAPIDO` en `scripts/probar-schema.mjs`: salta los bloques `-- @test [lento] …`. El kit no tiene ninguno todavía; el CI corre `db:probar` completo |
| `scripts/nivel.mjs`, `scripts/huella.sh` | Una sola copia, la de app (el piloto tenía otra)                                                                                                                                        |

`commitlint.config.mjs` no se trajo: sus scopes son los módulos del proyecto, y el generador llena los de cada uno.

**El CI del kit prueba lo que sale del kit.** Los jobs de proyecto (`base`, `e2e-build`, `e2e`) se saltan en la plantilla (la salida
`plantilla` del job `cambios`, por `.kit/plantilla`). En su lugar, «kit · proyecto de ejemplo» genera con `nuevo-proyecto.mjs` un
proyecto desde `scripts/kit/fixtures/semilla-v1/` (con el validador v1 de `scripts/kit/fixtures/`) y le corre `pnpm install`, `lint`,
`typecheck`, `test` y `db:probar`.

## El manifiesto del proyecto

Cada repo sabe quién es leyendo **sólo** su copia `.proyecto/proyecto.yaml` (esquema `proyecto/v1`: la copia es el manifiesto entero).
El esquema vive fuera del repo, en `_herramientas/semillas/proyecto.plantilla.yaml`, y
`python3 _herramientas/semillas/validar_semilla.py --manifiesto <archivo>` lo comprueba; `scripts/proyecto/manifiesto.mjs` revisa lo
que el kit usa y, si algo falla, dice qué campo y ese comando. El kit lleva uno de ejemplo (`proyecto: cambiar-slug`), que el
generador reemplaza.

| Quién lo lee                                                                    | Qué toma del manifiesto                                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/lib/stack-local.mjs` (`baseDelRepo`) y `scripts/worktree/preparar.sh`  | `puertos.bloque` o `puertos.heredado` (calesa-app, 546xx: no se mueven). **Sin manifiesto: el bloque 5 y un aviso por stderr** |
| `scripts/flujo/publicar.sh`, `estado.sh` y `scripts/orquestador/orquestador.sh` | La cuenta de `github` para el token de `gh`; sin manifiesto, la del remoto                                                     |
| `scripts/orquestador/orquestador.sh`                                            | `PROYECTO` (el `nombre` del repo, `<proyecto>-<rol>`) si `config.env` o `config.local.env` no lo fijan                         |
| `scripts/kit/nuevo-proyecto.mjs`                                                | El bloque libre: el primero de `[5,6,7,8,9,1,2,3]` que no use ningún `<raíz>/z_*/proyecto.yaml` (raíz = `<kit>/../..`)         |

- El repo propio es el que se llama como el remoto `origin` (o como su carpeta); un manifiesto de un solo repo no necesita el nombre.
- Dos manifiestos con el mismo bloque, o un `--bloque` que otro ya usa, hacen fallar al generador nombrando los archivos.
- Sin manifiesto, el nombre del proyecto sale del `project_id` de `supabase/config.toml` (con aviso); sin ninguno de los dos, falla.
- Lo que nadie escribe todavía: el `z_<slug>/proyecto.yaml` suelto de un proyecto nuevo (K09: el generador de varios repos lo escribe);
  hasta entonces se crea a mano o el bloque siguiente no lo ve.

## Crear un proyecto

**`semilla-a-repo` está en reescritura (K09): no se usa hasta entonces.** Hoy la parte determinista se corre a mano:

```bash
pnpm kit:nuevo <carpeta de la semilla> <carpeta destino> [--bloque N] [--cuenta <cuenta>] [--validador <validar_semilla.py>] [--en-seco]
```

- Valida la semilla con el validador de idea-a-semilla y exige el contrato de tokens de `design/tokens.css`.
- Elige un bloque de puertos libre, copia el kit sin lo que es sólo del kit, hace los reemplazos de abajo, genera `docs/UX.md`,
  `GLOSARIO.md` y `RENDIMIENTO.md` desde la semilla y hace el primer commit.
- Se niega si queda un marcador sin reemplazar. Con `--en-seco` aplica los reemplazos en memoria y lo dice sin escribir nada.
- Se prueba con `pnpm test:generador`.

### Lo que el generador reemplaza

| Dónde                                 | Qué                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/config.toml`                | `project_id` y los puertos, con `baseDelBloque(<bloque>)` de `scripts/lib/stack-local.mjs`                                                                          |
| `e2e/funciones.txt`                   | Las funciones edge que los e2e exigen servidas, desde `funciones_edge` de la semilla (una por línea)                                                                |
| `.github/workflows/ci.yml`            | `{{API_PORT}}`, `{{DB_PORT}}` y `{{FUNCIONES}}`                                                                                                                     |
| `.github/acciones/pila/action.yml`    | `{{PUERTOS_PILA}}`: los puertos de la principal del bloque (del shadow al inspector; bloque 5: `55320-55329`)                                                       |
| Los archivos del flujo (`CON_NOMBRE`) | `{{NOMBRE}}` y `cambiar-slug` en el revisor, las tres skills, el README del orquestador y sus prompts (`PROYECTO` de su `config.env` va vacío: sale del manifiesto) |
| `.proyecto/proyecto.yaml`             | La copia del manifiesto: `proyecto`, `nombre`, el repo `<slug>-app`, su cuenta de GitHub (`--cuenta`; si no, la del ejemplo del kit) y el bloque                    |
| `AGENTS.md`                           | `{{NOMBRE}}`, `{{DESCRIPCION}}` y `{{SCOPES}}`                                                                                                                      |
| `commitlint.config.mjs`               | `// {{SCOPES_MODULOS}}`, por los módulos (`src/modules/<x>/`) que nombra el `plan.yaml` de la semilla                                                               |
| `design/tokens.css`                   | El bloque entre `semilla:inicio` y `semilla:fin`, por el CSS del sistema de diseño de la semilla                                                                    |
| `docs/semilla/`                       | `semilla.md` y `plan.yaml`, si los hay                                                                                                                              |
| `src/shared/types/database.types.ts`  | Hoy está escrito a mano. El primer arranque con Docker corre `pnpm db:types` y lo commitea; si no, el job `base` del CI cae                                         |

El contrato con idea-a-semilla: los títulos de las secciones van exactos; un solo bloque ` ```css ` con `:root` y `.dark` que incluye
todos los nombres de token de `design/tokens.css`; `slug` con su formato; opcional `descripcion` y `funciones_edge`. Si la semilla no
cumple, el arreglo vuelve a la semilla.

## Lo que no está verificado

- **`preparar.sh`, `quitar.sh` y el stack de un carril:** pasan `bash -n`; no se corrieron en K04 (necesitan Docker y Supabase).
- **Los e2e y `db:reset`:** no corren en el contenedor sin Docker; corren en la máquina de la persona y en el CI del proyecto generado.
- **El techo de RAM** con más de 3 carriles: importadora llegó a 19,6 de 30 GB con 3 stacks y un e2e en cada uno.
- **El reparto del límite de Claude entre orquestadores:** nadie lo cuenta hasta K06.
