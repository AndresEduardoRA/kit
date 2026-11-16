# Orquestador

Corre solo, durante días, una cola de tareas de este proyecto. Por cada tarea abre un worktree con su propio carril (Supabase en
Docker), lanza una sesión nueva de `claude -p` que implementa, verifica y abre el PR con auto-merge, vigila el CI, manda a arreglar si
cae, y sigue con la siguiente cuando se integra. Avisa al celular por ntfy.

**Uno por proyecto.** El código vive en el repo (`scripts/orquestador/`) y lo de esta máquina en `.orquestador/` (ignorada por git). Su
cola, su estado, su lock y su servicio (`orquestador-<PROYECTO>`) son propios: el orquestador de otro proyecto corre a la vez sin
enterarse. Lo único que comparten es la máquina (RAM, Docker) y la cuenta de Claude (el límite del plan): con dos proyectos a la vez,
`PARALELO=2` en cada uno.

Nunca toca el árbol de trabajo de la principal: crea sus worktrees en `.orquestador/worktrees/` y los borra al integrar.

## Qué hay

| Dónde                                    | Qué es                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| `scripts/orquestador/orquestador.sh`     | El bucle y los comandos (abajo)                                                               |
| `scripts/orquestador/config.env`         | `PROYECTO` (vacío: el del manifiesto), paralelo, modelos y límites. Se versiona: sin secretos |
| `scripts/orquestador/prompts/`           | Lo que recibe cada sesión: `tarea.md`, `planificar.md`, `arreglar.md`, `retomar.md`           |
| `scripts/orquestador/plantilla-tarea.md` | La forma de una spec (la copia `nueva`)                                                       |
| `.orquestador/config.local.env`          | Lo de tu máquina, pisa a `config.env`: `NTFY_TEMA`, `PARALELO`, `PATH_EXTRA`                  |
| `.orquestador/cola/T*.md`                | Una tarea por archivo: frontmatter + la spec con tus decisiones                               |
| `.orquestador/estado/`                   | Lo crea él: el estado de cada tarea, los logs, los prompts y lo que dijo cada sesión          |
| `.orquestador/worktrees/`                | Lo crea él: un worktree por tarea en curso                                                    |

## Una tarea

```bash
bash scripts/orquestador/orquestador.sh nueva T01 avisos-con-acciones   # crea .orquestador/cola/T01-avisos-con-acciones.md
```

Nace con `borrador: si` y el orquestador no la lanza hasta que borres esa línea. El frontmatter: `id` y `rama` únicos; `depende` (ids
separados por espacio que deben estar integrados antes); `conflicto` (llaves de área: dos tareas con una llave en común no corren a la
vez); `planificar: si` para que una sesión de Opus en modo plan escriba el plan antes; `modelo` y `effort` (y `modelo_plan`,
`effort_plan`) si no valen los de `config.env`.

## Arrancar

1. `bash scripts/orquestador/orquestador.sh verificar`: herramientas, la cuenta de GitHub dueña del repo, auto-merge, Docker, RAM, que
   `claude -p` responda, la cola, el estado del repo (`scripts/flujo/estado.sh`) y un aviso de prueba.
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
| `ver T05`             | Sigue en vivo lo que dice y hace la sesión de T05                     |
| `pausar` / `reanudar` | No lanza nuevas (las que corren terminan) / vuelve a lanzar           |
| `parar T05`           | Corta la sesión de T05 ahora; queda para retomar                      |
| `reintentar T05`      | Vuelve a poner en marcha una trabada (retoma desde su rama)           |
| `omitir T05`          | La da por hecha sin hacerla (sus dependientes siguen)                 |

## Cómo decide

- **Lanza** una tarea cuando sus `depende` están integradas, ninguna en curso comparte su `conflicto` y hay carril libre. Primero
  termina lo empezado (arreglos y retomas), después lo nuevo en orden.
- **Publica** con `publicar.sh --sin-esperar`: el PR queda con auto-merge y el carril se suelta mientras corre el CI.
- **Vigila** el PR cada minuto: integrado → borra worktree y rama. CI rojo o choque con main → una sesión de arreglo con el log del job
  caído (desde el 3.er intento, con `MODELO_ARREGLAR_DIFICIL`). Rama atrasada → la pone al día (merge, nunca fuerza).
- **Límite del plan** de Claude: pausa `PAUSA_POR_LIMITE_MIN` minutos y retoma, sin gastar intentos.
- **Trabada**: tras `MAX_RETOMAS` sesiones sin publicar, `MAX_ARREGLOS` arreglos fallidos, o cuando la sesión dice que no puede (falta
  una decisión tuya, una dependencia nueva, un fallo ajeno). Avisa con el motivo, suelta el carril, deja el worktree para que mires y
  sigue con lo que no depende de ella.
- Cada PR corre el CI completo: con varias a la vez, mira los minutos de Actions. Cada carril con Supabase y un e2e ronda 3–4 GB de RAM.
