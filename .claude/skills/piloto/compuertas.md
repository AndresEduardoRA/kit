# Las compuertas del piloto

Una compuerta es lo único que el piloto le pregunta a la persona (al celular, por una sesión corta). Quién la detecta decide cuándo se
pregunta; si la detectas tú (la sesión del paso), terminas con `resultado: compuerta` en `.piloto/ultimo.json`, **con la recomendación
primero**, y te retoman con `continuar`.

| Tipo          | Cuándo                                                                                                                                                                                                                                                                                                                                                                   | Quién la detecta                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `datos`       | El paso es `riesgo: rojo` o su `ruteo.modo` termina en manual: el bucle lo corre con `--hasta-plan` y el plan auditado espera aprobación. También si el plan de un paso no rojo toca policy, RLS, permisos, `security definer` o Vault                                                                                                                                   | el bucle (por el riesgo), el planificador y el auditor |
| `dependencia` | Hace falta un paquete nuevo o cambiar una versión (nunca fijar versiones sin verificarlas hoy)                                                                                                                                                                                                                                                                           | el planificador                                        |
| `producto`    | Una pregunta de producto o de UX abierta que la semilla no responde (un flujo, lo que ve un rol, un dato que se guarda)                                                                                                                                                                                                                                                  | el planificador, el auditor                            |
| `atasco`      | El auditor bloqueó el plan o el informe dos veces; o el mismo paso falla otra vez                                                                                                                                                                                                                                                                                        | la sesión del paso                                     |
| `afuera`      | Hace falta un cambio en las rutas de otro carril (di qué falta y de qué paso debería ser); o algo fuera del repo: una clave, un servicio, un proyecto de Supabase en la nube, un despliegue                                                                                                                                                                              | la sesión del paso                                     |
| `guardas`     | El rango toca las guardas (`scripts/piloto/`, `scripts/coordinador/`, `scripts/guardas/`, `scripts/worktree/`, `scripts/lib/`, `scripts/candado.sh`, `piloto.config`, `docs/semilla/`, `.claude/settings*.json`, `.claude/hooks/`, `.claude/agents/`, `.claude/skills/piloto*`, `lefthook.yml`, `.github/workflows/`, las líneas `db:*` y `test:e2e*` de `package.json`) | el bucle, antes de verificar                           |
| `parada`      | Un aviso: disco, rama, árbol sucio, CI rojo, copia alterada, verificación o publicación que falló, un paso que falló                                                                                                                                                                                                                                                     | el bucle                                               |

## Ámbar o roja

- Una `producto` en un paso cuyo riesgo **no** es `rojo` es **ámbar**: si nadie responde en `PILOTO_AUTO_MIN` minutos, el bucle elige la
  opción recomendada (la primera de cada pregunta) y lo dice en `hechos.json` › `autoelecciones`; tú la copias tal cual a
  `docs/pasos/<PASO>/decisiones.md`. Por eso **la recomendada tiene que ser segura de aceptar sin más**: reversible, sin datos ni permisos
  en juego. Si ninguna lo es, la recomendada es `parar — espera a la persona (recomendado)`, y el `motivo` dice por qué.
- **Solas (`PILOTO_AUTO` de `piloto.config`):** los tipos que liste se contestan al instante, sin la persona: `producto` con la
  recomendada de cada pregunta, `datos` y `guardas` con «aprobar» (el diff de guardas queda en `.piloto/guardas/<paso>.diff`). Llegan
  igual en `hechos.json` › `autoelecciones` y las copias igual. Por eso la recomendada va **siempre primero** y tiene que ser la que
  defenderías sin la persona, y el plan que llevas a una `datos` tiene que estar listo para ejecutarse tal cual.
- Todas las demás (y `parada`, `dependencia`, `afuera` y `atasco` siempre), y cualquiera de un paso `rojo` que no esté en `PILOTO_AUTO`,
  esperan a la persona. Nada más sigue sin respuesta.

## Cómo escribir la tuya

- `motivo`: una línea, el hecho (no la opinión). `pregunta`: lo que la persona va a leer en el celular, sin jerga: una frase.
- `opciones`: de 2 a 4, **la recomendada primero y con «(recomendado)» en su descripción**. Cada etiqueta empieza con la acción en una
  palabra (`aprobar`, `cambiar`, `parar`, `seguir`): el bucle entiende `aprobar` y `parar`; cualquier otra cosa se la pasa tal cual al paso
  en `hechos.json` › `decision`, junto con lo que la persona haya escrito en «Other».
- **`producto`: una pregunta por decisión** (`preguntas`, con el `Pn` del plan como `id`), nunca un «¿apruebo todo?». Medido en un
  proyecto anterior: nueve decisiones en una sola pregunta no se pudieron contestar desde el celular. Cada una con su texto corto y de 2 a 4
  opciones, la recomendada primero. Las demás compuertas llevan una sola `pregunta`.
- `contexto`: las rutas que ayudan a decidir (el plan `.piloto/planes/<paso>.md`, el informe, la sección de la semilla, un archivo
  concreto). La sesión de decidir sólo lee.
- **No pidas lo ya respondido:** si `hechos.json` › `decision` contesta tu pregunta, sigue.
- **Nunca** escribas tú la aprobación. Con una `datos` aprobada, es el bucle quien escribe `aprobado-<paso>`, y sin ella no se publica un
  SQL de seguridad.
