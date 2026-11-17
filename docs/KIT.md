# El kit de proyecto

La plantilla de la que se crea cada proyecto nuevo: una app Next 16 + Supabase + Tailwind 4 sin dominio, con el flujo de trabajo de
`calesa-app` ya armado. Un proyecto nace con **una sola forma de trabajar**: una rama, un PR con auto-merge que decide el CI y, para una
tanda de tareas que corre sola, el orquestador (`docs/FLUJO.md`, `scripts/orquestador/README.md`).

**Se quitó (K04):** el piloto (`scripts/piloto/`), el coordinador (`scripts/coordinador/`), las compuertas, `piloto.config`, `docs/pasos/`
y los agentes `planificador` y `auditor`. Un proyecto generado no trae nada de eso. Los orquestadores de una máquina se reparten el
límite de Claude con turnos de sesión y una pausa compartida (`scripts/orquestador/README.md` › «Uno por proyecto»).

## Qué trae

| Qué                                                                                        | Para qué                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/flujo/` (`estado.sh`, `publicar.sh`, `limpiar-ramas.mjs`)                         | Mirar el estado, publicar el PR con auto-merge y limpiar las ramas integradas                                                                                                                                               |
| `scripts/orquestador/`                                                                     | La cola de tareas en los issues `cola` (copia en `.orquestador/`): un carril, una sesión de `claude -p` y un PR por tarea                                                                                                   |
| `.github/workflows/ci.yml`, `.github/acciones/`                                            | El CI por niveles; `Listo · todo en verde` es el único check que `main` exige                                                                                                                                               |
| `.claude/` (settings, hooks, reglas, skills `entregar`, `feature`, `revisar`)              | Los hooks bloquean lo peligroso, lintean cada archivo y verifican al terminar; el agente `revisor` revisa sin poder editar                                                                                                  |
| `scripts/guardas/`, `scripts/nivel.mjs`, `scripts/e2e-dirigidos.mjs`                       | Las guardas que corren con `pnpm test` y la elección de qué e2e corre un PR                                                                                                                                                 |
| `scripts/lib/stack-local.mjs`, `scripts/worktree/`                                         | Los puertos por bloque y por carril (a, b, c), y el worktree con su propio stack de Supabase                                                                                                                                |
| `.proyecto/proyecto.yaml`, `scripts/proyecto/manifiesto.mjs`                               | Quién es el repo: el manifiesto (abajo)                                                                                                                                                                                     |
| `scripts/contratos/` (`pnpm contrato:generar`, `probar`, `tipos`, `usar`)                  | Los contratos de base entre repos: el proveedor genera y prueba sus versiones desde su base local; el consumidor fija una copia y revisa su `infra/` (abajo)                                                                |
| `src/shared`, `design/tokens.css`, `supabase/`, `e2e/`                                     | La app base: entorno con Zod, clientes de Supabase, `safe-action`, paginación, fechas y formato, correo; tokens OKLCH; una migración base y las pruebas de la base (`rls-en-todo`, `privilegios-de-anon`, `escala`, `humo`) |
| `scripts/kit/` (`nuevo-proyecto.mjs`, `publicar-proyecto.mjs`, `flujo.txt`, el `gh` falso) | El generador de los repos de un proyecto, su publicación en GitHub con la cola y la lista de lo que es flujo; no viajan a un proyecto                                                                                       |
| `scripts/semilla/`, `docs/semillas/`                                                       | De idea-a-semilla: el validador, la semilla de ejemplo v2 (turnero: app y web), las lecciones de las semillas y la plantilla del manifiesto; no viajan                                                                      |

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
`plantilla` del job `cambios`, por `.kit/plantilla`). En su lugar, «kit · proyecto de ejemplo» corre las pruebas del generador y del
validador de semillas (con PyYAML exigido: `SEMILLA_EXIGE_PYYAML=1`), genera con `nuevo-proyecto.mjs` los dos repos de la semilla de
ejemplo v2 (`scripts/semilla/ejemplo/`, en una raíz temporal) y le corre a cada uno `pnpm install`, `lint`, `typecheck`, `test` y
`db:probar`.

## El manifiesto del proyecto

Cada repo sabe quién es leyendo **sólo** su copia `.proyecto/proyecto.yaml` (esquema `proyecto/v1`: la copia es el manifiesto entero).
El esquema vive en el kit, en `docs/semillas/proyecto.plantilla.yaml`, y
`python3 _herramientas/kit/scripts/semilla/validar_semilla.py --manifiesto <archivo>` lo comprueba; `scripts/proyecto/manifiesto.mjs` revisa lo
que el kit usa y, si algo falla, dice qué campo y ese comando. El kit lleva uno de ejemplo (`proyecto: cambiar-slug`), que el
generador reemplaza por la copia entera del manifiesto del proyecto.

| Quién lo lee                                                                                      | Qué toma del manifiesto                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/lib/stack-local.mjs` (`baseDelRepo`, `proyectoDelRepo`) y `scripts/worktree/preparar.sh` | `puertos.bloque` o `puertos.heredado` (calesa-app, 546xx: no se mueven), y el `nombre` del repo para la pila de cada carril (`<proyecto>-<rol>-<carril>`: con el slug solo, app y web de un proyecto compartían contenedores). **Sin manifiesto: el bloque 5 y un aviso por stderr** |
| `scripts/flujo/publicar.sh`, `estado.sh` y `scripts/orquestador/orquestador.sh`                   | La cuenta de `github` para el token de `gh`; sin manifiesto, la del remoto                                                                                                                                                                                                           |
| `scripts/orquestador/orquestador.sh`                                                              | `PROYECTO` (el `nombre` del repo, `<proyecto>-<rol>`) si `config.env` o `config.local.env` no lo fijan                                                                                                                                                                               |
| `scripts/kit/nuevo-proyecto.mjs`                                                                  | Lo escribe: el `z_<slug>/proyecto.yaml` suelto y la copia de cada repo. Un bloque libre por repo nuevo, el primero de `[5,6,7,8,9,1,2,3]` que no use ningún `<raíz>/z_*/proyecto.yaml` ni este proyecto (raíz: dos arriba de la principal del kit)                                   |
| `scripts/contratos/` (`manifiesto.ts`) y el job `contrato` del CI                                 | `provee`, `consume` y `contratos[]` (`tipo`, `vigentes`, `proveedor`, `consumidores`), revisados aparte: un contrato mal escrito no tumba los puertos ni el orquestador                                                                                                              |

