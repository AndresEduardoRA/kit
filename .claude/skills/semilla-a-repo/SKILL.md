---
name: semilla-a-repo
description: Crea los repos de un proyecto desde su semilla v2 de idea-a-semilla, los publica en GitHub y carga la cola de cada uno con los pasos de su plan, para que al encender los orquestadores el proyecto se construya solo. Úsala con `/semilla-a-repo <slug>`, `--sumar <rol>` (un repo nuevo en un proyecto que ya existe) o `--actualizar <rol>` (los pasos nuevos de una versión nueva de la semilla).
argument-hint: '<slug> [--sumar <rol> | --actualizar <rol>]'
---

# /semilla-a-repo

Toma `<raíz>/z_<slug>/semilla/` (formato v2 de idea-a-semilla), escribe el manifiesto `z_<slug>/proyecto.yaml`, crea cada repo en
construcción en `z_<slug>/<rol>/`, lo publica en GitHub y deja su cola cargada. La raíz es dos carpetas arriba de la principal del kit
(`proyectos/`); los guiones la calculan solos. Lo determinista lo hacen dos CLI del kit; esta skill las corre en orden, hace una sola
ronda de preguntas y para en cuanto algo no cuadra. Corre desde la principal del kit.

- `node scripts/kit/nuevo-proyecto.mjs <slug> [--sumar <rol>] [--en-seco]`: valida la semilla, escribe el manifiesto y crea los repos.
- `node scripts/kit/publicar-proyecto.mjs <slug> secretos|crear|cola|proteger [--rol <rol>] [--actualizar <rol>] [--privado] [--aunque-rojo]`:
  lo de GitHub.

`docs/KIT.md` › «Crear un proyecto» dice qué escribe cada una y por qué.

## 0 · Guardas

Si una falla, para y di cómo arreglarla.

- **Nivel:** esta skill es del nivel capaz. Compruébalo por tu propia identidad de modelo (la familia del nivel capaz, la de
  `NIVEL_CAPAZ` en `scripts/orquestador/config.env`, o una superior); sin escribir versiones en ningún lado.
- **Effort:** medium. No se puede leer desde la sesión: vale si la persona lo dijo en su mensaje; si no, va en la ronda (paso 2).
- **Kit:** en `main`, limpio y al día (`bash scripts/flujo/estado.sh`). `.kit/version` de cada repo es el `HEAD` del kit: con el kit
  sucio no diría la verdad.
- **Herramientas:** `node`, `pnpm`, `git`, `python3` con PyYAML (`python3 -c 'import yaml'`) y la sesión de gh de la cuenta dueña
  (`gh auth token --user <cuenta_github>`, la de `repos[]` de `comun.md`). Docker (`docker info`) no bloquea el arranque, pero sin él
  no se publica (paso 5): dilo en la ronda.
- **La semilla:** la valida el guion (el validador de `scripts/semilla/`, las marcas «verificar» y la auditoría independiente según el
  tamaño). Si se niega, muestra su salida tal cual: el arreglo va en idea-a-semilla, nunca en la semilla a mano.

## 1 · Ensayo

```bash
node scripts/kit/nuevo-proyecto.mjs <slug> [--sumar <rol>] --en-seco
```

Muestra el resumen tal cual: el manifiesto y seis líneas por repo (carpeta, puertos, GitHub, cola, contratos y docs), o una con el
motivo si se salta. Con `--actualizar <rol>` no hay repos que crear: salta a `node scripts/kit/publicar-proyecto.mjs <slug> cola
--actualizar <rol> --en-seco` y al paso 7.

## 2 · La ronda

Una sola, con preguntas de opción, junto al resumen del ensayo:

- (a) «¿Confirmas effort medium?» (si la persona ya lo dijo, no se pregunta).
- (b) «Crear los repos en GitHub: **público** (recomendado: con GitHub Free el auto-merge y la protección de main sólo existen en
  repos públicos; antes se revisa que nada versionado tenga secretos) / **privado** (sólo con un plan de pago) / **no todavía**».

Sin (a), nada. Sin respuesta a (b), o con «no todavía», se crean y verifican en local (pasos 3 y 4) y se para antes de GitHub.

## 3 · Crear

