import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { specAlKit } from './flujo.mjs'

// La tarea del kit que sale de un PR de un proyecto (flujo.mjs › specAlKit) con su yaml limpio. Los topes, en mezcla.test.ts.

it('no reemplaza en los comentarios del frontmatter: una lección con «: » no se vuelve una clave del yaml', () => {
  const plantilla = readFileSync('scripts/orquestador/plantillas/traer-de-proyecto.md', 'utf8')
  const spec = specAlKit(plantilla, {
    repoGh: 'Cuenta/tienda-app',
    nombre: 'tienda-app',
    pr: '41',
    toca: {
      rutas: ['scripts/flujo/a.sh'],
      kit: ['- No reinicies el servicio: se relanza solo. (kit)'],
      semilla: [],
    },
  })
  const frontmatter = spec.split('\n---\n')[0] ?? ''
  expect(frontmatter).toContain('{{LECCIONES}}')
  expect(frontmatter).not.toContain('No reinicies')
  expect(frontmatter).not.toContain('scripts/flujo/a.sh')
  expect(frontmatter).toContain('titulo: traer de tienda-app el PR #41')
  expect(spec.slice(frontmatter.length)).toContain(
    '- No reinicies el servicio: se relanza solo. (kit)',
  )
})
