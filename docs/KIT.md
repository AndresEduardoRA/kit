# El kit de proyecto

La plantilla de la que se crea cada proyecto nuevo: una app Next 16 + Supabase + Tailwind 4 sin dominio, con el flujo de trabajo de
`calesa-app` ya armado. Un proyecto nace con **una sola forma de trabajar**: una rama, un PR con auto-merge que decide el CI y, para una
tanda de tareas que corre sola, el orquestador (`docs/FLUJO.md`, `scripts/orquestador/README.md`).

**Se quitó (K04):** el piloto (`scripts/piloto/`), el coordinador (`scripts/coordinador/`), las compuertas, `piloto.config`, `docs/pasos/`
y los agentes `planificador` y `auditor`. Un proyecto generado no trae nada de eso. Los orquestadores de una máquina se reparten el
límite de Claude con turnos de sesión y una pausa compartida (`scripts/orquestador/README.md` › «Uno por proyecto»).

## Qué trae

| Qué                                                                                           | Para qué                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/flujo/` (`estado.sh`, `publicar.sh`, `limpiar-ramas.mjs`, `cierre.mjs`)              | Mirar el estado, publicar el PR con auto-merge, limpiar las ramas integradas y cerrar la construcción de un repo                                                                                                            |
| `scripts/orquestador/`                                                                        | La cola de tareas en los issues `cola` (copia en `.orquestador/`): un carril, una sesión de `claude -p` y un PR por tarea                                                                                                   |
| `.github/workflows/ci.yml`, `.github/acciones/`                                               | El CI por niveles; `Listo · todo en verde` es el único check que `main` exige                                                                                                                                               |
| `.claude/` (settings, hooks, reglas, skills `entregar`, `feature`, `revisar`)                 | Los hooks bloquean lo peligroso, lintean cada archivo y verifican al terminar; el agente `revisor` revisa sin poder editar                                                                                                  |
| `scripts/guardas/`, `scripts/nivel.mjs`, `scripts/e2e-dirigidos.mjs`                          | Las guardas que corren con `pnpm test` y la elección de qué e2e corre un PR                                                                                                                                                 |
| `scripts/lib/stack-local.mjs`, `scripts/worktree/`                                            | Los puertos por bloque y por carril (a, b, c), y el worktree con su propio stack de Supabase                                                                                                                                |
| `.proyecto/proyecto.yaml`, `scripts/proyecto/manifiesto.mjs`                                  | Quién es el repo: el manifiesto (abajo)                                                                                                                                                                                     |
| `scripts/contratos/` (`pnpm contrato:generar`, `probar`, `tipos`, `usar`)                     | Los contratos de base entre repos: el proveedor genera y prueba sus versiones desde su base local; el consumidor fija una copia y revisa su `infra/` (abajo)                                                                |
| `src/shared`, `design/tokens.css`, `supabase/`, `e2e/`                                        | La app base: entorno con Zod, clientes de Supabase, `safe-action`, paginación, fechas y formato, correo; tokens OKLCH; una migración base y las pruebas de la base (`rls-en-todo`, `privilegios-de-anon`, `escala`, `humo`) |
| `scripts/proyecto/proyecto.sh` (`proyecto.mjs`, `proyecto-texto.mjs`)                         | El estado de un proyecto entero y su resumen diario al celular (abajo); no viaja a un proyecto                                                                                                                              |
| `scripts/kit/` (`nuevo-proyecto.mjs`, `publicar-proyecto.mjs`, `flujo.txt`, `actualizar.mjs`) | El generador de los repos de un proyecto y su publicación en GitHub con la cola (no viajan), y lo que es flujo con lo que lo trae del kit (viaja: abajo)                                                                    |
| `scripts/semilla/`, `docs/semillas/`                                                          | De idea-a-semilla: el validador, la semilla de ejemplo v2 (turnero: app y web), las lecciones de las semillas y la plantilla del manifiesto; no viajan                                                                      |

Lo que es flujo, y por eso se lleva entre el kit y los proyectos, está en `scripts/kit/flujo.txt` (abajo, «El flujo entre el kit y
los proyectos»).

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
| Los archivos del flujo (`CON_NOMBRE`)         | El nombre del repo en el revisor, las tres skills, el README del orquestador y sus prompts (`PROYECTO` de su `config.env` va vacío: sale del manifiesto); lo del flujo vive en `scripts/kit/personalizar.mjs`, que usa también `actualizar.mjs`                                                         |
| `.proyecto/proyecto.yaml`                     | La copia del manifiesto entero, con su cabecera de copia. `provee` y `consume` nacen vacíos: con `provee: [x@1]` y sin `contratos/x@1.json` el job `contrato` caería desde el primer PR (y `contrato-uso` sin la copia fijada); los escribe el paso que publica o adopta el contrato, como pide su spec |
| `.kit/version`                                | El commit del kit del que salió (el `HEAD` de la principal; por eso la skill exige el kit en main y limpio), y lo avanza `actualizar.mjs`                                                                                                                                                               |
| `AGENTS.md`, `README.md`                      | `{{NOMBRE}}`, `{{DESCRIPCION}}` (la del repo) y `{{SCOPES}}`                                                                                                                                                                                                                                            |
| `commitlint.config.mjs`                       | `// {{SCOPES_MODULOS}}`, por los módulos (`src/modules/<x>/`) que nombra el `plan.yaml` del repo                                                                                                                                                                                                        |
| `src/shared/config/app.ts`                    | `NOMBRE_APP` = el nombre del proyecto (el que ve quien usa la app), la descripción del repo y los colores del manifest                                                                                                                                                                                  |
| `design/tokens.css`                           | El bloque entre `semilla:inicio` y `semilla:fin`, por el CSS de «Marca y sistema de diseño» de `comun.md`                                                                                                                                                                                               |
| `docs/semilla/`                               | `comun.md`, `registro.md`, y `semilla.md` y `plan.yaml` del repo (aplanados desde `repos/<rol>/`: las referencias del flujo a `docs/semilla/semilla.md` siguen valiendo y cada repo ve sólo lo suyo)                                                                                                    |
| `docs/UX.md`, `RENDIMIENTO.md`, `GLOSARIO.md` | De «Experiencia» y «Escala y rendimiento» del repo y de «Glosario» de lo común. Nacen de la semilla y se editan con cada cambio, como en cualquier repo: su cabecera nunca dice «no se edita a mano»                                                                                                    |
| `package.json`                                | Sin los scripts `kit:*` ni `test:generador` (el generador no viaja)                                                                                                                                                                                                                                     |
| `src/shared/types/database.types.ts`          | Hoy está escrito a mano. La skill corre `pnpm db:types` con Docker y lo commitea; si no, el job `base` del CI cae                                                                                                                                                                                       |

