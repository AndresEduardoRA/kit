# Plan del paso <PASO> — <título>

> Lo escribe el `planificador` en `.piloto/planes/<paso>.md`. Lo audita el `auditor`. Corto y concreto: lo que la persona revisaría antes de que se ejecute.
>
> - **Tope: 60 KB** medidos con `wc -c` (medido en un proyecto anterior: uno de 87 KB repetía la conducta cuatro veces). Un plan que no cabe es un paso que no cabe: se parte.
> - **La conducta se escribe una vez**, numerada (`C1…Cn`); archivos, pruebas y mutaciones la citan por número, no la vuelven a contar.
> - **Las respuestas al auditor van en `.piloto/planes/<paso>.respuestas.md`**, no aquí. El plan se corrige con `Edit`, nunca se reescribe entero.
> - Los prefijos: `Pn` las preguntas, `Vn` las precondiciones, `Cn` la conducta, `Mn` las mutaciones.

## Preguntas abiertas

De producto, de UX, de datos, de dependencias o de rutas de otro carril: **una por decisión**, `Pn · la pregunta · de 2 a 4 opciones, la
recomendada primero`. Van arriba porque la persona las lee primero. Si hay alguna, el paso termina en una compuerta (la de `producto` lleva
cada `Pn` como una pregunta propia). Si el paso no es `rojo`, una de `producto` es ámbar y se autoelige la recomendada: tiene que ser segura
tal cual. Sin preguntas: «Ninguna».

## Paso y semilla

El id, el título, el riesgo y el `terminado` de `.piloto/hechos.json` › `paso`; los IDs de `decisiones` con la línea de
`docs/semilla/semilla.md` que aplica cada uno; las dependencias y lo que dejaron dicho en `docs/pasos/<DEP>/decisiones.md`.

## Alcance y fuera de alcance

Qué entra, en una lista corta que cita la conducta (`C3`, `C4`), y aparte qué **no** entra aunque esté cerca (con el paso de `plan.yaml`
donde sí). Sin describir la conducta aquí.

## Partición

Si junta capas con verificación distinta (la base, `src/shared`, la pantalla): qué hace este paso y qué pasos nuevos se proponen al
coordinador (id, título, `modulos`, riesgo, `depende_de`). Si no se parte, por qué cabe (en 60 KB y en hasta 3 commits de código).

## Precondiciones verificables

Lo que el plan da por cierto del código, de la base o de los docs, una por línea: `Vn · la afirmación · archivo:línea`. Es lo que el
auditor contrasta con el repo; una afirmación sin su `archivo:línea` no es una precondición, es una suposición, y se dice como tal.

## Conducta

Una regla por cambio de conducta: `Cn · la regla`. Una tabla vale cuando la conducta es una tabla (error → texto → salida). Lo que las
secciones de abajo necesitan saber de la conducta está aquí y en ningún otro lugar.

## Archivos

Una tabla: `ruta · capa (entities / infra / features / app / shared / supabase) · crea o toca · Cn`. Todas dentro de los `modulos` del
paso, lo del carril o `docs/pasos/<PASO>/`. Ninguno de más de 300 líneas.

## Nivel de verificación

- Salida de `node scripts/piloto/nivel.mjs <archivos>` (pegada): nivel, disparadores, si toca interfaz, si cambia `database.types.ts`.
- El `verificacion` del paso (nivel y comando) y si este paso corre el completo.
- Los e2e **dirigidos** (por el texto tocado: `grep` en `e2e/`) y en qué proyectos.

## Pruebas que fallan primero

Una tabla: `archivo · prueba · Cn · dónde queda en rojo contra HEAD` (`.piloto/salidas/<paso>/`).

## Mutaciones

Una tabla: `Mn · archivo de producto · qué se rompe · Cn · la prueba que debe caer`. Se hacen después de verde y se revierten con `cp` + `cmp`.

## Seguridad y permisos

Claves de permisos, RLS, RPC, `security definer`, Vault, contra la matriz de `docs/semilla/semilla.md` › Seguridad. Nada que un rol no
deba ver. Si hay algo y el paso no es `rojo`, es una compuerta `datos`.

## Rendimiento

Las filas de `docs/RENDIMIENTO.md` de cada lista que toca: tope, índice y presupuesto. Qué volumen se siembra para probar.

## Notas

Sólo en `docs/pasos/<PASO>/`: `bitacora.md` con su marcador `e2e completo: sí|no (…)` y `decisiones.md` con la fecha de
`TZ=America/La_Paz date +%F` (y la autoelección ámbar, si hubo). Además, las fichas `CLAUDE.md` de lo que cambia y `docs/GLOSARIO.md` si hay
un término nuevo.

## Commits

**Hasta 3 commits de código y el de notas**, uno por intención, en orden, con su asunto (`tipo(<carril>): …`, español, minúscula, ≤ 72
caracteres) y qué lleva cada uno. Si el plan necesita más, el paso no cabe y se parte. El `fix` que pida la auditoría del informe va aparte
y no cuenta.

## Prueba final

El `verificacion.comando` del paso, tal cual: es lo que el bucle va a correr.