- El repo propio es el que se llama como el remoto `origin` (o como su carpeta); si ninguno se llama así, el que tiene ese nombre en
  `github` o ese `rol` (un repo recién creado vive en `z_<proyecto>/<rol>` y todavía no tiene remoto). Un manifiesto de un solo repo no
  necesita el nombre.
- Dos manifiestos con el mismo bloque, o un `--bloque` que otro ya usa, hacen fallar al generador nombrando los archivos.
- Sin manifiesto, el nombre de la pila sale del `project_id` de `supabase/config.toml` (con aviso); sin ninguno de los dos, falla.

## Contratos entre repos

Un repo provee un contrato de base (vistas, RPC, tipos y permisos de un esquema propio) y otro lo consume; ninguna CI mira la base de
otro repo. El orden de un cambio, quién escribe cada archivo y qué rompe una versión: `.claude/rules/contratos.md`. Lo que decide el
código de `scripts/contratos/`:

- La introspección es **una** sentencia `select` sobre `pg_catalog` que devuelve un `jsonb`, sin `set` de sesión; la corre el psql
  del contenedor de la pila local (`docker exec`, como `e2e/soporte/sql.ts`) y, en las pruebas, PGlite: se prueba el mismo SQL. Sin
  dependencias nuevas (`pg` sin sus tipos pediría `@types/pg`).
- Los nombres de tipo se arman desde `nspname` (los de `pg_catalog` con `format_type`), nunca según el `search_path`; el orden se
  hace en JS, por código, nunca `localeCompare`. El texto es `JSON.stringify(…, null, 2)` con las claves en un orden fijo: la guarda
  de versiones publicadas compara bytes, así que `contratos/`, `.proyecto/contratos/` y `src/shared/types/contratos/` van en
  `.prettierignore` (y los tipos, también fuera de ESLint).