El contrato con idea-a-semilla es el de su validador: los títulos de las secciones exactos; en `comun.md`, un solo bloque ` ```css ` con
`:root` y `.dark` que incluye todos los nombres de token de `design/tokens.css`; `slug`, `repos[]` (rol, descripción, cuenta, etapa) y
`contratos[]`. Si la semilla no cumple, el arreglo vuelve a idea-a-semilla.

## El cierre de la construcción

La última tarea de la cola de cada repo nace de `scripts/orquestador/plantillas/cerrar-construccion.md` (la crea `publicar-proyecto.mjs
cola`). Lo determinista lo hace `node scripts/flujo/cierre.mjs`, que viaja a cada repo con `scripts/flujo/`:

- `pasos --etiqueta semilla-vN`: los issues de pasos (`paso:` en su yaml) que no están integrados ni omitidos; si hay, la tarea se traba.
- `aplicar --etiqueta semilla-vN`: `docs/DECISIONES.md` desde `registro.md` (por la letra del ID, con las áreas de la plantilla del
  registro), `docs/PENDIENTES.md` desde «Riesgos y supuestos» y las «Decisiones tomadas sin preguntar» de los PR integrados, el borrador
  de `docs/ESTADO.md` (el molde de calesa-app, con «completar…» donde va criterio), «Para las semillas» en `docs/LECCIONES.md`, el repo
  en `etapa: mantenimiento` y `semilla: semilla-vN` (sólo esos dos valores del manifiesto) y fuera `docs/semilla/`. Se repite sin riesgo.
- `retro`: el borrador de `## Retro` del PR (trabadas con su respuesta, decisiones sin preguntar, pasos omitidos, rehechos o fuera del
  plan), cada línea por clasificar: hueco de la semilla, defecto del kit u otro.
- `comprobar --etiqueta semilla-vN --cuerpo <archivo>`: los cinco docs, ESTADO en 60 líneas, ningún «completar», sin `docs/semilla/`, el
  manifiesto cambiado y la retro clasificada.

