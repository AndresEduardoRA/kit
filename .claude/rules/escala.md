---
paths:
  - 'src/**'
  - 'supabase/**'
  - 'e2e/**'
  - 'scripts/**'
---

# Escala

Toda lista se diseña para miles de filas, aunque la semilla tenga 20 (cursor, tope e índice, abajo). Se
verifica con volumen sembrado, no a ojo (`pnpm db:sembrar-volumen`, `pnpm db:medir:volumen`), **sólo si va
sobre una tabla que crece**. Las de configuración (decenas de filas) no se miden (`.claude/rules/e2e.md` ›
«Pruebas: sólo lo clave»). Cada superficie con su tope, índice y presupuesto está en `docs/RENDIMIENTO.md`
(sale de `docs/semilla/semilla.md` › Escala y rendimiento); una lista nueva sin su fila ahí no está terminada.

## Paginación y topes

- Una lista se lee por cursor (keyset), una página fija a la vez. Nunca `offset` ni `.range()`.
- El tamaño de página sale sólo de `src/shared/lib/paginacion.ts` (10, 25, 50, 100); nunca escrito a
  mano en un componente, una consulta ni el SQL de una medición.
- Una lista con Anterior/Siguiente y filtros ofrece los tamaños (`?por=`) y declara su máximo. Un
  máximo se gana midiendo con el valor más alto; si no cabe en presupuesto se declara uno menor y el
  motivo va a `docs/RENDIMIENTO.md`. «Ver más», columnas y papeleras usan un tamaño fijo, sin selector.
- Toda RPC con parámetro de tamaño (`p_tamano`, `p_tope`…) lo acota con una sola función de la base
  (`_acotar_pagina(parámetro, por_defecto, máximo)`), nunca `least(greatest(…))` a mano, y su máximo
  no es menor que el del código. Una lectura por PostgREST tiene su tope en `max_rows` de `config.toml`.
- Lo que se dibuja tiene tope. Al llegar se avisa; la lectura pide uno de más y corta, y dice si
  había más. Siempre hay un camino a lo antiguo (ir a una fecha, un filtro, la búsqueda).
- Un número que se muestra sale de `limit n + 1` o no se muestra. Nunca `count(*)` ni
  `count: 'exact'`: se escribe «más de 50» o «500+». PostgREST corta en 1.000 filas: un tope mayor
  se lee por páginas.
- Excepción: un agregado de un **período cerrado** (un tablero del mes) se cuenta en la base, con ventana
  máxima de 366 días, por índice de fecha y, si usa `count(`, con su motivo en `supabase/tests/escala.sql`.
  Las listas y sus números siguen la regla de arriba.

## Consultas

- Cada consulta nombra en un comentario el índice que la sostiene y tiene su `EXPLAIN` en
  `pnpm db:medir:volumen`, sobre el plan genérico: con el índice, sin recorrer la tabla ni descartar
  filas que crezcan con la profundidad, y dentro de su presupuesto de tiempo.
- En plpgsql, con cursor y sin cursor son dos consultas: un `p_x is null or (…)` o un `coalesce` en
  el cursor dejan de ser condición de índice.
- Una lectura por rutas va en plpgsql, cada ruta con su `order by … limit`. Nunca ramas filtradas de una `setof` bajo un
  `order by … limit` de afuera: Postgres 17 no las aplana y cada una ordena todo (y una forma probada con `enable_sort = off`
  no prueba el plan real). Un filtro armado en SQL dinámico lleva todo valor por `using`. Lo derivado de la fila se calcula
  sobre la que la ruta ya leyó: releerla paga otra pasada de la RLS.
- Una función cara lleva su `COST` verdadero; con el barato, Postgres la llama en todas las filas y
  después ordena.
- Un filtro que no es una columna indexada (`ilike` o `@>` bajo RLS, un campo libre) va a una función
  de candidatos con su índice. Contar también es leer: el conteo usa los mismos candidatos.
- Un recorrido sin índice tiene tope y un «Seguir buscando». Medido en un proyecto anterior: 10.000
  filas por tanda caben en presupuesto.
- Un texto de búsqueda pide 3 letras o dígitos seguidos; la RPC ignora lo más corto.
- Una policy no arma un arreglo con todo lo de quien mira (`= any(…)`): pregunta por fila.
- Ninguna acción crece con lo cargado: recargar lee una página, buscar tiene tope de páginas, nada
  consulta por fila (N+1). Exportar, importar y los jobs van por lotes con tope por lote y por corrida.
- Las imágenes se piden por tamaño (miniatura de 480 px en toda lista), nunca el original.

## Carga del cliente

- Las listas hijas se leen al abrir su pestaña o sección, nunca con la lectura del padre, y su
  código viaja diferido.
- Código diferido con el ayudante de `src/shared/ui/diferido.tsx`, nunca `next/dynamic` suelto (el
  lint lo prohíbe). Un modal o panel se monta la primera vez que se abre.
- Lo que importa el layout de la app viaja en toda pantalla: importa la entrada `shell` del módulo,
  nunca su `index.ts` (`modulos.md`).
- Una lista nueva sobre una tabla que crece (arriba) se prueba con volumen sembrado por SQL (`generate_series`,
  `e2e/soporte/sql.ts`): el plan en `db:medir:volumen`, con el máximo de página y en una página profunda; bytes y nodos del
  DOM sólo en las listas principales. Un presupuesto pasado por ≤ 5 % se sube en `docs/RENDIMIENTO.md`.

## Las guardas (qué falla si la próxima lista no cumple)

Se escriben con la primera lista y se mantienen; una excepción va en su registro con motivo.

- `count:`, `head: true`, `.range(`, `.select('*')`, `.from()` sin `.limit(` → `scripts/guardas/escala.test.ts` (`pnpm test`)
- `next/dynamic` → `eslint.config.mjs` (`pnpm lint`)
- SQL con `offset`, `count(` sin `limit`, tamaño sin `_acotar_pagina` → `supabase/tests/escala.sql` (`pnpm db:probar`)
- RPC con tamaño fuera del registro, `max_rows` corto → `scripts/guardas/paginas.test.ts` (`pnpm test`)
- Plan y tiempo de cada lista y búsqueda con volumen → `supabase/tests/medir-*.sql` (`pnpm db:medir:volumen`)
- JS en frío por ruta y nodos del DOM por lista → `e2e/presupuesto-js.spec.ts` y el spec de volumen de la lista (`pnpm test:e2e`)
