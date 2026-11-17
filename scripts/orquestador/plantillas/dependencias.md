---
# La tarea mensual de dependencias: la crea sola el orquestador (deps_del_mes en cola-entrada.sh) con la etiqueta `deps`, una vez por
# mes, y reemplaza {{MES}} por el mes (AAAA-MM, UTC). `permite: dependencias` le da a su sesión ORQ_PERMITE=dependencias.
titulo: actualizar las dependencias dentro de sus rangos ({{MES}})
rama: chore/dependencias-{{MES}}
nivel: normal
effort: high
permite: dependencias
---

## Pedido de la persona

«No hay vía para actualizar dependencias.» Esta tarea la abre sola el orquestador una vez al mes (`scripts/orquestador/README.md` ›
«La tarea mensual de dependencias»).

## Objetivo

Las dependencias al día dentro de los rangos de `package.json`, el CI completo en verde y cada versión mayor disponible anotada para
que la decida la persona.

## Decisiones ya tomadas

- Sólo `pnpm update` (dentro de los rangos: sin `--latest` ni una versión) y `pnpm dedupe`. Ni `pnpm add`, ni `pnpm remove`, ni tocar
  a mano los rangos de `package.json`.
- `pnpm outdated` lista las versiones mayores disponibles. Cada una va como una línea en `docs/PENDIENTES.md` › «Decisión de la
  persona» (la sección se crea si falta): `- <paquete> <actual> → <mayor> (decisión de la persona)`. Una línea por paquete, actualizada
  si ya estaba; la mayor no se instala.
- Si una actualización rompe algo y la causa es la dependencia (no el código del repo), `RESULTADO: TRABADA —` con el paquete, la
  versión y la evidencia.
- Sin nada que actualizar ni mayores nuevas que anotar: `RESULTADO: TRABADA — nada que actualizar este mes` (la persona cierra el
  issue).
- Dos commits: `chore(deps): actualizar las dependencias dentro de sus rangos` y `docs(docs): anotar las versiones mayores disponibles`.

## Anclajes

`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `docs/PENDIENTES.md`.

## Estados no felices

Nada que actualizar → trabada a propósito · una actualización rompe el build o una prueba por la dependencia → trabada con la
evidencia · una mayor ya anotada → se actualiza su línea, no se duplica.

## Verificación

En local: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` y `pnpm db:probar`. El e2e completo lo corre el CI: tocar las
dependencias pasa `scripts/e2e-dirigidos.mjs` a completo.