La etiqueta la crea el orquestador al integrar (`al_integrar: etiquetar semilla-vN`, `scripts/orquestador/al-integrar.sh`) sobre el padre
del commit integrado: el PR del cierre saca `docs/semilla/`, y la etiqueta la conserva. El PR se titula
`chore(docs): cerrar la construcción (semilla-vN)`, para encontrarlo con `gh pr list --state merged --search 'cerrar la construcción in:title'`;
su `## Retro` la copia K11 a `z_<slug>/semilla/retro.md`. Se prueba con `scripts/flujo/cierre.test.ts`,
`scripts/orquestador/al-integrar.test.ts` y el ensayo sobre el proyecto de ejemplo, `scripts/kit/cierre-ensayo.test.mjs`.

## El estado de un proyecto

Un repo se mira con `scripts/flujo/estado.sh`; un **proyecto** (varios repos, quizá de cuentas distintas) se mira desde `proyectos/`:

```bash
bash _herramientas/kit/scripts/proyecto/proyecto.sh estado <z_carpeta>|--todos
bash _herramientas/kit/scripts/proyecto/proyecto.sh sincronizar <z_carpeta>|--todos
bash _herramientas/kit/scripts/proyecto/proyecto.sh reconstruir <z_carpeta> [--forzar]
bash _herramientas/kit/scripts/proyecto/proyecto.sh resumen --todos
bash _herramientas/kit/scripts/proyecto/proyecto.sh instalar-resumen
```

- **`estado`** lee sólo `z_*/proyecto.yaml` y, por GitHub con el token de la cuenta de cada repo (`gh auth token --user`, nunca un
  `GH_TOKEN` suelto), dice por repo: PR abiertos con su «Listo» (un PR de `DIAS_DE_UN_PR` = 2 días o más va en rojo aunque su CI esté
  verde: «nadie lo vio»), el último CI de `main`, la última noche, las `cola:trabada` y `cola:pregunta` (rojo), las `cola:urgente` y
  cuántas hay en la cola (con tope: «más de 99», nunca un total exacto). Marcas `✓ ✗ ·` como `estado.sh`. Sin token de una cuenta, esa
  línea dice «sin acceso a <cuenta>» y sigue; sin red, dice sólo lo local; sin el suelto, sugiere `reconstruir`. Nunca frena (sale con 0;
  1 sólo si se pidió una carpeta que no existe o no tiene manifiesto).
- **`sincronizar`** trae de la copia de cada repo en `main` (`gh api …/contents/.proyecto/proyecto.yaml`) lo que manda el repo (`etapa`,
  `semilla`, `provee` y los `vigentes` de lo que provee) al suelto, cambiando sólo esos valores (los comentarios y el resto quedan). Si en
  una copia difiere lo que manda el proyecto (nombre, `github`, `puertos`, contratos y sus consumidores, `semilla` del proyecto), abre en
  ese repo un issue `cola` «sincronizar el manifiesto» con las diferencias y el contenido esperado (y no lo duplica mientras siga
  abierto). `consume` no se compara ni se trae: el esquema no se lo asigna a nadie y lo escribe `contrato:usar`. Copia la `## Retro` del PR
  integrado «cerrar la construcción» de cada repo a `z_<slug>/semilla/retro.md` (un bloque por repo, que se reescribe sin tocar los demás).
- **`reconstruir`** rehace el suelto desde las copias locales `z_<slug>/<rol>/.proyecto/proyecto.yaml`: la que lista más repos y contratos
  es la base y lo de cada repo sale de su propia copia. No pisa uno que existe sin `--forzar` (que deja el anterior en `proyecto.yaml.anterior`).
- **`resumen --todos`** manda un aviso de ntfy por proyecto, con lo que está en rojo o lo que no se pudo mirar, o «Todo en verde», al
  `NTFY_TEMA` (y `NTFY_SERVIDOR`, opcional) de `~/.config/orquestador/maquina.env`. **`instalar-resumen`** deja el timer de systemd de usuario
  `proyectos-resumen.timer` (cada día a las 08:00 de La Paz, `Persistent=true`) que corre `sincronizar --todos` y `resumen --todos`: lo
  corre la persona, una vez (con `loginctl enable-linger "$USER"` para que siga sin sesión).

Se prueba en `scripts/proyecto/proyecto.test.mjs` con un `gh` falso de dos cuentas (`proyecto-gh-falso.mjs`), un ntfy falso y un
`systemctl` falso. **Sin verificar con GitHub y systemd reales:** los puntos de entrada de la API (`search/issues` para la retro, el
`Accept: application/vnd.github.raw` de `contents`) y `OnCalendar` con zona horaria corren de verdad con la primera instalación.

