---
name: semilla-a-repo
description: Crea un proyecto nuevo desde el kit y una semilla validada de idea-a-semilla. Copia el kit, hace los reemplazos, genera los docs, verifica el repo, lo publica en GitHub, abre los carriles y deja listo el arranque del piloto. Úsala en Claude Code (en Orca o en la terminal), con la carpeta del kit abierta, cuando el dueño diga «arranca el proyecto <slug>», «semilla a repo» o «crea el repo de la semilla».
argument-hint: '<slug> [--semillas <carpeta>] [--destino <carpeta>]'
---

# /semilla-a-repo $ARGUMENTS

Conviertes **una semilla validada** en un repo listo para que los carriles trabajen en paralelo. La parte determinista la hace un script
(`scripts/kit/nuevo-proyecto.mjs`, probado en `nuevo-proyecto.test.mjs`); tú lo corres, verificas cada paso y paras en las decisiones
que son del dueño. **No escribes código del producto** ni corriges la semilla: si algo de la semilla no cuadra, lo dices y paras, y el
arreglo vuelve a `idea-a-semilla`.

## 0. Guardas (si una falla, para y di cómo arreglarla)

1. **Modelo y effort:** Opus 5.5, effort `medium`. Si no eres Opus 5.5, para y di `/model opus`. El effort no lo puedes leer: pide «confirmo medium» o que el dueño teclee `/effort medium`.
2. **Estás en la carpeta del kit**, que es la que tiene `scripts/kit/nuevo-proyecto.mjs` y `docs/KIT.md`, y `git status` está limpio. Si el kit tiene cambios sin commit, para: el proyecto saldría de un kit que no está guardado.
3. **Las rutas:**
   - Las semillas están en `--semillas`; si no se pasa, en `<padre del kit>/semillas`.
   - La semilla está en `<semillas>/<slug>/`, y el validador en `<semillas>/_herramientas/validar_semilla.py`.
   - El destino es `--destino`; si no se pasa, `<padre del kit>/<slug>`. No existe, o está vacío.
4. **Herramientas:**
   - `node` 24 o más reciente, `pnpm`, `git`, `python3` con PyYAML, `jq` y `tmux`.
   - `gh auth status` en verde.
   - `docker info`, para los tipos de la base. Sin Docker se puede seguir, pero el paso 4 queda pendiente y se dice.
   - Que exista `git config user.email`: el piloto hace commits.
5. **La semilla está lista.** Lee `<semillas>/<slug>/ESTADO.md`:
   - Tiene que decir «lista para auditoría independiente» o que la auditoría ya se hizo.
   - Si el tamaño es `grande` o `escala`, la auditoría independiente es obligatoria: sin ella, para.
   - Si el tamaño es `chico` o `mediano` y no hubo auditoría, es una pregunta (abajo).

## 1. Ensayo

`node scripts/kit/nuevo-proyecto.mjs <semilla> <destino> --en-seco`. Valida la semilla con el validador de idea-a-semilla y con el del
coordinador (que el plan corra en paralelo sin choques). Revisa además que el sistema de diseño cumpla el contrato de tokens del kit
(los nombres de `design/tokens.css` y el tema `.dark`). Si falla, muestra el motivo tal cual, di que el arreglo va en la semilla
(`idea-a-semilla`, una ronda nueva y otra versión) y para.

Si pasa, muestra el resumen en 6 líneas:

- nombre y slug,
- bloque y puertos (app, API, base),
- carriles y `CARRILES_MAX`,
- scopes,
- tope de cuota y `PILOTO_AUTO_MIN`,
- destino.

## 2. Preguntas (una sola ronda, con la herramienta de opción múltiple y la recomendada primero)

- **Si no hubo auditoría independiente** (tamaño chico o mediano): «¿Arranco sin la auditoría independiente?».
  - Recomendado para chico: «arrancar».
  - Recomendado para mediano: «auditar primero».
