# Orquestador

Corre solo, durante días, una cola de tareas de este proyecto. Por cada tarea abre un worktree con su propio carril (Supabase en
Docker), lanza una sesión nueva de `claude -p` que implementa, verifica y abre el PR con auto-merge, vigila el CI, manda a arreglar si
cae, y sigue con la siguiente cuando se integra. Avisa al celular por ntfy.

**La cola vive en los issues** del repo con la etiqueta `cola` (el issue 57 es la tarea `T57`): desde el celular se ve todo, se cargan
tareas y se responde a una trabada comentando. `.orquestador/cola/` es la copia de trabajo, en espejo en cada vuelta (abajo, «La cola
en los issues»). Con `ORQ_SOLO_LOCAL=1` en `.orquestador/config.local.env` la cola es sólo local, como antes.

**Cuatro cosas entran solas a la cola:** un pedido en texto libre (un issue con la etiqueta `pedido`, que una sesión en modo plan
redacta como spec), la tarea mensual de dependencias, el e2e de la noche que cae dos noches seguidas y la tarea semanal de traer el
flujo del kit (abajo, «Lo que entra solo a la cola»). Y al integrar un PR que toca el flujo, el orquestador abre su tarea en el kit
(«Al integrar» › «Lo que sube al kit»).

**Uno por proyecto, con turnos por máquina.** El código vive en el repo (`scripts/orquestador/`) y lo de esta máquina en
`.orquestador/` (ignorada por git). Su cola, su estado, su lock y su servicio (`orquestador-<PROYECTO>`) son propios. Lo que comparten
los orquestadores de una máquina está en `~/.config/orquestador/maquina.env` y `~/.local/state/orquestador/`: los **turnos de sesión**
(`TURNOS_MAQUINA`, 3 si no se dice: cuántas sesiones de `claude` a la vez entre todos los proyectos, porque la RAM es de la máquina y el
límite del plan, de la cuenta) y la pausa por el límite del plan. `PARALELO` sigue siendo el tope propio de cada proyecto.

Nunca toca el árbol de trabajo de la principal: crea sus worktrees en `.orquestador/worktrees/` y los borra al integrar.

## Qué hay

