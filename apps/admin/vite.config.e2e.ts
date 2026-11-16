import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'

const apiTarget = process.env.OLPS_E2E_API_URL ?? 'http://127.0.0.1:8788'

export default mergeConfig(base, {
  server: {
    host: '127.0.0.1',
    port: Number(process.env.OLPS_E2E_ADMIN_PORT ?? '5175'),
    strictPort: true,
    proxy: {
      '/api': apiTarget,
      '^/p(?:/|$)': apiTarget,
      '^/preview(?:/|$)': apiTarget,
      '^/preview-access(?:/|$)': apiTarget,
    },
  },
})