- **GitHub:** «¿Creo el repo privado `<cuenta>/<slug>` y lo publico?».
  - Recomendado: «sí, privado».
  - Alternativa: «lo creo yo», y le das el comando.
  - El nombre de la cuenta sale de `gh api user --jq .login`.
- **Carriles:** «¿Abro los N carriles ahora?».
  - Lo recomendado depende de la RAM libre: cada carril pesa unos 0,85 GB, medido en un proyecto anterior.
  - Si la RAM no alcanza, la recomendación es abrir menos.

Si el dueño no está, decide lo recomendado y escríbelo en la primera línea de tu respuesta. La excepción es GitHub: crear un repo no se deshace con git, así que sin respuesta no se crea.

## 3. Crear y verificar

1. `node scripts/kit/nuevo-proyecto.mjs <semilla> <destino>`. Copia el kit, hace los reemplazos, genera `docs/UX.md`, `GLOSARIO.md` y `RENDIMIENTO.md`, hace el primer commit y verifica que no quedó ningún marcador.
2. En el destino, en este orden y parando en el primer rojo: `pnpm install` (instala también los hooks de lefthook), `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:probar` y `node scripts/coordinador/coordinador.mjs validar`.
   - Un rojo aquí no lo arregla el proyecto: es un defecto del kit o del generador. Dilo con la salida y para.

## 4. La base local (con Docker)

En el destino:

1. `pnpm exec supabase start -x studio,imgproxy,logflare,vector`.
2. `pnpm db:reset` y después `pnpm db:types`.
3. Si `src/shared/types/database.types.ts` cambió, haz commit: `chore(db): generar los tipos de la base`.

Sin esto, el job `base` del CI cae. Si no hay Docker, este paso queda pendiente: dilo, y no publiques hasta que se haga.

## 5. GitHub (si el dueño dijo que sí)

1. `gh repo create <cuenta>/<slug> --private --source . --remote origin --push`.
2. Comprueba que el repo permita el merge con squash: `gh api repos/<cuenta>/<slug> --jq .allow_squash_merge`. El coordinador integra así.
3. Mira el primer CI con `gh run watch`. Si cae, muéstralo y para.

## 6. Carriles y confianza

1. **La confianza de la carpeta:** el dueño abre `claude` una vez, en modo interactivo, en la **principal** del proyecto y acepta el diálogo.
   - Sin eso, `claude -p` ignora las `permissions.allow` (medido en un proyecto anterior).
   - Es una decisión del dueño: se la pides, no la tomas.
2. Si dijo que sí a los carriles: `bash scripts/coordinador/abrir-carriles.sh`. Crea los worktrees en `<destino>.carriles/`, levanta un Supabase por carril y anota el proyecto para la cuota.
   - Si el dueño trabaja en Orca, dile que abra en Orca la principal y los worktrees de `<destino>.carriles/`.
   - Si Orca no los muestra, que los cree desde Orca con la misma rama (`<carril>/base`) y corra `bash scripts/worktree/preparar.sh <carril>` en cada uno.

## 7. Cierre: no arrancas el piloto

Arrancar los pilotos gasta cuota sin que nadie mire, así que lo decide el dueño. Termina con:

- Lo creado: la ruta, el repo y el commit.
- Lo verificado: cada comando con su resultado.
- Lo pendiente: Docker, la confianza de la carpeta, o la calibración de la cuota (`docs/KIT.md` › «Calibrar la cuota»).
- El comando exacto para arrancar: `cd <destino> && bash scripts/piloto/arrancar.sh --todos`, y para mirar: `node scripts/coordinador/coordinador.mjs tablero`.

## Nunca

- Editar la semilla o el plan para que pasen. Si no pasan, vuelven a `idea-a-semilla`.
- Saltarte un rojo del paso 3. Hacer `--no-verify`. Forzar un push.
- Crear el repo público, o crear uno sin que el dueño lo haya dicho.
- Arrancar los pilotos.
