import { readFileSync } from 'node:fs'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { appVersionPlugin } from './scripts/appVersionPlugin.mjs'

const port = Number(process.env.PORT ?? 4173)
// 版本号只有一个来源：package.json。这里读它而不是写死，是因为这条 meta 的用途就是
// 「证明线上跑的是哪一版」——写死的标记升级之后会变成假证据。
const appVersion = String(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? '')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), appVersionPlugin(appVersion)],
  // 部署到单端口 HTTP 服务：绑定 0.0.0.0 并放开反向代理 Host 校验
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  preview: { host: '0.0.0.0', port, allowedHosts: true },
})
