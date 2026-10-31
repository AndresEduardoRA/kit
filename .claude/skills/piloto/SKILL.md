---
name: piloto
description: Un paso de plan.yaml, de punta a punta en una sesión (plan por el planificador, auditoría en contexto aparte, ejecución, informe y commits sin push). Sólo lo lanza el bucle del piloto de un carril (`claude -p "/piloto <paso>"`); no se invoca a mano.
argument-hint: '<paso> [continuar] [--hasta-plan]'
disable-model-invocation: true
---

# /piloto $ARGUMENTS

Eres la sesión de **un** paso del plan, en el worktree de **un** carril. El bucle de ese carril (`scripts/piloto/bucle.sh`, bash, sin
modelo) te lanzó con `claude -p` y nadie te contesta en vivo. Lo que necesites decidir y no sea tuyo se lo pides al bucle por
`.piloto/ultimo.json` (una **compuerta**), no con una pregunta: aquí no hay `AskUserQuestion`.

`$ARGUMENTS` es el id del paso y, opcionales:

- `continuar`: retomas esta sesión tras una compuerta o un fallo.
- `--hasta-plan`: te detienes cuando el plan está auditado. Pasa siempre en los pasos rojos y en los de modo manual.

## Tu paso

Todo lo de tu paso está en `.piloto/hechos.json` › `paso`, que es lo que entregó el coordinador a partir de `docs/semilla/plan.yaml`:

| Campo          | Qué es                                                                       |
| -------------- | ---------------------------------------------------------------------------- |
| `titulo`       | El título del paso                                                           |
| `riesgo`       | `rojo`, `ambar` o `verde`                                                    |
| `modulos`      | Las rutas que puedes tocar, junto con lo de tu carril y `docs/pasos/<PASO>/` |
| `decisiones`   | Los IDs del registro de la semilla que aplica este paso                      |
| `verificacion` | El nivel y el comando que el bucle va a correr                               |
| `terminado`    | El criterio de terminado                                                     |
| `arreglar`     | Si no es null, tu PR ya existe y está en rojo o en conflicto con main        |

Si `arreglar` no es null, el trabajo es dejar ese PR en verde:

- Con un conflicto, haz `git merge origin/main`, resuelve y haz el commit del merge.
- Con el CI en rojo, mira `gh run view --log-failed` y arregla.

No empiezas nada nuevo.

La semilla es la fuente de verdad: lee en `docs/semilla/semilla.md` las secciones de tus `decisiones` y de tus pantallas, por grep y sin leerla entera.

## Reglas que no se negocian

- **No publicas.** Nada de `git push`, PR, `gh` que escriba ni `claude`. El hook lo rechaza con `PILOTO=1`; el bucle verifica y empuja. Tus commits quedan locales, en la rama `<carril>/<paso>`.
- **Solo tocas lo tuyo:** las rutas de tu carril, tus `modulos` y `docs/pasos/<PASO>/`. Nada de `docs/ESTADO.md`, `docs/PLAN.md` ni `docs/semilla/`: el tablero lo lleva el coordinador. La guarda de CI `scripts/guardas/carriles.mjs` rechaza tu PR si tocas algo fuera de eso.
  - Si necesitas un cambio en lo de otro carril, no lo haces. Termina con una compuerta `afuera` que diga qué falta y de qué paso debería ser.
- **Lo que autoriza no es tuyo:** no escribes ni nombras `<carpeta común de git>/piloto/**` ni `.piloto/decision.md`. La decisión vigente está en `hechos.json` › `decision`.
- **La base local y el e2e** son de una sola sesión a la vez por carril (`scripts/candado.sh`). Nunca lo saltes.
- **Sigues `CLAUDE.md`, `AGENTS.md` y `.claude/rules/`.** Nadie prueba a mano. Nunca `--no-verify`. No instalas dependencias: eso es una compuerta `dependencia`.

## El camino

1. **Orientarte** (poco): `hechos.json`, `docs/MAPA.md` y, con `continuar`, `.piloto/planes/<paso>.md` y `.piloto/informes/<paso>.md`.
2. **Planificar.** El subagente `planificador` (opus) escribe `.piloto/planes/<paso>.md` con [plantilla-plan.md](plantilla-plan.md). El plan cita los IDs de `decisiones` y termina con el `verificacion.comando` del paso como prueba final.
3. **Auditar el plan.** El subagente `auditor` (opus, en un contexto aparte) responde `VEREDICTO: pasa|observaciones|bloquea`.
   - Si bloquea dos veces, compuerta `atasco`.
   - En la segunda ronda, solo lo cambiado (`<paso>.auditado.md`, `<paso>.respuestas.md`).
4. **Compuertas del plan** ([compuertas.md](compuertas.md)). Con `--hasta-plan`, después de auditar terminas **siempre** con una compuerta `datos` que lleve el plan en su `contexto`.
5. **Ejecutar y verificar** al nivel del plan, en este orden:
   - Primero las pruebas que fallan, en rojo contra HEAD.
   - Después el código.
   - Después las mutaciones del plan.

   Las salidas van a `.piloto/salidas/<paso>/`.

6. **Informe** en `.piloto/informes/<paso>.md` ([plantilla-informe.md](plantilla-informe.md)), y **auditar el informe**, con el mismo tope de dos bloqueos.
7. **Notas y commits.**
   - Tus notas van en `docs/pasos/<PASO>/`:
     - `bitacora.md`: qué se hizo, lo medido y `e2e completo: sí|no`.
     - `decisiones.md`: cada decisión no obvia, con la fecha de `TZ=America/La_Paz date +%F`. Si `hechos.json` › `autoelecciones` trae una autoelección ámbar de tu paso, también va aquí, tal cual.
   - Corre `bash scripts/mapa.sh` si existe.
   - **Commits por intención**: hasta 3 de código y el de notas. Asunto en español, en minúscula, de 72 caracteres como máximo, con el formato `tipo(<carril>): …`.
   - **Sin push.**
8. **Terminar:** escribe `.piloto/ultimo.json` y responde con una línea.

## `.piloto/ultimo.json`

```json
{
  "paso": "<id>",
  "resultado": "listo | compuerta | falla",
  "resumen": "…",
  "commits": ["<sha>", "…"],
  "e2e_dirigidos": ["e2e/<spec>.spec.ts"],
  "compuerta": null
}
```

- **`listo`:** `commits` es exactamente `git rev-list --first-parent --reverse <head_arranque>..HEAD`, con el commit del merge si hubo uno, y el árbol está limpio. El bucle corre lint, typecheck, test, tu `verificacion.comando` y los `e2e_dirigidos`; no le cree a tu «listo».
- **`compuerta`:** el formato está en [compuertas.md](compuertas.md); la opción recomendada siempre va primero.
  - Una de `producto` en un paso que no es rojo es **ámbar**: si la persona no responde en `PILOTO_AUTO_MIN` minutos, el bucle elige la recomendada. Por eso esa opción tiene que ser una que puedas aceptar sin más.
- **`falla`:** lo que no pudiste hacer y por qué. No inventes un `listo`.
