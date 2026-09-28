import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./src/test-support/vitest-setup.ts'],
    globalSetup: ['./src/test-support/vitest-global-setup.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
  },
  server: {
    fs: {
      allow: [
        path.resolve(__dirname, '../..'),
        path.resolve(__dirname, '../../../remote'),
        path.resolve(__dirname, '../../../builder'),
      ],
    },
  },
  resolve: {
    alias: {
      '@olps/domain': path.resolve(__dirname, '../../packages/domain/src/index.ts'),
      '@olps/sync': path.resolve(__dirname, '../../../remote/packages/sync/src/index.ts'),
      '@olps/site-builder': path.resolve(
        __dirname,
        '../../../builder/packages/site-builder/dist/index.js',
      ),
    },
  },
})
