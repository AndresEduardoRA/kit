---
id: {{ID}}
# Mientras diga «borrador: si» el orquestador no la lanza. Bórrala cuando la spec esté lista.
borrador: si
titulo: qué cambia, en una frase en infinitivo (va en el aviso y en el PR)
rama: feat/{{TEMA}}
depende:
conflicto:
planificar: no
modelo: sonnet
effort: high
---

## Pedido de la persona

«Lo que pediste, con tus palabras.»

## Objetivo

Qué tiene que poder hacer quien usa el sistema al terminar.

## Decisiones ya tomadas

- Lo que ya decidiste (la sesión no pregunta: si falta una decisión, queda trabada y te avisa).

## Anclajes

Módulos, features, RPC o pantallas donde está lo que se toca.

## Estados no felices

Sin permiso · vacío · conflicto (`PT409`) · sin red.

## Verificación

Qué prueba deja verde la tarea (e2e del camino feliz, tests de `entities/`, `db:probar`).
