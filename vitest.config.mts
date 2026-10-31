import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

// `pnpm test` corre esto y después las pruebas del kit con `node --test` (`pnpm test:kit`).
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'supabase/tests/**/*.test.ts'],
    // Vitest NO puede testear Server Components async. Esos van a Playwright (e2e/).
    exclude: [
      '**/node_modules/**',
      '**/e2e/**',
      '**/.next*/**',
      '.piloto/**',
      '.claude/worktrees/**',
    ],
    passWithNoTests: true,
    coverage: { include: ['src/modules/*/entities/**'] },
  },
})
