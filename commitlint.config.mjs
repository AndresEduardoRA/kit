// Tipos en inglés (los consumen las herramientas de changelog y semver).
// Descripción en español, infinitivo, minúscula.
const ERROR = 2 // severidad de commitlint: 0 apagada, 1 aviso, 2 error

const config = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [ERROR, 'always', 'lower-case'],
    'subject-empty': [ERROR, 'never'],
    'subject-full-stop': [ERROR, 'never', '.'],
    'header-max-length': [ERROR, 'always', 72],
    'scope-enum': [
      ERROR,
      'always',
      [
        // semilla-a-repo reemplaza la línea de abajo con los módulos de la semilla y los ids de los carriles de plan.yaml:
        // los commits de un paso van con `tipo(<carril>): …` (la skill piloto y el bucle de Codex).
        // {{SCOPES_MODULOS}}
        // Los de todo proyecto del kit.
        'shared',
        'app',
        'db',
        'ci',
        'deps',
        'config',
        'docs',
        'pasos',
        'piloto',
        'kit',
      ],
    ],
  },
}

export default config
