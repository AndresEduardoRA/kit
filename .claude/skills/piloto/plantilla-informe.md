# Informe del paso <PASO> — <título>

> Lo escribe la sesión del paso en `.piloto/informes/<paso>.md` y lo contrasta el `auditor` con el repo. Sólo lo verificable: cada afirmación lleva su ruta.

## Qué se hizo

Por commit (sha corto y asunto): qué cambió y por qué, y qué ID de `decisiones` aplica. Lo que se partió o se dejó, con el paso propuesto
donde sigue.

## Verificación

Una fila por cosa que se corrió. **La salida real**, no un resumen: la ruta del `tee` en `.piloto/salidas/<paso>/`, y los números
(pruebas, fallas, saltadas).

| Qué                                       | Resultado | Salida |
| ----------------------------------------- | --------- | ------ |
| `pnpm lint`                               |           |        |
| `pnpm typecheck`                          |           |        |
| `pnpm test`                               |           |        |
| `bash scripts/mapa.sh --check`            |           |        |
| `pnpm db:probar` (si se tocó `supabase/`) |           |        |
| e2e dirigidos (specs y proyectos)         |           |        |
| Nivel 2 / 3 (si le tocó)                  |           |        |
| `verificacion.comando` del paso           |           |        |

- **Saltadas:** `git diff <rango> | grep -nE '\.(skip|fixme|only)\('`. Cero nuevas sin motivo.
- **Pruebas rojas primero:** dónde quedaron guardadas, contra HEAD.
- **Mutaciones:** cada una con la prueba que cayó (o «sobrevive» y qué se hizo).
- **Terminado:** el criterio del paso y la prueba que lo demuestra.

## Notas

`docs/pasos/<PASO>/bitacora.md` con su marcador (`e2e completo: sí|no (…)`), `docs/pasos/<PASO>/decisiones.md` con sus fechas (y la
autoelección ámbar tal cual, si hubo), las fichas y el glosario si cambiaron. `git diff --name-only <rango>` dentro de las rutas del paso.

## Lo que no se hizo

Explícito. Un nivel que no se corrió se dice; no se da por pasado.

## Para la persona

Lo que conviene mirar y, si hay una decisión pendiente, cuál y con qué recomendación.
