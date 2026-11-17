# Orquestador

Corre solo, durante días, una cola de tareas de este proyecto. Por cada tarea abre un worktree con su propio carril (Supabase en
Docker), lanza una sesión nueva de `claude -p` que implementa, verifica y abre el PR con auto-merge, vigila el CI, manda a arreglar si
cae, y sigue con la siguiente cuando se integra. Avisa al celular por ntfy.

**La cola vive en los issues** del repo con la etiqueta `cola` (el issue 57 es la tarea `T57`): desde el celular se ve todo, se cargan
tareas y se responde a una trabada comentando. `.orquestador/cola/` es la copia de trabajo, en espejo en cada vuelta (abajo, «La cola
en los issues»). Con `ORQ_SOLO_LOCAL=1` en `.orquestador/config.local.env` la cola es sólo local, como antes.

**Uno por proyecto.** El código vive en el repo (`scripts/orquestador/`) y lo de esta máquina en `.orquestador/` (ignorada por git). Su
cola, su estado, su lock y su servicio (`orquestador-<PROYECTO>`) son propios: el orquestador de otro proyecto corre a la vez sin
enterarse. Lo único que comparten es la máquina (RAM, Docker) y la cuenta de Claude (el límite del plan): con dos proyectos a la vez,
`PARALELO=2` en cada uno.

Nunca toca el árbol de trabajo de la principal: crea sus worktrees en `.orquestador/worktrees/` y los borra al integrar.

## Qué hay

| Dónde                                    | Qué es                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `scripts/orquestador/orquestador.sh`     | El bucle y los comandos (abajo)                                                                          |
| `scripts/orquestador/github.sh`          | Lo que le pide a GitHub: etiquetas, comentarios, editar y cerrar issues, dependencias por rama           |
| `scripts/orquestador/cola-github.sh`     | El espejo entre la cola local y los issues; respuestas a trabadas; issues cerrados a mano                |
| `scripts/orquestador/cola-entrada.sh`    | La entrada (`.orquestador/entrada/`) y la adopción de las tareas locales de antes                        |
| `scripts/orquestador/niveles.sh`         | Los niveles de modelo: nivel → alias, qué campos de una spec valen, qué modelo es hoy cada alias         |
| `scripts/orquestador/spec-issue.mjs`     | Una spec entre archivo e issue, en los dos sentidos (con su forma canónica para comparar)                |
| `scripts/orquestador/config.env`         | `PROYECTO` (vacío: el del manifiesto), `KIT_GITHUB`, paralelo, niveles de modelo y límites. Sin secretos |
| `scripts/orquestador/prompts/`           | Lo que recibe cada sesión: `tarea.md`, `planificar.md`, `arreglar.md`, `retomar.md`, `cierra-issue.md`   |
| `scripts/orquestador/plantilla-tarea.md` | La forma de una spec (la copia `nueva`)                                                                  |
| `scripts/orquestador/prueba/`            | El `gh` falso y el escenario de las pruebas de la cola en los issues                                     |
| `.orquestador/config.local.env`          | Lo de tu máquina, pisa a `config.env`: `NTFY_TEMA`, `PARALELO`, `PATH_EXTRA`, `ORQ_SOLO_LOCAL`           |
| `.orquestador/entrada/`                  | Specs nuevas sin id (`<tema>.md`) y respuestas (`respuesta-T<n>.md`): se publican solas                  |
| `.orquestador/cola/T*.md`                | La copia de trabajo de la cola: una tarea por archivo, frontmatter + la spec                             |
| `.orquestador/estado/`                   | Lo crea él: el estado de cada tarea, los logs, los prompts y lo que dijo cada sesión                     |
| `.orquestador/worktrees/`                | Lo crea él: un worktree por tarea en curso                                                               |

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
`nivel_plan`, `effort_plan`) si no valen los de `config.env`. Un `id` que no es `T<n>` (las specs de `../tareas` traen `id: K06`) queda
como `origen: K06`: el id es siempre el número del issue.

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
enlace), al trabarse (el motivo y «responde en un comentario») y al integrarse. Los avisos de ntfy llevan el enlace del issue.

**Una trabada se responde comentando.** El primer comentario posterior al de la trabada que no empieza con `🤖 orquestador:` es tu
respuesta: se guarda en `estado/<ID>/respuesta.md`, se suma al cuerpo del issue en «Decisiones ya tomadas» como
`- Respuesta de la persona (AAAA-MM-DD): …`, se quita `cola:trabada` y la tarea se retoma con la respuesta en su prompt.