- Los permisos son los efectivos (`has_*_privilege`, con PUBLIC y la pertenencia a roles): lo que vive quien llama.
- `contrato:probar` revisa `vigentes` ∪ {la de `provee`}, con los objetos de cada versión, y compara los tipos contra todos los del
  esquema; `contrato:usar` sólo revisa lo encadenado a `.schema('<esquema fijado>')`. `generar` y `probar` exigen el esquema
  en `[api] schemas` de `supabase/config.toml`: sin él todo daría verde y el consumidor recibiría un 404.
- `ci-cambios.sh` dispara `contrato` y `contrato-uso` también con lo que esos jobs corren (sus scripts, el lector del manifiesto, la
  pila, el CI y las dependencias), y lee el diff con `--no-renames`.
- Los tipos TS tienen la forma de `Database` de Supabase (`Database & Contrato<Id>`); `Json` se declara sólo si se usa, porque el
  `typecheck` del consumidor corre con `noUnusedLocals`.
- El job `contrato` levanta la pila sólo si el repo provee algo (el paso `rol`: `cambios` no instala dependencias); `contrato-uso` no
  usa base. Los dos se saltan en la plantilla. `src/shared/types/contratos/` no cuenta como disparador `shared` del Nivel 2.

## Crear un proyecto

Con la skill `/semilla-a-repo <slug>` (`.claude/skills/semilla-a-repo/SKILL.md`): guardas, ensayo, una sola ronda (effort y GitHub),
crear y verificar, los tipos con Docker, GitHub, la cola y la protección; al final, el comando para encender cada orquestador, que
corre la persona. La parte determinista son dos CLI, que la skill corre en orden:

```bash
node scripts/kit/nuevo-proyecto.mjs <slug> [--sumar <rol>] [--en-seco] [--raiz <dir>] [--bloque N]
node scripts/kit/publicar-proyecto.mjs <slug> secretos|crear|cola|proteger [--rol <rol>] [--actualizar <rol>] [--privado] [--aunque-rojo]
```

- **Rutas calculadas.** La semilla es `<raíz>/z_<slug>/semilla/` (v2: `comun.md`, `repos/<rol>/semilla.md` y `plan.yaml`,
  `registro.md`); el manifiesto, `z_<slug>/proyecto.yaml`; cada repo, `z_<slug>/<rol>/`. La raíz es dos arriba de la principal del kit
  (`git rev-parse --git-common-dir`: desde un worktree del kit, `<kit>/../..` caería en `.orquestador/`). `--raiz` la mueve entera,
  sólo para las pruebas y el CI.
- **`nuevo-proyecto.mjs`** valida la semilla con `scripts/semilla/validar_semilla.py` (se niega con su salida tal cual, con una marca
  «verificar» y sin la auditoría independiente que pide el tamaño), exige el contrato de tokens, escribe el manifiesto (validado también
  con `--manifiesto`) **antes** de crear los repos (un corte deja los bloques reservados) y crea cada repo en construcción que falta. Sin
  manifiesto crea todos; con él, los que están en construcción sin carpeta; un repo de la semilla que no está en el manifiesto entra con
  `--sumar <rol>`, uno por vez. Una carpeta ocupada se salta y se dice; un repo en mantenimiento fuera del manifiesto se agrega a mano
  (sus puertos no se adivinan). Cada repo se arma en `z_<slug>/.<rol>.creando-<pid>` y se renombra al final. `--en-seco` hace todo en
  memoria y da el resumen de seis líneas por repo.