| Dónde                                    | Qué es                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/orquestador/orquestador.sh`     | El bucle y los comandos (abajo)                                                                                                                                                                                                                                                            |
| `scripts/orquestador/al-dia.sh`          | Ponerse al día solo: la principal en main, sin cambios y detrás de `origin/main` avanza con `--ff-only`                                                                                                                                                                                    |
| `scripts/orquestador/github.sh`          | Lo que le pide a GitHub: etiquetas, comentarios, editar y cerrar issues, dependencias por rama                                                                                                                                                                                             |
| `scripts/orquestador/cola-github.sh`     | El espejo entre la cola local y los issues; respuestas a trabadas; issues cerrados a mano                                                                                                                                                                                                  |
| `scripts/orquestador/al-integrar.sh`     | Lo que una tarea pide hacer al integrarse (`al_integrar: etiquetar <nombre>`): crear la etiqueta, sin pisar una que ya exista, y reintentar si GitHub falla                                                                                                                                |
| `scripts/orquestador/kit.sh`             | El flujo entre el kit y este proyecto: la tarea semanal de traer el flujo del kit y, al integrar un PR que toca flujo, su tarea en el kit                                                                                                                                                  |
| `scripts/orquestador/cola-entrada.sh`    | La entrada (`.orquestador/entrada/`), la tarea mensual de dependencias y la adopción de las tareas locales de antes                                                                                                                                                                        |
| `scripts/orquestador/pedidos.sh`         | Un pedido en texto libre (`pedido`): lanzar su redacción y la sesión en modo plan; lo que hace con su `SPEC:` o sus `PREGUNTAS:`, en `pedidos-salida.sh`                                                                                                                                   |
| `scripts/orquestador/redaccion.mjs`      | Lo puro de la redacción: el hilo del issue (rondas, respuesta, conversación) y la salida de la sesión                                                                                                                                                                                      |
| `scripts/orquestador/maquina.sh`         | Lo que comparten los orquestadores de la máquina: `maquina.env`, los turnos de sesión y la pausa por el límite del plan                                                                                                                                                                    |
| `scripts/orquestador/niveles.sh`         | Los niveles de modelo: nivel → alias, qué campos de una spec valen, qué modelo es hoy cada alias                                                                                                                                                                                           |
| `scripts/orquestador/spec-issue.mjs`     | Una spec entre archivo e issue, en los dos sentidos (con su forma canónica para comparar)                                                                                                                                                                                                  |
| `scripts/orquestador/config.env`         | `PROYECTO` (vacío: el del manifiesto), `KIT_GITHUB`, paralelo, niveles de modelo, límites y lo que entra solo (`DEPS_MENSUAL`, `KIT_SEMANAL`, `KIT_AVISAR`, `NIVEL_REDACTAR`, `EFFORT_REDACTAR`, `TIEMPO_MAX_REDACCION`). Sin secretos                                                     |
| `scripts/orquestador/prompts/`           | Lo que recibe cada sesión: `tarea.md`, `planificar.md`, `arreglar.md`, `retomar.md`, `redactar.md`; y lo que se le suma: `cierra-issue.md`, `permite-dependencias.md`                                                                                                                      |
| `scripts/orquestador/plantilla-tarea.md` | La forma de una spec (la copia `nueva`)                                                                                                                                                                                                                                                    |
| `scripts/orquestador/plantillas/`        | Las specs que nacen de una plantilla: `dependencias.md` (la tarea mensual), `traer-flujo-del-kit.md` (la semanal del kit) y `traer-de-proyecto.md` (la tarea que abre en el kit), que crea el orquestador; y `cerrar-construccion.md`, el cierre de un repo nuevo (lo crea semilla-a-repo) |
| `scripts/orquestador/prueba/`            | El `gh` y el `claude` falsos, y los escenarios de las pruebas: la cola en los issues y varios orquestadores en una máquina. `gh-falso-git.mjs` sirve repos de git locales como si fueran de GitHub (el kit de juguete)                                                                     |
| `.orquestador/config.local.env`          | Lo de tu máquina, pisa a `config.env`: `NTFY_TEMA`, `PARALELO`, `PATH_EXTRA`, `ORQ_SOLO_LOCAL`                                                                                                                                                                                             |
| `~/.config/orquestador/maquina.env`      | De la máquina, para todos sus orquestadores: `TURNOS_MAQUINA` (lo crea `verificar`) y, para el resumen diario de `proyecto.sh`, `NTFY_TEMA` y `NTFY_SERVIDOR` (opcional)                                                                                                                   |
| `~/.local/state/orquestador/`            | De la máquina: los candados de los turnos (`turno-<k>.lock`; quién lo tiene, en `turno-<k>.quien`) y la pausa por el límite del plan (`pausa-hasta`)                                                                                                                                       |
| `.orquestador/entrada/`                  | Specs nuevas sin id (`<tema>.md`) y respuestas (`respuesta-T<n>.md`): se publican solas                                                                                                                                                                                                    |
| `.orquestador/cola/T*.md`                | La copia de trabajo de la cola: una tarea por archivo, frontmatter + la spec                                                                                                                                                                                                               |
| `.orquestador/estado/`                   | Lo crea él: el estado de cada tarea, los logs, los prompts y lo que dijo cada sesión                                                                                                                                                                                                       |
| `.orquestador/worktrees/`                | Lo crea él: un worktree por tarea en curso                                                                                                                                                                                                                                                 |

## Una tarea

```bash
bash scripts/orquestador/orquestador.sh nueva avisos-con-acciones   # crea el issue (p. ej. #57) y .orquestador/cola/T57-avisos-con-acciones.md
```

Nace en borrador (la etiqueta `cola:borrador`; en el archivo, `borrador: si`) y el orquestador no la lanza hasta que la quites. Se
escribe en el issue o en el archivo: lo que cambie en uno pasa al otro en la vuelta siguiente. También se carga una tarea creando un
issue con la etiqueta `cola` desde el celular, o dejando su spec (sin `id`) en `.orquestador/entrada/<tema>.md`.

Los campos: `titulo` y `rama` (única entre las vivas); `depende` (separadas por espacio: `T<n>`, una tarea de esta cola, o
`<repo>:<rama>`, un PR de esa rama integrado en ese repo; abajo); `conflicto` (llaves de área: dos tareas con una llave en común no
corren a la vez); `planificar: si` para que una sesión del nivel capaz en modo plan escriba el plan antes; `nivel` y `effort` (y
`nivel_plan`, `effort_plan`) si no valen los de `config.env`; `permite: dependencias` para que la sesión pueda correr `pnpm update`
y `pnpm dedupe` (abajo, «La tarea mensual de dependencias»; otra palabra deja la spec rota); `al_integrar: etiquetar <nombre>` para
que el orquestador cree esa etiqueta al integrarse la tarea (abajo, «Al integrar»; otra acción deja la spec rota). Un `id` que no es `T<n>` (las specs de
`../tareas` traen `id: K06`) queda como `origen: K06`: el id es siempre el número del issue. `paso: P07` (o `paso: cierre`) lo escribe
semilla-a-repo en los issues que salen del plan de la semilla, para no duplicarlos al volver a correr; el orquestador no lo usa.

**Niveles de modelo.** Una tarea nombra un nivel, `rapido`, `normal` o `capaz`, nunca un modelo: `config.env` dice qué alias es cada
uno (`NIVEL_RAPIDO="haiku"`, `NIVEL_NORMAL="sonnet"`, `NIVEL_CAPAZ="opus"`) y `verificar` pregunta qué modelo es hoy cada alias. Sin
`nivel`, la sesión usa `NIVEL_EJECUTAR` (y el plan, `NIVEL_PLANIFICAR`). Un `modelo:` con un alias (`sonnet`, `opus[1m]`) se respeta,
por compatibilidad, pero `nivel` le gana. Una versión fija en `modelo:` (o un nivel que no existe) es un error de la spec: el issue
queda en `cola:borrador` con un comentario que dice qué poner; en la entrada, en `<tema>.md.error`; sólo local, `plan` dice
`spec con error`; y una tarea que ya corría queda trabada con el mismo motivo.

## La cola en los issues

**El cuerpo del issue** es un bloque ` ```yaml ` con los campos (sin `id`) y después las secciones de la spec; el archivo local lleva
el frontmatter `---` de siempre. `spec-issue.mjs` convierte en los dos sentidos. El título del issue es `titulo`.

