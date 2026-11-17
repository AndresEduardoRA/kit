---
paths:
  - 'contratos/**'
  - '.proyecto/contratos/**'
  - '.proyecto/proyecto.yaml'
---

# Contratos entre repos

Un contrato de base es lo que un repo (el proveedor) promete a otros (los consumidores) sobre un esquema de su base: las vistas con
sus columnas y tipos, las RPC con los nombres, tipos y defaults de sus parámetros y su retorno, los tipos propios que usan (enum,
compuesto, dominio) y los permisos efectivos de `anon`, `authenticated` y `service_role`. Ninguna CI mira la base de otro repo ni una
en la nube: el proveedor prueba su base local contra sus versiones; el consumidor, su código contra su copia fijada. Hoy sólo
`tipo: base`; `http` y `archivo` dan «todavía no soportado».

## Quién escribe cada archivo

| Archivo                                                         | Repo       | Quién                                              |
| --------------------------------------------------------------- | ---------- | -------------------------------------------------- |
| `.proyecto/proyecto.yaml` › `contratos[]` (`vigentes` incluido) | los dos    | el proyecto: una tarea «sincronizar manifiesto»    |
| `provee: [<id>@<n>]` y `consume: [<id>@<n>]` de su repo         | cada uno   | quien cambia el contrato; una versión por contrato |
| `contratos/<id>.config.json` (`{ "esquema", "objetos" }`)       | proveedor  | a mano: las vistas y funciones que expone          |
| `contratos/<id>@<n>.json`                                       | proveedor  | `pnpm contrato:generar` (la versión de `provee`)   |
| `.proyecto/contratos/<id>@<n>.json`                             | consumidor | la copia, tal cual sale de main del proveedor      |
| `src/shared/types/contratos/<id>.ts`                            | consumidor | `pnpm contrato:tipos`                              |

## Reglas

- **Una versión publicada no cambia nunca**: lo nuevo es `<id>@<n+1>`. La guarda `scripts/guardas/contratos-publicados.test.ts`
  compara contra main (también las copias fijadas) y `contrato:generar` se niega a reescribir una versión publicada.
- **Nunca dos repos en una sesión.** Un cambio de contrato son dos o tres tareas, una por repo, en el orden de abajo.
- El esquema es propio del contrato, nunca `public` (el consumidor no distinguiría sus RPC de las del proveedor), y va en
  `[api] schemas` de `supabase/config.toml` (y en la nube) para que PostgREST lo exponga.
- `objetos` lista vistas y funciones, no tablas. Una función tiene una sola firma (un `create or replace` con otros argumentos deja
  dos: `drop function` primero) y todos sus parámetros con nombre (PostgREST llama por nombre).
- Los tipos que usan los objetos son del mismo esquema y entran solos; uno de otro esquema (`public.x`, `extensions.citext`) se
  castea o se mueve al esquema.
- Los permisos son los efectivos (incluyen PUBLIC): una función sin `revoke execute … from public` sale con `execute` para `anon`.
  La migración del proveedor escribe sus `revoke` y `grant` explícitos.

## El orden de un cambio

1. **Agregar en el proveedor:** la migración (lo nuevo junto a lo viejo), la configuración si suma objetos, `provee: <id>@<n+1>` y
   `vigentes` con las dos, `pnpm db:reset`, `pnpm contrato:generar` y `pnpm contrato:probar`.
2. **Adoptar en el consumidor:** copiar `<id>@<n+1>` de main del proveedor, cambiar `consume`, borrar la copia `<n>`,
   `pnpm contrato:tipos`, adaptar `infra/` y `pnpm contrato:usar`.
3. **Quitar lo viejo cuando nadie usa `<n>`:** sacarla de `vigentes` (tarea «sincronizar manifiesto») y borrar en el proveedor el
   objeto viejo (otra migración) y `contratos/<id>@<n>.json`.

Traer la copia (sin comando propio):

```bash
GH_TOKEN=$(gh auth token --user <dueña>) gh api repos/<github>/contents/contratos/<id>@<n>.json --jq .content \
  | base64 -d > .proyecto/contratos/<id>@<n>.json
```

## Qué rompe una versión (`contrato:probar`)

Tener más está bien en objetos, columnas y campos; no en permisos ni en valores de enum (un valor nuevo rompe al que lee).

| Cambio en la base frente a la versión                                           | Resultado |
| ------------------------------------------------------------------------------- | --------- |
| Columna o campo de más; vista o RPC nueva                                       | Pasa      |
| Columna o campo que falta o cambió de tipo; vista, RPC o tipo que falta         | Cae       |
| Parámetro renombrado, que cambió de tipo o perdió su default; nuevo sin default | Cae       |
| Parámetro que ganó default, o nuevo con default (el orden no importa)           | Pasa      |
| Retorno: `conjunto` o tipo distinto, o una columna que falta                    | Cae       |
| Permisos por rol distintos (de más o de menos), incluido el uso del esquema     | Cae       |
| Valores de un enum distintos                                                    | Cae       |

## El consumidor

- Llama encadenado y con literales: `supabase.schema('<esquema>').rpc('<rpc>', { p_a, p_b: x })` y
  `supabase.schema('<esquema>').from('<vista>')`. Un nombre, un esquema o unos parámetros que no son literales (una variable, un
  spread), o un `.schema()` guardado en una variable, son error de `contrato:usar`.
- Un `.rpc('x')` suelto o con `.schema('public')` es de la base propia: lo cubre `typecheck` contra `database.types.ts`.
- Tipa el cliente con `Database & Contrato<Id>` (`createClient<Database & ContratoAgenda>(…)`); cablearlo en
  `src/shared/lib/supabase` es del consumidor.
- Límite: `contrato:usar` no revisa las columnas de un `.select('…')`; los tipos generados sí, por `typecheck`.

## Comandos y CI

`pnpm contrato:generar [<id>]` y `pnpm contrato:probar` leen la base local (después de `pnpm db:reset`) con candado; si la pila está
apagada dicen cómo levantarla. `pnpm contrato:tipos` y `pnpm contrato:usar` sólo leen archivos. En el CI, el job `contrato` (el
proveedor: pila, reset y `probar`, sólo si el repo provee algo) y `contrato-uso` (el consumidor: `usar` y los tipos sin diff).