**El PR cierra el issue:** la sesión pone `Closes #<n>` en su cuerpo; al integrarse, el orquestador pone `cola:integrada` y cierra el
issue si GitHub no lo hizo.

**Dependencias por rama.** `<repo>:<rama>` está lista cuando hay un PR de esa rama integrado en ese repo: `kit` es `KIT_GITHUB`, el
nombre de este repo es este, y otro nombre, el `github` que le da el manifiesto (`.proyecto/proyecto.yaml`). Se consulta con el token
de la cuenta de ese repo (`gh auth token --user <cuenta>`). Si la rama es de una tarea de esta misma cola, manda su estado (una omitida
también libera). Sin token o sin red, espera, y `plan` dice por qué.

## Arrancar

1. `bash scripts/orquestador/orquestador.sh verificar`: herramientas, la cuenta de GitHub dueña del repo, auto-merge, las etiquetas de
   la cola (las crea), Docker, RAM, que `claude -p` responda, la cola, el estado del repo (`scripts/flujo/estado.sh`) y un aviso de
   prueba.
   - Avisos: `echo "NTFY_TEMA=\"cambiar-slug-app-$(openssl rand -hex 8)\"" >> .orquestador/config.local.env` y suscríbete en la app ntfy.
   - Si `claude -p` no responde en `auto`: `MODO_EJECUTAR="acceptEdits"` en `config.local.env`.
2. En primer plano para ver la primera ola: `tmux new -s orquestador-cambiar-slug-app 'bash scripts/orquestador/orquestador.sh'`.
3. Como servicio (sobrevive a reinicios): `bash scripts/orquestador/orquestador.sh instalar`, y una vez por máquina
   `loginctl enable-linger "$USER"`. Su log: `journalctl --user -u orquestador-cambiar-slug-app -f`. Quitarlo: `… desinstalar`.

Si el servicio no encuentra `claude`, `pnpm` o `node`, agrega sus rutas a `PATH_EXTRA` (`which claude pnpm node`) y vuelve a `instalar`.

## Comandos (`bash scripts/orquestador/orquestador.sh …`)

| Comando               | Qué hace                                                              |
| --------------------- | --------------------------------------------------------------------- |
| `estado`              | La tabla: estado, PR y retomas/arreglos de cada tarea                 |
| `plan`                | Qué lanzaría ahora y qué espera cada una (dependencia o área ocupada) |
| `nueva <tema>`        | Una spec en borrador, publicada ya como issue                         |
| `entrada`             | Publica ya lo de `.orquestador/entrada/`                              |
| `espejo`              | Una vuelta del espejo con los issues, ahora                           |
| `ver T05`             | Sigue en vivo lo que dice y hace la sesión de T05                     |
| `prompt T05`          | Lo que recibiría ahora la sesión de T05 (no lanza nada)               |
| `pausar` / `reanudar` | No lanza nuevas (las que corren terminan) / vuelve a lanzar           |
| `parar T05`           | Corta la sesión de T05 ahora; queda para retomar                      |
| `reintentar T05`      | Vuelve a poner en marcha una trabada (retoma desde su rama)           |
| `omitir T05`          | La da por hecha sin hacerla (sus dependientes siguen)                 |

## Cómo decide

- **Lanza** una tarea cuando sus `depende` están integradas, ninguna en curso comparte su `conflicto` y hay carril libre. Primero
  termina lo empezado (arreglos y retomas), después lo nuevo: las `cola:urgente` y luego por número.
- **Publica** con `publicar.sh --sin-esperar`: el PR queda con auto-merge y el carril se suelta mientras corre el CI.
- **Vigila** el PR cada minuto: integrado → borra worktree y rama. CI rojo o choque con main → una sesión de arreglo con el log del job
  caído (desde el 3.er intento, con el nivel `NIVEL_ARREGLAR_DIFICIL`). Rama atrasada → la pone al día (merge, nunca fuerza).
- **Límite del plan** de Claude: pausa `PAUSA_POR_LIMITE_MIN` minutos y retoma, sin gastar intentos.
- **Trabada**: tras `MAX_RETOMAS` sesiones sin publicar, `MAX_ARREGLOS` arreglos fallidos, o cuando la sesión dice que no puede (falta
  una decisión tuya, una dependencia nueva, un fallo ajeno). Comenta el motivo en el issue y avisa, suelta el carril, deja el worktree
  para que mires y sigue con lo que no depende de ella. Tu comentario en el issue la retoma.
- Cada PR corre el CI completo: con varias a la vez, mira los minutos de Actions. Cada carril con Supabase y un e2e ronda 3–4 GB de RAM.
