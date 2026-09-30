// 仅供 Docker 镜像使用：零依赖静态服务，直接吐 dist/。
// 为什么不用 scripts/serve.mjs（build + vite preview）：
//   preview 需要 vite 及其全部依赖进运行时镜像，体积大一个量级；
//   本应用是 hash 路由（window.location.hash），没有 history 路由回退需求，
//   一个零依赖静态服务就够了。PORT 环境变量、0.0.0.0 绑定与 serve.mjs 同口径。
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const port = Number(process.env.PORT ?? 3000)
const root = join(process.cwd(), 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let rel = decodeURIComponent(url.pathname)
    if (rel === '/') rel = '/index.html'
    const file = normalize(join(root, rel))
    if (!file.startsWith(root)) {
      res.writeHead(403).end()
      return
    }
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`[serve-dist] serving dist/ at http://0.0.0.0:${port}`)
})
