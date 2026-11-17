---
name: traer-de-proyecto
description: Trae al kit una mejora del flujo hecha en un proyecto — baja por GitHub el PR integrado, se queda con las rutas de flujo, generaliza los nombres a marcadores, aplica, prueba y publica. La usa la tarea «traer de <repo> el PR #<n>» que abre sola el orquestador de un proyecto. Úsala con `/traer-de-proyecto <cuenta/repo> <pr>`.
argument-hint: '<cuenta/repo> <pr>'
---

# /traer-de-proyecto

El sentido proyecto → kit del flujo (`docs/KIT.md` › «El flujo entre el kit y los proyectos»). Corre en el kit. Lo que entra aquí
llega a todos los proyectos con su tarea semanal: generaliza todo y no traigas nada que sólo sirva a un proyecto.

1. **Traer.** `node scripts/kit/traer-de-proyecto.mjs <cuenta/repo> <pr>`. Exige el PR integrado; baja el proyecto antes y después
   de su squash (con el token de la cuenta del proyecto) y, por cada ruta de flujo que cambió, aplica el cambio sobre el kit sin perder
   sus marcadores. Sube las lecciones `(kit)` y `(semilla)` (paso 4). Sale con 0, con 3 si hubo choques o con 1 (lo dice).
2. **Generalizar** lo que lista «por generalizar» y «nuevos en el kit», según `docs/KIT.md` › «Lo que el generador reemplaza»:
   - el nombre del repo (`<slug>-<rol>`) pasa a `{{NOMBRE}}` en la prosa de los archivos de `CON_NOMBRE` (`scripts/kit/personalizar.mjs`)
     y a `cambiar-slug-app` en un identificador; el slug suelto, a `cambiar-slug`;
   - los puertos del bloque del proyecto, a `{{API_PORT}}`, `{{DB_PORT}}` o `{{PUERTOS_PILA}}` (sólo en `ci.yml` y `action.yml`);
   - lo propio del dominio del proyecto, a texto genérico. Lo que sólo sirve a ese proyecto no se trae: se revierte y se dice en el PR.
     Un archivo nuevo con el nombre del repo en un archivo que no está en `CON_NOMBRE` se escribe sin el nombre (o se suma a `CON_NOMBRE`
     si de verdad lo necesita, con su prueba en `nuevo-proyecto.test.mjs`).
3. **Choques.** Las tres versiones (antes y después del PR, y la del kit) quedan en la carpeta que imprime. Aplica a mano la intención
   del PR sobre la del kit. Si la intención no está clara: `RESULTADO: TRABADA — <ruta>: <qué no se entiende>`. Lo que quedó «por
   decidir» (un archivo que el PR borró) no se aplica solo: decídelo con el resto del PR y dilo en el cuerpo.
4. **Lecciones** (ya aplicadas por el paso 1; revísalas): una `(kit)` va a `docs/LECCIONES.md` en su sección, igual salvo el sufijo,
   que pasa a `(<repo>, PR #<n>)` (así `quitarRepetidas` de `scripts/kit/mezcla.mjs` la reconoce al bajar y quita la del proyecto); una
   `(semilla)` va a `docs/semillas/LECCIONES.md` › «Sugerencias de los proyectos», que idea-a-semilla vuelve regla en su sección.
5. **Comprobar.** `node scripts/kit/traer-de-proyecto.mjs comprobar --nombre <repo> --slug <slug>` (sale con 1 y la lista si quedó un
   nombre sin generalizar), y después `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:generador` y `shellcheck` si tocaste bash.
6. **Commits:** uno por cambio, con el tipo que corresponda (el scope `kit` para lo del orquestador y el flujo) y en el cuerpo
   `Viene de <cuenta/repo>#<n>.` Si cambió una conducta, `docs/KIT.md` o `scripts/orquestador/README.md` en su commit `docs(kit): …`.
7. **Publicar** como cualquier cambio (la skill `entregar`).
8. **Nada que traer** (todo era propio del proyecto, o ya estaba en el kit): `RESULTADO: TRABADA — nada que traer: <por qué>`.
