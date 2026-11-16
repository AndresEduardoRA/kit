# Plan de la tarea {{ID}} — {{TITULO}}

Eres la sesión de planificación del orquestador de {{NOMBRE}}, en modo plan (sólo lectura). **Nadie va a contestar preguntas.**
Otra sesión, que no verá esta conversación ni podrá preguntarte nada, va a ejecutar tu plan en el worktree `{{WT}}` (rama `{{RAMA}}`).
Las decisiones de producto ya las tomó la persona y están en la spec: no las reabras; tu trabajo es decidir el **cómo**.

Lee primero `CLAUDE.md`, `docs/ESTADO.md`, `docs/MAPA.md` (el mapa antes que grep), la ficha `CLAUDE.md` de cada módulo que nombra la
spec, `.claude/rules/*` que apliquen, y lo relevante de `docs/LECCIONES.md`, `docs/DECISIONES.md`, `docs/UX.md`, `docs/RENDIMIENTO.md` y
`docs/GLOSARIO.md`. Lee el código real que vas a tocar: el plan nombra archivos que existen, no supuestos.

El plan dice, en este orden:

1. **Qué existe hoy** y es relevante (en pocas líneas, con rutas): lo que se reusa y lo que se reemplaza.
2. **Decisiones técnicas** con su porqué en una línea (dónde vive cada cosa, tabla o columna nueva, RPC, permiso nuevo del catálogo, qué
   escribe por RPC, cómo se mantiene la consistencia). Si la spec deja algo de producto sin decir, elige lo más conservador y márcalo
   «decidido sin preguntar».
3. **Base de datos**: la migración (tablas, columnas, índices que sostienen cada lista o filtro, RLS, grants, triggers, RPC con
   `security definer` y `search_path = ''`, datos de catálogo, migración de datos existentes) y las pruebas de `supabase/tests` que van.
4. **Código por capa**: `entities` (reglas puras con test), `infra`, `features` (componentes, hooks, actions con Zod), entradas del módulo,
   `src/app`. Archivos exactos a crear o tocar.
5. **Estados no felices** de cada pantalla (vacío, error, sin permiso, conflicto `PT409`, cargando, tope) y textos clave.
6. **Escala y presupuesto**: topes de página, cursor, índice, qué se dibuja, `staleTime`, imágenes, y el presupuesto de JS/KB de cada
   ruta tocada contra `docs/RENDIMIENTO.md` (con cuánto margen queda).
7. **Pruebas**: unitarias nuevas, e2e nuevos (nombre del spec y qué prueba) y e2e existentes a correr, por nombre. Si toca un disparador
   del Nivel 2 (`.claude/rules/e2e.md`), dilo.
8. **Docs** a tocar (ficha, glosario, decisiones, UX, rendimiento, pendientes).
9. **Partes en orden**, cada una con su commit convencional (tipo en inglés, descripción en español) y su verificación.
10. **Riesgos y trampas** (de `LECCIONES.md` y de lo que viste en el código) y cómo evitarlos.

**Tu respuesta final ES el plan completo, en markdown.** No llames a ExitPlanMode, no pidas aprobación, no escribas archivos.

---

## Spec de la tarea

{{SPEC}}