````
```yaml
titulo: repartir el límite entre orquestadores y rutear por nivel de modelo
rama: feat/turnos-y-niveles
depende: kit:feat/cola-en-issues
conflicto: orquestador
planificar: si
origen: K06
```

## Pedido de la persona
…
````

**Etiquetas.** Las crea `verificar` (y el bucle, si faltan). Cada cambio de estado deja una sola de estado; `cola` y `cola:urgente`
(va primero al lanzar) van aparte.

| Estado de la tarea     | Etiqueta                                                                     |
| ---------------------- | ---------------------------------------------------------------------------- |
| pendiente              | ninguna; `cola:borrador` si es borrador, su yaml está roto o repite una rama |
| corriendo, por retomar | `cola:corriendo`                                                             |
| esperando al CI        | `cola:esperando-ci`                                                          |
| por arreglar           | `cola:por-arreglar`                                                          |
| trabada                | `cola:trabada`                                                               |
| integrada              | `cola:integrada` (y el issue se cierra)                                      |
| omitida                | `cola:omitida` (y el issue se cierra como «not planned»)                     |

Las de lo que entra solo a la cola no son de estado, y el espejo no las toca:

| Etiqueta        | Qué es                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------- |
| `pedido`        | Un pedido en texto libre: una sesión lo redacta como spec (sin `cola` todavía)              |
| `cola:pregunta` | La redacción del pedido necesita tus respuestas: comenta en el issue                        |
| `deps`          | La tarea mensual de dependencias                                                            |
| `noche-roja`    | El e2e de la noche cayó (`scripts/flujo/noche.mjs`); a la segunda noche seguida, en la cola |

**El espejo, en cada vuelta** (o ya, con `espejo`):

- La entrada: cada `entrada/<tema>.md` se vuelve un issue, pasa a la cola como `T<n>` y se borra; una spec rota queda con su motivo
  en `<tema>.md.error`. `entrada/respuesta-T<n>.md` se publica como comentario en el issue `<n>`.