## El flujo entre el kit y los proyectos

Las mejoras del flujo viajan solas en los dos sentidos como tareas de la cola, probadas por el CI de quien las recibe. Nunca tocan
`src/`, `supabase/` ni nada del producto.

```
                  kit (AndresEduardoRA/kit · main)
         tarea semanal │                    ▲ issue «traer de <repo> el PR #n» (cola)
    actualizar.mjs     │                    │ skill traer-de-proyecto
    (mezcla de 3 vías) ▼                    │ (al integrar un PR que toca flujo)
                repo del proyecto · .kit/version · .kit/omitir
```

- **Qué es flujo:** `scripts/kit/flujo.txt`, una ruta o patrón por línea (`**` cruza carpetas, `*` no), con un solo lector
  (`scripts/kit/flujo.mjs`). Nunca es flujo `src/`, `supabase/`, `design/` ni `docs/` salvo `FLUJO.md`, `LECCIONES.md` y `KIT.md`
  (`rutaProhibida`, aunque `flujo.txt` dijera otra cosa). Lo de `scripts/kit/` que está en `flujo.txt` (`actualizar.mjs` y lo que usa)
  viaja a cada proyecto; el generador y la publicación, no. `nuevo-proyecto.test.mjs` exige que todo lo de `flujo.txt` viaje y que cada
  línea nombre un archivo del kit.
- **`.kit/version`:** el commit del kit del que el repo trae el flujo. Lo escribe el generador y lo avanza `actualizar.mjs`.
- **`.kit/omitir`:** lo que el proyecto no quiere del kit, con la sintaxis de `flujo.txt`. Un archivo de flujo borrado en el proyecto y
  no anotado ahí vuelve con la actualización siguiente (el resumen lo dice).

### Del kit al proyecto

`node scripts/kit/actualizar.mjs [--revisar] [--tomar-kit <ruta>]… [--dejar <ruta>]…`, desde la raíz del repo del proyecto. Baja por
GitHub (`gh api repos/<kit>/tarball/<sha>`, nunca la carpeta hermana; con el token del dueño del kit o, sin su sesión, el del entorno)
el kit en `.kit/version` (base) y en main (nuevo), personaliza los dos para el repo con `scripts/kit/personalizar.mjs` (lo mismo que
hace el generador, con el nombre, el slug, el bloque y las funciones del repo) y decide cada archivo de flujo (`scripts/kit/mezcla.mjs`):

| Caso (b = base, n = nuevo, o = el del repo)   | Qué hace                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| La ruta está en `.kit/omitir`                 | Nada                                                                                   |
| `--dejar`                                     | Nada (responde cualquier choque)                                                       |
| `--tomar-kit`                                 | Escribe n (o borra si el kit lo borró), salvo en los dos choques de las últimas filas  |
| El kit no lo cambió (b = n)                   | Nada; si se borró en el repo, lo restaura                                              |
| El kit lo borró                               | Lo borra si el repo no lo cambió; si lo cambió, choque                                 |
| El kit lo creó                                | Lo escribe si no está; si está distinto, choque                                        |
| Los tres existen                              | o = b: escribe n · o = n: nada · si no, `git merge-file` (un choque suyo es un choque) |
| Binario                                       | o = b: escribe n · si no, choque                                                       |
| n personalizado deja un marcador suelto       | Choque («quedaría el marcador X»)                                                      |
| `ci.yml` o `action.yml` en un repo sin bloque | Choque (puertos heredados)                                                             |

- **Todo o nada:** decide todos los archivos antes de escribir; con un choque no escribe nada (ni marcas `<<<<<<<`) y sale con 3. Sin
  choques escribe (con el bit de ejecución del kit), pone `.kit/version` en main y commitea sólo eso, con los hooks:
  `chore(kit): traer el flujo del kit <sha corto>`. Exige el árbol limpio.
- **Responder una trabada,** por ruta: `--tomar-kit <ruta>` (la del kit), `--dejar <ruta>` (la del repo, esta vez) o una línea en
  `.kit/omitir` (nunca más). Un marcador suelto o los puertos sin bloque no se resuelven tomando la del kit (dejaría el marcador): sólo
  `--dejar` u `.kit/omitir`, y el marcador suelto es un defecto del kit.
