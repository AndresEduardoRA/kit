# shared

Infraestructura transversal sin reglas de negocio: clientes de Supabase, errores como valores, formato de números y fechas, paginación, configuración, correo y los componentes de interfaz que usan todos los módulos.

## Entra y sale

- Entra: nada de `src/modules` ni de `src/app`. `shared` sólo importa `shared`.
- Sale: lo consumen `app/` y las tres capas de cada módulo.

## Archivos clave

- `lib/supabase/` — `server.ts` (`createClient()`, uno por request), `browser.ts`, `admin.ts` (secret key, salta la RLS), `proxy.ts` (`actualizarSesion()`).
- `lib/safe-action.ts` — `actionClient` (exige sesión; `ctx` trae `supabase` y `usuarioId`) y `actionClientPublico`. Toda mutación entra por acá.
- `lib/errores.ts` — `Resultado<T>`, `ok()`, `fallo()`, `conflicto()`, `errorDePostgrest()` (`PT409` → conflicto, `42501` → sin_permiso, `23505` → duplicado), `datosO()`.
- `lib/formato.ts`, `lib/fechas.ts` — todo número y toda fecha salen de acá, en el locale y la zona del proyecto.
- `lib/paginacion.ts` — el tamaño de toda página sale de acá (`TAMANOS_DE_PAGINA`, `tamanoDePagina()`, `TAMANO_DE_VER_MAS`, `TOPE_DE_LO_CARGADO`); keyset `leerCursor()`, `codificarCursor()`, `armarPagina()`.
- `lib/conteo.ts` — un número que se muestra nunca es un total exacto: `conteoAcotado()`, `cantidadAcotada()`, `cortarAlTope()`, `textoDelTope()`.
- `lib/email/` — `enviarEmail()`: la única puerta del correo; un adaptador REST por proveedor (`EMAIL_PROVEEDOR`; hoy `mailpit`).
- `config/esquemas.ts` — el entorno en Zod (puro): públicas, servidor y demo; lo usan `entorno.ts`, `servidor.ts`, `next.config.ts` y `pnpm env:check`. `config/app.ts`: nombre, descripción y las copias de los colores.
- `ui/diferido.tsx` — `diferido()`: el único lugar que carga código diferido (el lint prohíbe `next/dynamic`).
- `ui/button.tsx`, `ui/aviso.tsx` — lo mínimo que usan `diferido()` y `not-found`; los de shadcn los reemplazan con la misma API.
- `types/database.types.ts` — generado por `pnpm db:types`. No se edita.

## No se rompe

- `shared` no importa módulos: locale, moneda, zona horaria, nombre y color entran por props desde `app/`.
- Los clientes de Supabase sólo desde `lib/supabase/` y `infra/` de un módulo. Ningún componente ni hook los usa.
- Todo número pasa por `formato.ts` y toda fecha por `fechas.ts`; `toFixed` está prohibido por lint.
- Nada anima `font-size` ni el alto: sin `transition-all`.

## Ojo

- `admin.ts` importa `server-only`; el lint sólo deja importarlo desde los archivos de `DONDE_SE_PERMITE_EL_ADMIN` (`eslint.config.mjs`; hoy, ninguno).
- `entornoPublico()` valida al primer uso; las `NEXT_PUBLIC_*` se leen con el nombre literal.
- Los textos hablan de tú, también los `MENSAJE_*` de `errores.ts`.
- `vitest` no limpia solo entre pruebas: un test que monta diálogos usa `afterEach(cleanup)`.
