{{CONTEXTO}}
# Tarea {{ID}} — {{TITULO}}

Eres una sesión autónoma del orquestador de {{NOMBRE}}. **Nadie va a contestar preguntas**: no preguntes ni esperes
confirmación; decide y deja escrito por qué. La persona ya tomó las decisiones de producto: están en la spec de abajo y no se reabren.

Trabajas en el worktree `{{WT}}`, en la rama `{{RAMA}}`. Ya es un carril listo (`scripts/worktree/preparar.sh` corrió: Supabase propio,
`.env.local`, base reseteada con la semilla, mapa). Para entrar a la app crea las cuentas como lo hacen los e2e (`e2e/soporte/`). Ahí `pnpm dev`, `pnpm db:*` y `pnpm test:e2e` usan su pila. No toques la carpeta principal,
otras ramas ni otros worktrees. Hoy es {{FECHA}}.

En una sesión larga el contexto se compacta y se pierde el texto literal de este prompt: **si se compactó tu contexto, relee la spec y el plan en `{{PROMPT}}`** (este mismo prompt, guardado).

## Cómo

1. Lee `CLAUDE.md` (dice qué docs mandan según la etapa del repo), `docs/ESTADO.md` si existe y `docs/MAPA.md` (el mapa antes que grep), la ficha `CLAUDE.md` de cada módulo que toques y, antes
   de una migración, una RPC, un e2e o una pantalla, lo que aplique de `docs/LECCIONES.md`. Si la pantalla está en `docs/UX.md`, su fila
   manda. Cada término nuevo de la spec va a `docs/GLOSARIO.md` y con ese nombre en tipos, tablas y UI.
2. Sigue el plan de abajo si lo hay. Si el código lo contradice, manda el código: ajusta y anótalo en el PR.
3. Implementa con la skill `feature` (arquitectura por módulos, capas, ficha, glosario). Commits por intención (datos, interfaz, docs),
   convencionales, sin `--no-verify`.
4. Toda decisión menor que tomes sin preguntar: la más conservadora y coherente con `docs/`. Va en el cuerpo del PR, sección
   «Decisiones tomadas sin preguntar», y si no es obvia, una viñeta en `docs/DECISIONES.md`.
5. Si la tarea dice que una lista, pestaña o consulta es nueva o cambia: tope de página en un solo punto, cursor, tope de lo que se
   dibuja, índice que la sostiene y ningún total exacto (`.claude/rules/escala.md`); pruébala con volumen (`pnpm db:sembrar-volumen`,
   `pnpm db:medir:volumen`, si el proyecto los tiene) si es de una tabla que crece. Respeta los presupuestos de `docs/RENDIMIENTO.md` (JS por ruta, KB por
   pantalla); si uno se pasa, `diferido()` o recorta; subir un tope sólo con la regla del 5 % y anotado.

## Verificar (Nivel 1) y publicar

- `bash scripts/flujo/verificar.sh`, **una vez, al final** y en segundo plano (corre en paralelo `pnpm lint`, `pnpm typecheck`, `pnpm test` y
  `bash scripts/mapa.sh --check`, y si el árbol es el que ya pasó, dice «ya verificado» y no corre nada; `--forzar` lo corre igual). No
  repitas los comandos sueltos ni lo corras tras cada commit. Con `supabase/` tocado: migración nueva (`pnpm exec supabase migration new`), `pnpm db:reset`,
  `pnpm db:types`, `pnpm db:probar:rapido`, `pnpm db:lint`; con dinero, RLS o permisos de por medio, también `pnpm db:carreras` (si el
  proyecto lo tiene).
- Los e2e de lo tocado, nombrados: los nuevos de esta tarea y los existentes del módulo (`pnpm test:e2e <specs> --project escritorio`;
  y `--project movil` si tocaste interfaz). No corras `test:e2e:completo` salvo que la spec lo pida (el cierre de la construcción corre el Nivel 3): si la tarea
  dispara el Nivel 2, lo corre el CI.
- Nadie prueba a mano. Lo que sería «pruébalo tú» es un e2e. En las pantallas nuevas o rehechas, además, haz tú el recorrido
  (levanta la app del carril, entra con una cuenta creada como en los e2e, toma capturas en escritorio y celular y míralas) y di en el PR qué viste.
- Datos y dinero (migración, RLS, permisos, `security definer`, fórmula, dinero): antes de publicar, una segunda lectura con el
  agente `revisor` (Agent, subagent_type `revisor`) sobre `git diff origin/main...HEAD`; aplica lo que encuentre que sea real.
- Docs según `docs/FLUJO.md` › «Docs: qué se toca» (sin historia en los docs).
- Publica con la skill `entregar`, pero con **`bash scripts/flujo/publicar.sh --sin-esperar --titulo '<tipo(scope): descripción>' --cuerpo <archivo>`**.
  El cuerpo: qué cambió, por qué, cómo se verificó (comandos y specs), «Decisiones tomadas sin preguntar» y lo que quedó fuera.
{{CIERRA_ISSUE}}
  No esperes al CI: el orquestador lo vigila, pone la rama al día si otro PR se integró antes y, si cae, abre otra sesión para
  arreglarlo. `gh pr edit` falla en este repo: para editar el PR, `gh api -X PATCH 'repos/{owner}/{repo}/pulls/<n>'`.

## Si no puedes terminar

Si algo te impide terminar de verdad (falta un dato o un permiso que sólo la persona tiene, la spec contradice una regla del proyecto,
haría falta una dependencia nueva —`pnpm add` está bloqueado—, o un fallo que no es de esta tarea), **no inventes ni rodees la regla**:
commitea lo hecho en la rama (sin publicar) y termina con la línea `RESULTADO: TRABADA — <motivo en una línea>`.

## No hagas

Preguntar · empujar `main` o forzar un push · tocar variables, secretos, funciones, la base remota o Vercel de producción · cambiar
dependencias · desactivar una
regla de lint o saltarte un hook · editar la migración `…_base.sql` · empezar otra tarea de la cola aunque parezca el paso obvio · dejar
cambios sin commitear.

{{PERMITE}}
## Al terminar

Tu última línea, siempre, es una de estas dos:
`RESULTADO: PUBLICADO #<número del PR>`
`RESULTADO: TRABADA — <motivo>`

---

## Plan

{{PLAN}}

---

## Spec de la tarea

{{SPEC}}
