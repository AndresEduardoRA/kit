# Módulos

Aquí vive cada módulo del monolito modular. Cuáles hay y de quién depende cada uno lo dice `docs/semilla/semilla.md` › Técnica, y
`docs/MAPA.md` los muestra (`pnpm mapa`). Crear un módulo nuevo es una decisión de arquitectura: si el paso no lo trae, se pregunta.

```
src/modules/<modulo>/
  CLAUDE.md          la ficha: qué hace, entra y sale, tablas (sin ficha, `bash scripts/mapa.sh --check` falla)
  index.ts           la entrada de servidor (`@/modules/<modulo>`): sesión, lecturas, actions, reglas y tipos; sin componentes
  client.ts          la entrada de cliente (`@/modules/<modulo>/client`): hooks, componentes de cliente y tipos de entities
  shell.ts           (si hace falta) lo que dibuja el marco de toda pantalla; sólo lo importa el layout `(app)`
  pantallas/<p>.ts   lo que dibuja una pantalla; sólo lo importa `src/app`
  entities/          cero I/O: tipos, schemas Zod, `puede()`, transiciones y fórmulas, con su test al lado
  features/<caso>/   components/, hooks/, actions/, schemas/
  infra/             queries/*.ts (`server-only`) y *.client.ts (navegador)
```

Las reglas completas: `.claude/rules/modulos.md`. Las fronteras las cuida `eslint.config.mjs` (`eslint-plugin-boundaries`).
