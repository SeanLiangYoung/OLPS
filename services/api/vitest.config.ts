import path from 'node:path'
import { defineConfig } from 'vitest/config'

const repoRoot = path.resolve(__dirname, '../..')

export default defineConfig({
  test: {
    setupFiles: ['./src/test-support/vitest-setup.ts'],
    globalSetup: ['./src/test-support/vitest-global-setup.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
  resolve: {
    alias: {
      '@olps/domain': path.resolve(repoRoot, 'packages/domain/src/index.ts'),
      '@olps/sync': path.resolve(repoRoot, 'packages/sync/src/index.ts'),
      '@olps/site-builder': path.resolve(repoRoot, 'packages/site-builder/dist/index.js'),
    },
  },
})