- **`publicar-proyecto.mjs`**: `secretos` revisa lo versionado (archivos de entorno, claves privadas, tokens); `crear` hace el repo en
  GitHub (público; privado sólo con plan de pago, porque con GitHub Free un privado no tiene auto-merge ni protección), los ajustes y
  la protección de calesa-app (`scripts/kit/github.mjs`), `origin` y las etiquetas de la cola; `cola` crea un issue por paso del plan en
  el orden de todo el proyecto y el cierre de cada repo (`scripts/orquestador/plantillas/cerrar-construccion.md`), sin duplicar al volver
  a correr (busca por el `paso:` del yaml de cada issue, sólo de autores con permiso); `cola --actualizar <rol>` suma los pasos nuevos de
  una versión nueva de la semilla y los agrega al `depende` del cierre si no arrancó; `proteger` protege main si su primer CI terminó en
  verde (75 si sigue corriendo). Cada llamada va con `GH_TOKEN` de la cuenta dueña.
- **De un paso a un issue** (`scripts/kit/plan-a-cola.mjs`): rama `<tipo>/<pid>-<tema>` (feat salvo que el título empiece con arreglar o
  corregir, documentar, refactorizar o reorganizar, optimizar o probar); `depende` con `T<n>` (el número que dio GitHub) en el mismo repo
  y `<slug>-<rol>:<rama>` para otro; `conflicto` = el carril; `nivel`, `effort` y `planificar` del ruteo; `paso: P07`. El cuerpo: el
  pedido, el criterio de terminado, las decisiones con su texto del registro (y la línea del contrato si el paso lo publica o lo adopta),
  los módulos y el carril, los estados de las pantallas de «Experiencia» bajo sus rutas y la verificación (con el agente `revisor` si el
  ruteo lo pide).
- **El primer push de main** lo hace la skill con git: es la única excepción del hook (`primer_push_de_main` en
  `.claude/hooks/bloquear-peligrosos.sh`: `origin` existe y no tiene main).
- Se prueba con `pnpm test:generador` (con un `gh` falso de varios repos, `scripts/kit/prueba/gh-falso.mjs`) y
  `pnpm exec vitest run scripts/semilla`.

### Lo que el generador reemplaza

| Dónde                                         | Qué                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El nombre                                     | `<slug>-<rol>` en todos lados: `project_id` de `supabase/config.toml` (los contenedores son `supabase_*_<project_id>`), `name` de `package.json`, `{{NOMBRE}}` y `cambiar-slug-app` de los archivos del flujo (`cambiar-slug` suelto pasa a `<slug>`)                                                   |
| `supabase/config.toml`                        | Los puertos, con `baseDelBloque(<bloque>)` de `scripts/lib/stack-local.mjs`                                                                                                                                                                                                                             |
| `e2e/funciones.txt`                           | Las funciones edge que los e2e exigen servidas, desde `funciones_edge` de la semilla del repo (una por línea)                                                                                                                                                                                           |
| `.github/workflows/ci.yml`                    | `{{API_PORT}}`, `{{DB_PORT}}` y `{{FUNCIONES}}`                                                                                                                                                                                                                                                         |
| `.github/acciones/pila/action.yml`            | `{{PUERTOS_PILA}}`: los puertos de la principal del bloque (del shadow al inspector; bloque 5: `55320-55329`)                                                                                                                                                                                           |
| Los archivos del flujo (`CON_NOMBRE`)         | El nombre del repo en el revisor, las tres skills, el README del orquestador y sus prompts (`PROYECTO` de su `config.env` va vacío: sale del manifiesto)                                                                                                                                                |
| `.proyecto/proyecto.yaml`                     | La copia del manifiesto entero, con su cabecera de copia. `provee` y `consume` nacen vacíos: con `provee: [x@1]` y sin `contratos/x@1.json` el job `contrato` caería desde el primer PR (y `contrato-uso` sin la copia fijada); los escribe el paso que publica o adopta el contrato, como pide su spec |
| `.kit/version`                                | El commit del kit del que salió (el `HEAD` de la principal; por eso la skill exige el kit en main y limpio)                                                                                                                                                                                             |
| `AGENTS.md`, `README.md`                      | `{{NOMBRE}}`, `{{DESCRIPCION}}` (la del repo) y `{{SCOPES}}`                                                                                                                                                                                                                                            |
| `commitlint.config.mjs`                       | `// {{SCOPES_MODULOS}}`, por los módulos (`src/modules/<x>/`) que nombra el `plan.yaml` del repo                                                                                                                                                                                                        |
| `src/shared/config/app.ts`                    | `NOMBRE_APP` = el nombre del proyecto (el que ve quien usa la app), la descripción del repo y los colores del manifest                                                                                                                                                                                  |
| `design/tokens.css`                           | El bloque entre `semilla:inicio` y `semilla:fin`, por el CSS de «Marca y sistema de diseño» de `comun.md`                                                                                                                                                                                               |
| `docs/semilla/`                               | `comun.md`, `registro.md`, y `semilla.md` y `plan.yaml` del repo (aplanados desde `repos/<rol>/`: las referencias del flujo a `docs/semilla/semilla.md` siguen valiendo y cada repo ve sólo lo suyo)                                                                                                    |
| `docs/UX.md`, `RENDIMIENTO.md`, `GLOSARIO.md` | De «Experiencia» y «Escala y rendimiento» del repo y de «Glosario» de lo común. Nacen de la semilla y se editan con cada cambio, como en cualquier repo: su cabecera nunca dice «no se edita a mano»                                                                                                    |
| `package.json`                                | Sin los scripts `kit:*` ni `test:generador` (`scripts/kit/` no viaja)                                                                                                                                                                                                                                   |
| `src/shared/types/database.types.ts`          | Hoy está escrito a mano. La skill corre `pnpm db:types` con Docker y lo commitea; si no, el job `base` del CI cae                                                                                                                                                                                       |