- Issues abiertos con `cola` → archivo nuevo o actualizado. Si cambió el archivo y no el issue, el archivo sube al issue; si
  cambiaron los dos, manda el issue (la copia del archivo queda en `estado/<ID>/`). Un issue editado mientras su tarea corre no
  toca la sesión en curso: se toma en la siguiente retoma y se avisa con un comentario.
- Un issue con el bloque yaml roto, o con la rama de otra tarea viva, queda en `cola:borrador` con un comentario que dice qué arreglar.
- Adopción: una tarea local sin issue (de antes) se publica como issue y toma su número (su archivo, su estado y los `depende` que
  la nombran pasan a `T<n>`). Sólo las pendientes: las que ya empezaron terminan como locales.
- Un issue cerrado a mano sin `cola:integrada` → la tarea queda omitida (si su PR ya se integró, integrada).
- Sin red o con el límite de la API, el espejo se salta y la cola local sigue; la vuelta siguiente lo reintenta. Nada local se pierde.

**Comentarios.** El orquestador comenta en el issue, siempre empezando con `🤖 orquestador:`, al lanzar, al abrir el PR (con el
enlace), al trabarse (el motivo y «responde en un comentario»), al integrarse y, si la spec lo pide, al etiquetar. Los avisos de ntfy llevan el enlace del issue.

**Una trabada se responde comentando.** El primer comentario posterior al de la trabada que no empieza con `🤖 orquestador:` es tu
respuesta: se guarda en `estado/<ID>/respuesta.md`, se suma al cuerpo del issue en «Decisiones ya tomadas» como
`- Respuesta de la persona (AAAA-MM-DD): …`, se quita `cola:trabada` y la tarea se retoma con la respuesta en su prompt.

**El PR cierra el issue:** la sesión pone `Closes #<n>` en su cuerpo; al integrarse, el orquestador pone `cola:integrada` y cierra el
issue si GitHub no lo hizo.

**Issues que abre un workflow.** El autor de un issue tiene que poder escribir en el repo, o ser `github-actions[bot]` en un issue
`noche-roja`: ése lo abre el CI con `GITHUB_TOKEN` (un fork no tiene ese token con escritura). Otro issue de un bot no entra, y
ningún comentario de un bot cuenta como respuesta. Una spec redactada desde un pedido no puede traer `permite` ni `al_integrar`: un
permiso o una escritura en el repo los da la persona.

**Dependencias por rama.** `<repo>:<rama>` está lista cuando hay un PR de esa rama integrado en ese repo: `kit` es `KIT_GITHUB`, el
nombre de este repo es este, y otro nombre, el `github` que le da el manifiesto (`.proyecto/proyecto.yaml`). Se consulta con el token
de la cuenta de ese repo (`gh auth token --user <cuenta>`). Si la rama es de una tarea de esta misma cola, manda su estado (una omitida
también libera). Sin token o sin red, espera, y `plan` dice por qué.

## Lo que entra solo a la cola

### Un pedido desde el celular

Un issue con la etiqueta `pedido` (sin `cola`), en texto libre: «quiero que…». Si lo abrió alguien con permiso de escritura, el bucle
lanza su **redacción**: una sesión de `claude -p` en modo plan (sólo lee; el nivel `NIVEL_REDACTAR`, capaz) sobre una copia de `main`
(un worktree desprendido en `.orquestador/worktrees/P<n>`, que se borra al terminar). Lee el repo y la cola viva, y termina en una de dos:

- `SPEC:` — el orquestador valida la spec (`spec-issue.mjs`), reemplaza con ella el cuerpo y el título del issue, cambia `pedido` por
  `cola` y comenta; el espejo siguiente la vuelve `T<n>`. El pedido original queda en `.orquestador/estado/P<n>/pedido-original.md`. Si
  quieres revisarla antes de que se lance, ponle `cola:borrador`.
- `PREGUNTAS:` — un comentario con las preguntas numeradas (con su propuesta) y la etiqueta `cola:pregunta`. **Tu comentario de
  respuesta** vuelve a lanzar la redacción con todo lo hablado. Máximo dos rondas: en la tercera la sesión decide lo conservador, y si
  aun así pregunta, el pedido queda en `cola:trabada` con las preguntas.

