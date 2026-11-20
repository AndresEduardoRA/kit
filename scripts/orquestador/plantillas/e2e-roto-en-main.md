---
# Dejar verde un e2e que cae también en main: lo crea solo el orquestador (ajeno-de-main.sh) cuando una sesión de arreglo termina con
# `RESULTADO: AJENO — <spec>:<línea> [<proyecto>] — <evidencia>`, una vez por `<spec>:<línea>` (la tarea que lo encontró espera a ésta).
# Reemplaza las llaves SLUG (el spec y la línea, en kebab, con -2, -3 si la rama ya fue de otra), SPEC, LINEA, PROYECTO, TAREA, PR y
# EVIDENCIA (en una línea): en estos comentarios van sin llaves. Va urgente (cola:urgente).
titulo: dejar verde {{SPEC}}:{{LINEA}} en main
rama: fix/e2e-main-{{SLUG}}
conflicto: e2e
nivel: normal
effort: high
urgente: si
---

## Pedido de la persona

«Lo ajeno va en su tarea urgente: la tarea que lo encuentra no lo toca y espera.» Al arreglar el PR #{{PR}} de {{TAREA}}, el e2e
`{{SPEC}}:{{LINEA}}` ({{PROYECTO}}) cae y también cae en `main`: no es de esa rama. Esta tarea la abrió solo el orquestador
(`scripts/orquestador/README.md` › «Un e2e roto en main»); {{TAREA}} espera a que se integre.

## Objetivo

Dejar verde `{{SPEC}}:{{LINEA}}` en `main`, con el proyecto `{{PROYECTO}}` (y el otro si el spec corre en los dos).

## Decisiones ya tomadas

- Lo que vio la sesión que lo encontró: {{EVIDENCIA}}
- La causa se busca con evidencia: reproducir el spec sobre `origin/main` y leer su traza en `e2e-fallos/<fecha>/`. Ni reintentar hasta que
  pase, ni `.skip` ni `.fixme`.
- Si el mismo spec ya está en otra tarea de la cola (un issue `noche-roja`, por ejemplo), es la misma falla: dilo en el PR y arréglala
  aquí; no la dupliques.
- Si la causa es ajena al repo (el runner, un servicio de afuera), `RESULTADO: TRABADA —` con la evidencia.

## Anclajes

`{{SPEC}}` y `e2e/soporte/`.

## Estados no felices

Un spec que cae sólo en CI se reproduce con el build de producción (`pnpm test:e2e`, como en CI) antes de tocarlo · uno que en local pasa
siempre → la traza de la corrida manda; si no alcanza, trabada con lo visto.

## Verificación

`pnpm test:e2e {{SPEC}} --project={{PROYECTO}}` en verde, y lo de siempre (`pnpm lint`, `pnpm typecheck`, `pnpm test`).
