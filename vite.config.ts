import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const port = Number(process.env.PORT ?? 4173)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 部署到单端口 HTTP 服务：绑定 0.0.0.0 并放开反向代理 Host 校验
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  preview: { host: '0.0.0.0', port, allowedHosts: true },
})