Una salida que no es ni lo uno ni lo otro, o una spec que no se lee, también lo deja en `cola:trabada` con el motivo: escribes tú la
spec en el cuerpo y cambias `pedido` por `cola`, o cierras el issue. Si el pedido toca otro repo, la redacción lo dice en sus preguntas
y propone la spec de cada uno: no crea nada en otro repo. Las rondas las cuenta el hilo del issue (una marca oculta en cada comentario
de preguntas): sobrevive a un reinicio. Sólo cuentan el autor y las respuestas de quien puede escribir en el repo, nunca un bot. Una
sesión que se cae o se pasa de `TIEMPO_MAX_REDACCION` se reintenta a los 5 minutos; a la tercera, trabado. El límite del plan pausa
sin gastar nada.

### La tarea mensual de dependencias

Una vez al mes (UTC), si no hay un issue `deps` creado ese mes ni uno abierto de antes, el espejo crea la tarea desde
`plantillas/dependencias.md` con `cola` y `deps` (`DEPS_MENSUAL="no"` la apaga). Lleva `permite: dependencias`: sus sesiones corren con
`ORQ_PERMITE=dependencias` y el hook de Bash (`.claude/hooks/bloquear-peligrosos.sh`) les deja correr `pnpm update` dentro de los rangos
de `package.json` (sin `--latest`, `-g`, `-i` ni una versión) y `pnpm dedupe`; `pnpm add`, `pnpm remove` y `--latest` siguen
bloqueados. Cada versión mayor disponible queda como una línea en `docs/PENDIENTES.md` › «Decisión de la persona», sin instalarla. Un
mes sin nada que actualizar, la tarea termina trabada con «nada que actualizar este mes» y la cierras tú.

### La noche roja

El job `aviso-noche` de `.github/workflows/ci.yml` corre después del e2e completo de cada noche (`scripts/flujo/noche.mjs`, sin la
máquina). En rojo abre el issue `noche-roja` («e2e de la noche en rojo») o le suma la noche, con el enlace de la corrida y los specs
caídos (`caidos.txt` de los artefactos; si no hay, los jobs caídos), y la cuenta de noches seguidas en `<!-- noches: N -->`. **A la
segunda noche seguida** reescribe el cuerpo como spec (dejar verdes esos specs) y le pone `cola` y `cola:urgente`: el orquestador la
toma primero. En verde, cierra el que todavía no está en la cola. Con dos `noche-roja` abiertos manda el más viejo.

### La tarea semanal del flujo del kit

Una vez por semana (UTC, semana ISO), si no hay un issue `kit` abierto, el espejo corre `node scripts/kit/actualizar.mjs --revisar`:
si `.kit/version` quedó atrás del main del kit (`KIT_GITHUB`) en algún archivo de flujo, crea la tarea desde
`plantillas/traer-flujo-del-kit.md` con `cola` y `kit` (`KIT_SEMANAL="no"` la apaga). Un kit que sólo avanzó fuera del flujo no abre
nada. La tarea corre `actualizar.mjs`, que mezcla el kit y commitea; si choca, no toca nada y la tarea se traba con las rutas: se
responde por ruta (`--tomar-kit`, `--dejar` o una línea en `.kit/omitir`; `docs/KIT.md` › «El flujo entre el kit y los proyectos»).
Si el kit no responde (sin red, sin acceso), se dice en el log y se vuelve a mirar a las 6 horas, sin aviso. La semana resuelta queda en
`estado/.kit-semana`. El kit mismo no la hace.

## Al integrar

Una spec con `al_integrar: etiquetar <nombre>` (hoy la única acción; el nombre, letras, números y `._-` entre ellos, hasta 100) le
pide al orquestador crear esa etiqueta cuando la tarea se integra (`al-integrar.sh`). La usa el cierre de la construcción
(`plantillas/cerrar-construccion.md`, `etiquetar semilla-v<N>`).

- **Sobre qué commit:** el padre del commit integrado (`parents[0]` del squash), o sea main justo antes del PR. El PR del cierre saca
  `docs/semilla/`, y la etiqueta tiene que conservarla (`git show semilla-vN:docs/semilla/semilla.md`). Para etiquetar el squash
  mismo, se cambia una línea de `etiquetar_integrada`.
