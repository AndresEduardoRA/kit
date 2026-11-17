# Lecciones para hacer semillas

Lo que un proyecto real enseñó sobre cómo escribir semillas, planes y manifiestos. idea-a-semilla lo lee **antes de la
Fase 2 de cada semilla nueva** y convierte cada lección en una pregunta de la plantilla o en una comprobación de la Fase 5.
Cuando una lección se puede comprobar con código, pasa a `validar_semilla.py` y aquí queda la línea con «(validador)».

**Cómo entra una lección.** De tres lugares, siempre como regla y no como historia:
- una tarea que quedó **trabada** porque a la semilla le faltaba una decisión;
- una **«decisión tomada sin preguntar»** en el cuerpo de un PR que el dueño habría querido decidir;
- la **retro del cierre de construcción**: la sección `## Retro` del PR «cerrar la construcción» de cada repo
  (`gh pr list --state merged --search 'cerrar la construcción in:title'`), con cada hallazgo clasificado; los «hueco de la semilla»
  llegan además como líneas `(semilla)` del `docs/LECCIONES.md` del repo.

Formato: `- Haz/Evita X: porque Y. (proyecto, de dónde salió)`. Si deja de aplicar, se borra.

## Plan y pasos

- Parte en la semilla todo paso con más de un criterio de terminado: un paso que se parte durante la construcción desordena
  las dependencias de los que vienen. (calesa-web, P01 se partió en P01 y P22–P25)
- Evita más carriles que la mitad de los pasos: cada carril es una pila de Supabase y una sesión, y casi todos quedan
  esperando dependencias. (calesa-web: 11 carriles para 21 pasos)
- Haz que un consumidor de contrato espere al paso que lo publica, con `depende_de: <rol>:<paso>`. (validador)
- Un paso rojo va con nivel capaz, effort high o más, plan antes y revisor. (validador)

## Entre repos

- Evita que un repo nombre la carpeta de otro (`../ip`): al mover carpetas se rompe y obliga a abrir los dos. Lo que se
  comparte va en un contrato con copia fijada. (z_ip/web)
- Evita probar un contrato contra una base real con un secreto: el proveedor prueba su base local y el consumidor su copia
  fijada. (z_ip/web, `verificar-contrato.mjs`)
- Declara en «Repos y fronteras» qué NO comparten los repos: evita que alguien invente un contrato que no hace falta.
  (calesa: app y web sólo comparten la marca)

## Rutas, nombres y modelos

- Evita rutas fijas en skills y scripts: se calculan desde la carpeta vinculada o desde el kit. (reorganización del 2026-11-16)
- Usa un solo nombre por repo, `<proyecto>-<rol>`, en GitHub, servicios, contenedores y docs. (calesa-app tenía cuatro nombres)
- Nombra niveles de modelo (rapido, normal, capaz), nunca versiones: las versiones vencen. (validador)

## GitHub

- Crea los repos públicos si la cuenta es GitHub Free: auto-merge y protección de main sólo existen ahí para repos públicos, y el flujo depende de los dos. Antes, revisa que la historia no tenga secretos. (kit, K01)
- Deja que la persona haga el primer push de main de un repo nuevo, o usa la excepción acotada del hook: ninguna sesión empuja main. (kit, K01)
- En un repo público, sólo cuenta lo que escribe quien puede escribir en el repo: issues y comentarios de otras cuentas
  nunca entran a la cola ni al prompt de una sesión autónoma. (kit, K05)

## Después de construir

- Haz que el cierre de construcción deje un ESTADO de 60 líneas como máximo: un ESTADO de cientos de KB lo paga cada sesión.
  (z_ip: 278 KB y 238 KB)

## Verificación y flujo

- Haz que toda comprobación que pida una spec corra también en el CI: shellcheck lo pedían K05, K06 y K11, no estaba
  instalado ni en el CI, y K05 se integró sin pasarlo. (kit, K05)
- Haz que lo que corre solo se ponga al día solo: el orquestador corría desde la principal sin actualizar, así que cada
  mejora suya integrada seguía sin usarse hasta un pull a mano. (kit, K05)
- En archivos que el generador copia a un proyecto nuevo, nombra las skills por su función, no por su nombre: la guarda del
  generador rechaza los nombres del flujo viejo y tumbó el primer CI de K05 por «piloto-prompts». (kit, K05)
