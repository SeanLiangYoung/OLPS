import { defineConfig } from '@playwright/test'

const adminBase = process.env.OLPS_ADMIN_URL ?? 'http://127.0.0.1:5173'
const apiBase = process.env.OLPS_API_URL ?? 'http://127.0.0.1:8787'

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: adminBase,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  metadata: { apiBase },
})