- **Se repite sin riesgo:** si la etiqueta ya está en ese commit, queda hecha sin aviso. **No pisa** una que existe en otro commit (o
  una anotada): queda `ya-existia`, con aviso high y un comentario en el issue que dice dónde está y dónde tocaba.
- **Si GitHub falla:** queda pendiente (se marca antes de dar la tarea por integrada: un reinicio no la pierde) y el espejo la
  reintenta, una vez cada 5 minutos como mucho; a los 5 fallos queda `fallida`, con aviso high, comentario y el `gh api -X POST …`
  para hacerla a mano. El límite de la API no cuenta como fallo. Sin cola en los issues no hay espejo: el primer fallo ya avisa.
- El estado, en `estado/<ID>/al_integrar` (`pendiente`, `hecha`, `ya-existia` o `fallida`) y `al_integrar.md` (lo último que pasó).
  `plan` lo muestra al lado de la tarea: `integrado · falta al integrar: etiquetar semilla-v1`.

### Lo que sube al kit

Al integrar una tarea con PR, el orquestador lee sus archivos (`pulls/<n>/files`) y, si toca una ruta de `scripts/kit/flujo.txt` o suma
a `docs/LECCIONES.md` una línea que termina en `(kit)` o `(semilla)`, crea en el kit un issue `cola` «traer de <repo> el PR #<n>»
desde `plantillas/traer-de-proyecto.md`, con el token de la cuenta dueña del kit (`gh auth token --user`, sólo para esa llamada).
`docs/LECCIONES.md` cuenta sólo por esas líneas. La tarea del kit la hace la skill `traer-de-proyecto` del kit (`KIT_AVISAR="no"` lo
apaga).

- **Lo que no avisa:** un PR que no toca flujo (`aviso_kit=nada`, sin ninguna llamada al kit), la tarea que trae el flujo del kit (rama
  `chore/flujo-del-kit-*`: lo que trae ya es del kit) y el kit mismo.
- **Si falla** (GitHub, o sin sesión de gh del dueño del kit): como «Al integrar», queda pendiente, el espejo lo reintenta cada
  5 minutos y a los 5 fallos queda `fallido`, con aviso high y el `gh api -X POST …` para hacerlo a mano. El límite de la API no cuenta.
- El estado, en `estado/<ID>/aviso_kit` (`pendiente`, `hecho`, `nada` o `fallido`), `aviso_kit_issue` (el enlace, que también va en un
  comentario del issue) y `aviso_kit.md`. `plan` muestra `integrado · falta llevar al kit` o `· no se pudo llevar al kit`.

## Arrancar

1. `bash scripts/orquestador/orquestador.sh verificar`: herramientas (y el paquete de cada una que falte), `maquina.env` (lo crea) y
   los turnos de la máquina, el modelo de cada nivel, la cuenta de GitHub dueña del repo, auto-merge, las etiquetas de
   la cola (las crea), Docker, RAM, que `claude -p` responda, la cola, el estado del repo (`scripts/flujo/estado.sh`) y un aviso de
   prueba.
   - Avisos: `echo "NTFY_TEMA=\"cambiar-slug-app-$(openssl rand -hex 8)\"" >> .orquestador/config.local.env` y suscríbete en la app ntfy.
   - Si `claude -p` no responde en `auto`: `MODO_EJECUTAR="acceptEdits"` en `config.local.env`.
2. En primer plano para ver la primera ola: `tmux new -s orquestador-cambiar-slug-app 'bash scripts/orquestador/orquestador.sh'`.
3. Como servicio (sobrevive a reinicios): `bash scripts/orquestador/orquestador.sh instalar`, y una vez por máquina
   `loginctl enable-linger "$USER"`. Su log: `journalctl --user -u orquestador-cambiar-slug-app -f`. Quitarlo: `… desinstalar`.

Si el servicio no encuentra `claude`, `pnpm` o `node`, agrega sus rutas a `PATH_EXTRA` (`which claude pnpm node`) y vuelve a `instalar`.

## Comandos (`bash scripts/orquestador/orquestador.sh …`)

