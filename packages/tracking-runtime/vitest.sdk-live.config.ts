import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['src/**/*.sdk-live.ts'], testTimeout: 120_000 } })
