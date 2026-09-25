// 单端口 HTTP 服务入口：供 App 发布（Sites）使用。
// 先 build，再用 vite preview 起静态服务，显式绑定 0.0.0.0 并监听 $PORT。
//
// 为什么不直接用 `vite preview`：
//   沙箱注入的是 PORT 环境变量，而 vite.config.ts 的 preview.port 是构建期写死的
//   （读 process.env.PORT 只在「跑了 build 的那个进程」里生效）。
//   这里在同一个进程内先 build 再起 preview，并把 PORT 显式传给 preview 的配置，
//   避免「服务起来了但没监听 PORT」的问题。
import { spawnSync } from 'node:child_process'

const port = Number(process.env.PORT ?? 3000)

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

// 1) 构建产物
run('npm', ['run', 'build'])

// 2) 启动预览服务（必须监听 $PORT 且绑定 0.0.0.0）
//    直接调 vite 的 JS API，把 port/host 显式写进 inline config，优先级高于配置文件。
const { preview } = await import('vite')
const server = await preview({
  configFile: false,
  root: process.cwd(),
  build: { outDir: 'dist' },
  preview: { host: '0.0.0.0', port, strictPort: true, allowedHosts: true },
})

server.printUrls()