| Comando               | Qué hace                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `estado`              | La tabla: estado, PR y retomas/arreglos de cada tarea                                                            |
| `plan`                | Turnos libres de la máquina; qué lanzaría ahora y qué espera cada una (dependencia, área, turno, spec con error) |
| `nueva <tema>`        | Una spec en borrador, publicada ya como issue                                                                    |
| `entrada`             | Publica ya lo de `.orquestador/entrada/`                                                                         |
| `espejo`              | Una vuelta del espejo con los issues, ahora                                                                      |
| `ver T05`             | Sigue en vivo lo que dice y hace la sesión de T05                                                                |
| `prompt T05`          | Lo que recibiría ahora la sesión de T05 (no lanza nada)                                                          |
| `pausar` / `reanudar` | No lanza nuevas (las que corren terminan) / vuelve a lanzar, y quita la pausa compartida por el límite del plan  |
| `parar T05`           | Corta la sesión de T05 ahora; queda para retomar                                                                 |
| `reintentar T05`      | Vuelve a poner en marcha una trabada (retoma desde su rama)                                                      |
| `omitir T05`          | La da por hecha sin hacerla (sus dependientes siguen)                                                            |

## Cómo decide

- **Lanza** una tarea cuando sus `depende` están integradas, ninguna en curso comparte su `conflicto`, hay carril libre y hay turno en
  la máquina. Primero termina lo empezado (arreglos y retomas), después lo nuevo: las `cola:urgente` y luego por número.
- **Redacta** un pedido después de lanzar las tareas: una redacción a la vez por proyecto, con turno de la máquina pero sin carril ni
  lugar en `PARALELO`. `plan` dice en qué está cada pedido (`P<n>  pedido: …`).
- **Turnos de la máquina**: antes de preparar el worktree, el hijo toma un turno (`flock -n` sobre
  `~/.local/state/orquestador/turno-<k>.lock`) y lo sostiene hasta salir; si muere, el kernel lo suelta. Lo que lanza (la sesión,
  `preparar.sh`) no lo hereda: un proceso que quede vivo no lo retiene. Sin turno libre no lanza, `plan` dice «sin turno en la
  máquina» y quién los ocupa, y el hijo que llegó tarde vuelve a su estado sin gastar intentos. Un `TURNOS_MAQUINA` inválido usa 3 y
  avisa una vez.
- **Se pone al día solo**: al empezar cada vuelta, si la principal está en `main`, sin cambios y detrás de `origin/main`, hace
  `git merge --ff-only origin/main` (nunca empuja). Si eso cambió `scripts/orquestador/`, se relanza con `exec` antes de lanzar nada
  (mismo PID y mismo candado: las sesiones en curso siguen). En otra rama, con cambios o con commits que `origin/main` no tiene, no la
  toca: lo dice una vez en el log y `plan` lo muestra en una línea. Sin red, lo reintenta en la vuelta siguiente.
- **Publica** con `publicar.sh --sin-esperar`: el PR queda con auto-merge y el carril se suelta mientras corre el CI.
- **Vigila** el PR cada minuto: integrado → borra worktree y rama. CI rojo o choque con main → una sesión de arreglo con el log del job
  caído (desde el 3.er intento, con el nivel `NIVEL_ARREGLAR_DIFICIL`). Rama atrasada → la pone al día (merge, nunca fuerza).
- **Límite del plan** de Claude: es de la cuenta, así que la pausa es de la máquina. El orquestador que lo detecta escribe la hora de
  fin (ahora + `PAUSA_POR_LIMITE_MIN`) en `~/.local/state/orquestador/pausa-hasta`, y ninguno de la máquina lanza hasta entonces (el
  hijo la vuelve a mirar al tomar su turno). Dos que llegan a la vez dejan la más tardía. La tarea cortada se retoma sin gastar
  intentos. Una hora vencida o ilegible se ignora y se borra; `reanudar` la quita para todos.
- **Trabada**: tras `MAX_RETOMAS` sesiones sin publicar, `MAX_ARREGLOS` arreglos fallidos, o cuando la sesión dice que no puede (falta
  una decisión tuya, una dependencia nueva, un fallo ajeno). Comenta el motivo en el issue y avisa, suelta el carril, deja el worktree
  para que mires y sigue con lo que no depende de ella. Tu comentario en el issue la retoma.
- Cada PR corre el CI completo: con varias a la vez, mira los minutos de Actions. Cada carril con Supabase y un e2e ronda 3–4 GB de RAM.