```bash
node scripts/kit/nuevo-proyecto.mjs <slug> [--sumar <rol>]
```

Lo saltado se dice con su motivo. Volver a correrlo es seguro: un repo con carpeta se salta y el manifiesto no cambia.

## 4 · Verificar, por repo creado

```bash
cd <raíz>/z_<slug>/<rol> && pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm db:probar
```

Si cae, para: es un defecto del kit y no se arregla en el repo generado. Dilo con la salida.

## 5 · Base local (Docker), por repo

Con `docker info` en verde, una pila por vez:

1. `pnpm exec supabase start`, `pnpm db:reset` y `pnpm db:types`.
2. Si cambió `src/shared/types/database.types.ts`: `git -C <repo> add src/shared/types/database.types.ts` y
   `git -C <repo> commit -m 'chore(db): generar los tipos de la base desde la pila local'`.
3. `pnpm exec supabase stop` (la RAM).

Sin Docker: «los tipos de la base quedan pendientes y no se publica» (el job `base` del CI caería). Para aquí y di cómo retomar:
con Docker, volver a correr la skill.

## 6 · GitHub

1. `node scripts/kit/publicar-proyecto.mjs <slug> secretos`. Con hallazgos, para: nada se publica.
2. `node scripts/kit/publicar-proyecto.mjs <slug> crear [--privado]`: el repo, los ajustes de calesa-app, `origin` y las etiquetas de
   la cola. Uno que ya existía no se recrea.
3. Por repo, el primer push de main (el hook sólo deja éste: `origin` existe y todavía no tiene main):

   ```bash
   GH_TOKEN=$(gh auth token --user <cuenta>) git -C <raíz>/z_<slug>/<rol> push -u origin main
   ```

   Si el hook lo bloquea con un repo privado (no puede leer el remoto sin credenciales), el push lo hace la persona.

## 7 · Cola

```bash
node scripts/kit/publicar-proyecto.mjs <slug> cola            # o: cola --actualizar <rol>
```

Un issue `cola` por paso, en el orden de todo el proyecto, y el cierre de cada repo. Si se corta (o el límite de la API), volver a
correrlo no duplica: busca por el `paso:` de cada issue.

## 8 · Protección

Por repo, espera su primer CI de main con el token de la cuenta: `gh run list -R <cuenta>/<repo> --branch main -L 1` y
`gh run watch <id> -R <cuenta>/<repo> --exit-status`. Después:

```bash
node scripts/kit/publicar-proyecto.mjs <slug> proteger        # 75: el CI sigue corriendo; vuelve a correrlo cuando termine
```

- Si el CI cayó: lee pronto `gh run view <id> -R <cuenta>/<repo> --log-failed` y cuéntalo. `main` no queda protegido.
- **No** des los comandos del orquestador de un repo sin proteger: sin protección, el auto-merge integra al instante.
- `--aunque-rojo` lo decide la persona, nunca la skill.

## 9 · Cierre

- Una tabla por repo: carpeta, bloque, GitHub, issues (pasos + cierre), CI y protección.
- Por cada repo protegido, el comando exacto, que corre la persona:

  ```bash
  cd <raíz>/z_<slug>/<rol> && bash scripts/orquestador/orquestador.sh verificar && bash scripts/orquestador/orquestador.sh instalar
  ```

- Una vez por máquina, `loginctl enable-linger "$USER"`, y la línea de `NTFY_TEMA` de `scripts/orquestador/README.md` › «Arrancar».
- Pendientes: con `--sumar`, pedir en cada uno de los otros repos una tarea «sincronizar manifiesto» (su copia de
  `.proyecto/proyecto.yaml` no conoce al repo nuevo); lo que quedó sin hacer (Docker, GitHub, protección) y cómo retomarlo.

## Retomar

Volver a correr la skill es seguro: cada paso mira su estado antes de actuar (la carpeta del repo, el commit de los tipos, el repo en
GitHub, `git ls-remote` de main, los issues por `paso:`, la protección).

## Nunca

Arrancar un orquestador · empujar main salvo el primero de un repo nuevo · tocar la semilla · abrir la carpeta de un repo hermano para
otra cosa que crearlo · forzar un push · `--aunque-rojo` sin que la persona lo pida.
