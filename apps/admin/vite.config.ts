import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
const apiTarget = process.env.OLPS_API_PROXY_URL || 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [vue()],
  server: {
    // API 的跨域响应由代理后的管理服务提供。
    cors: false,
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': apiTarget,
      '^/p(?:/|$)': apiTarget,
      '/preview-access': apiTarget,
    },
  },
})
