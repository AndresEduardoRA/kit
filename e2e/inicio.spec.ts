import { expect, test } from '@playwright/test'

// El humo de la app base: la página de inicio carga y dice que el proyecto está listo. Lo reemplaza el primer paso con pantallas.
test('E2E inicio: la página de inicio carga', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('El proyecto está listo')).toBeVisible()
})