- **`docs/LECCIONES.md`** se mezcla con `--union` (las dos partes suman viñetas al final de la misma sección) y pierde la viñeta `… (kit)`
  del repo que el kit ya absorbió con el sufijo `(<repo>, PR #<n>)` (entera, con sus líneas de continuación).
- **`--revisar`** (lo corre la tarea semanal): atrás si el `compare` de GitHub entre `.kit/version` y main cambió algún archivo de flujo
  del `flujo.txt` del repo (menos `.kit/omitir`), o si cortó la lista en 300. Un kit que sólo avanzó fuera del flujo está al día.
- **Sale con** 0 (hecho o al día), 1 (no pudo: sin acceso al kit, sin `.kit/version` o uno que el kit no tiene, el árbol sucio, el
  commit que cayó), 3 (choques), 10 (`--revisar`: atrás) o 64 (uso).
- **Un repo de antes** de esto se pone al día una vez a mano, desde su raíz: `node <kit>/scripts/kit/actualizar.mjs`. Trabaja sobre el
  repo del directorio actual y baja el kit por GitHub; exige `.kit/version`.
- La tarea que lo corre cada semana: `scripts/orquestador/README.md` › «La tarea semanal del flujo del kit» (`KIT_SEMANAL`).

### Del proyecto al kit

- Al integrar un PR que toca flujo (o suma una lección `(kit)` o `(semilla)`), el orquestador del proyecto crea en el kit un issue
  `cola` «traer de <repo> el PR #<n>» con el token del dueño del kit (`scripts/orquestador/README.md` › «Lo que sube al kit»,
  `KIT_AVISAR`).
- En el kit la hace la skill `traer-de-proyecto` (`.claude/skills/traer-de-proyecto/SKILL.md`). Lo determinista,
  `node scripts/kit/traer-de-proyecto.mjs <cuenta/repo> <pr>`: baja el proyecto antes y después del squash del PR y aplica cada cambio
  de flujo con una mezcla doble (el cambio del PR sobre el kit personalizado, y de ahí sobre el kit genérico: lo que el PR no tocó
  conserva sus marcadores). Un cambio pegado a una línea con marcador choca y lo aplica la sesión, con las tres versiones guardadas; un
  borrado queda por decidir. `traer-de-proyecto.mjs comprobar --nombre <repo> --slug <slug>` falla si quedó un nombre del proyecto.
- **Lecciones:** una viñeta nueva del `docs/LECCIONES.md` del proyecto que termina en `(kit)` (con sus líneas de continuación, si sigue
  en líneas sangradas) va al `docs/LECCIONES.md` del kit, en su sección; una en `(semilla)`, a `docs/semillas/LECCIONES.md` › «Sugerencias de los proyectos». Las dos con `(<repo>, PR #<n>)` en
  lugar del sufijo.

### Lo que no hace

- `package.json` no es flujo: una mejora del kit que pide una dependencia nueva traba la tarea (las sesiones no pueden sumar
  dependencias).
- Sin bucles: el aviso al kit se salta la rama `chore/flujo-del-kit-*`, y el kit (`.kit/plantilla`) no hace ninguno de los dos sentidos.
- Se prueba en `scripts/kit/mezcla.test.ts` (la tabla), `actualizar.test.ts` (tres repos de juguete: sin choque, con choque y con
  `.kit/omitir`), `scripts/orquestador/kit-semanal.test.ts` y `kit-aviso.test.ts` (con el `gh` falso, que sirve el kit de juguete
  desde un repo local: `prueba/gh-falso-git.mjs`) y, en el kit, `traer-de-proyecto.test.ts`.

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
- **El cierre de la construcción contra GitHub real:** la etiqueta de `al_integrar` está probada con el `gh` falso
  (`scripts/orquestador/al-integrar.test.ts`) y `cierre.mjs`, con el ensayo sobre el ejemplo; la primera etiqueta y la primera sesión
  de cierre reales llegan con el último paso del primer proyecto.
- **El flujo entre el kit y los proyectos contra GitHub real:** el tarball y el `compare` del kit, el primer issue en el kit con el
  token de su dueño y la primera mezcla de un proyecto real están probados con el `gh` falso y repos de juguete; corren de verdad con la
  primera tarea semanal y el primer PR de flujo de un proyecto.
- **La tarea de dependencias en una sesión `auto` real:** el hook con `ORQ_PERMITE` está probado (`bloquear-peligrosos.test.ts`); que el
  clasificador del modo `auto` deje correr la actualización, todavía no.