El contrato con idea-a-semilla es el de su validador: los títulos de las secciones exactos; en `comun.md`, un solo bloque ` ```css ` con
`:root` y `.dark` que incluye todos los nombres de token de `design/tokens.css`; `slug`, `repos[]` (rol, descripción, cuenta, etapa) y
`contratos[]`. Si la semilla no cumple, el arreglo vuelve a idea-a-semilla.

## Lo que no está verificado

- **GitHub de verdad:** crear el repo, los ajustes, las etiquetas, la cola, el primer push de main y la protección están probados con un
  `gh` falso (`scripts/kit/prueba/gh-falso.mjs`); con GitHub real corren recién en el primer proyecto. La base con Docker (`db:types` de
  un repo generado) y su primer CI (con el e2e completo), también.

- **Los contratos en un proyecto real:** la introspección está probada en PGlite (Postgres 18) y se corrió una vez a mano contra la
  pila de un carril (Postgres 17, la imagen de Supabase, con la misma salida byte a byte); el job `contrato` del CI y `contrato:usar`
  sobre el `infra/` de un consumidor real corren recién en el primer proyecto que provea o consuma uno (en el kit se saltan).

- **`preparar.sh`, `quitar.sh` y el stack de un carril:** pasan `bash -n`; no se corrieron en K04 (necesitan Docker y Supabase).
- **Los e2e y `db:reset`:** no corren en el contenedor sin Docker; corren en la máquina de la persona y en el CI del proyecto generado.
- **El techo de RAM** con más de 3 carriles: importadora llegó a 19,6 de 30 GB con 3 stacks y un e2e en cada uno.
- **Dos orquestadores de verdad en una máquina:** los turnos y la pausa compartida están probados con dos bucles y un `claude` falso
  (`scripts/orquestador/maquina.test.ts`); con dos servicios reales a la vez, todavía no.
- **El aviso de la noche en un `schedule` real:** `scripts/flujo/noche.mjs` está probado con un `gh` falso
  (`scripts/flujo/noche-gh.test.ts`) y el job `aviso-noche`, con la guarda de workflows; en el kit se salta (no hay e2e), así que corre
  de verdad recién en la primera noche roja de un proyecto generado.
- **La redacción de un pedido con un `claude` real:** probada con un `claude` falso que devuelve `SPEC:` o `PREGUNTAS:`
  (`scripts/orquestador/pedidos.test.ts`); que una sesión real en modo plan termine en una de las dos, todavía no.
- **La tarea de dependencias en una sesión `auto` real:** el hook con `ORQ_PERMITE` está probado (`bloquear-peligrosos.test.ts`); que el
  clasificador del modo `auto` deje correr la actualización, todavía no.
