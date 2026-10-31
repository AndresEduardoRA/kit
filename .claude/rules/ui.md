---
paths:
  - 'src/app/**/*.tsx'
  - 'src/modules/**/features/**/*.tsx'
  - 'src/shared/ui/**'
---

# Interfaz

Antes de construir una pantalla, lee su fila en `docs/UX.md` (patrón, roles, estados propios) y
`docs/semilla/semilla.md` › Sistema de diseño (tokens, componentes, montos y fechas).

## Estados y formularios

- Toda vista de datos resuelve: cargando (esqueleto si tarda > 300 ms), vacío por primera vez, vacío
  por filtro, error con reintentar y sin permiso; si edita, conflicto `PT409`. Usa los estados de
  `src/shared/ui/`; no inventes uno por pantalla.
- Filtros, orden, pestaña, vista y registro abierto viven en la URL con `nuqs`
  (`useQueryStates`, `shallow: false`), nunca en estado local ni en un store.
- Si el envío falla, los valores quedan y el foco va al primer error; un formulario de más de 6
  campos guarda borrador en `sessionStorage` por clave de formulario.
- Envío deshabilitado mientras la acción está en curso (`useAction`); nunca doble envío. Un
  formulario que se reemplaza al llegar lo guardado (`key` con la versión) apaga sus campos mientras
  guarda.
- Formularios en bloques plegables con título; los secundarios nacen plegados. Su cuerpo es una
  grilla `minmax(0, 1fr)`.

## Destructivas, paneles y modales

- Reversible: hacer + toast con «Deshacer» (sonner). Irreversible: una confirmación que nombra el
  objeto. Masiva irreversible: confirmación tipeada. Nunca `window.confirm`.
- Toda confirmación, panel (drawer) o modal tiene su URL (`?panel=`), revisa al abrir que el objeto
  sigue igual y se monta una vez por pantalla.
- Todo panel con formulario avisa de cambios sin guardar al salir; su pie va dentro del panel.
- Ningún modal abre otro modal: el segundo nivel es un panel o una página.
- Un panel que debe deslizarse se monta cerrado y no se vuelve a montar mientras lee; un cuerpo que
  cambia (esqueleto, error, formulario) cambia dentro del mismo panel.
- Los avisos (toasts) no tapan contenido ni el pie de un panel; se comprueba en e2e.

## Listas

- Toda lista de registros usa el patrón de `@/shared/ui/lista`: una sola vista elegida en el servidor
  (tabla desde 768 px, tarjetas debajo), nombre a la izquierda, «⋯» a la derecha, tabla con
  `w-max min-w-full`.
- El clic en la fila abre su resumen (`?<registro>=<id>`) salvo casilla, «⋯», enlace o botón propio
  (`data-no-abre`). Con teclado, un botón con el nombre del registro.
- Una lista de tarjetas no ensancha la página con el texto al 200 %: `<ul>` con
  `grid-cols-[minmax(0,1fr)]`, `<li>` con `min-w-0`, `flex-wrap` en barras que se parten. Se comprueba
  en e2e que no hay scroll horizontal.
- Una barra o un cuerpo que se desplaza muestra una pista de que hay más (sombra o flecha).

## Estilo y texto

- Ningún componente usa `transition-all`; un botón o pestaña usa `transition`. El cambio de estado de
  un badge es de golpe.
- Con el texto al 200 % nada se sale de su lugar: blancos táctiles de 44 px en px (no `size-11`),
  menús con `max-w-(--available-width)`, interruptores en rem. Se verifica en e2e con
  `document.documentElement.style.fontSize = '200%'` y, lo que se juzga mirando, con `E2E_CAPTURAS`.
- Montos, números y fechas con `src/shared/lib/formato.ts`; números a la derecha con `tabular-nums`;
  nunca `toFixed`. Todo monto pasa por el componente de montos que define el sistema de diseño.
- Estados de entidad con badge texto + color, nunca sólo color; los colores que configura el
  usuario vienen de la fila, no del código.
- Las acciones visibles salen de `puede(permisos, clave, alcance)` de `@/shared/lib/permisos` y de la
  función de transiciones del flujo; no hay `if (rol === …)` en componentes.
- Fechas cruzan servidor a cliente como string ISO; nunca `Date` en props.
- Textos con los términos de `docs/GLOSARIO.md`, sin exclamaciones ni mayúsculas sostenidas, en el
  idioma y registro que fija la semilla (por defecto, español neutro con tuteo); igual para los
  `raise exception` de la base.
- Transiciones de página con `<Link>` + View Transitions; respeta `prefers-reduced-motion`.

## Microdecisiones

- Un texto, un espacio, un icono, el orden de dos botones o el tamaño de un vacío no se preguntan:
  se deciden con `docs/UX.md`, `docs/GLOSARIO.md` y el patrón más parecido que ya exista, y se dicen
  en `docs/pasos/<PASO>/decisiones.md`. Se pregunta sólo lo que cambia un flujo, lo que ve o puede un
  rol, o un dato que se guarda.
