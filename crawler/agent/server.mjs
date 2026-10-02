/**
 * 本地抓取助手（crawler/agent/server.mjs）
 *
 * 解决的问题：现在要抓岗位，用户得
 *   cd 到 crawler/ → npm install → 记一长串 --site 参数 → 去找 output 文件 → 回网页手动选
 * 七个卡点，非程序员基本走不通。
 *
 * 这个服务把上面整条链变成**网页上点一个按钮**：
 *   网页  ──POST /crawl──▶  本地助手  ──spawn──▶  crawler/run.mjs（还是你的电脑在爬）
 *         ◀──任务状态────            ◀──stdout──
 *
 * 设计边界（与项目原有原则一致，不冲突）：
 *   · **爬虫仍然跑在用户自己的电脑上**，只是多了个「被网页叫醒」的本地进程
 *   · 服务只监听 127.0.0.1，**不对外暴露**
 *   · 只接受来自工作台那个域名的请求（Origin 白名单）
 *   · **不做导入**：抓到的 JSON 原样返回，由网页端带着自己的 token 入库 ——
 *     这样本地助手**永远不碰用户的凭据**
 *
 * 用法：
 *   node crawler/agent/server.mjs              # 默认 127.0.0.1:8787
 *   node crawler/agent/server.mjs --port 9000
 */
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CRAWLER_DIR = path.join(HERE, '..')
const OUT_DIR = path.join(CRAWLER_DIR, 'output')

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i >= 0 ? process.argv[i + 1] : d
}
const PORT = Number(arg('port', '8787'))
const HOST = '127.0.0.1'

// 只允许工作台来调。本地开发端口也放进来，方便自测。
const ALLOWED_ORIGINS = [
  'https://internship-workbench-47024.app.workbuddy.host',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

/** 任务表：一次只跑一个抓取（爬虫要开真浏览器，并行会互相踩） */
const tasks = new Map()
let running = null

const uid = () => Math.random().toString(36).slice(2, 10)

function json(res, code, body, origin) {
  const h = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin
    h['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
    h['Access-Control-Allow-Headers'] = 'Content-Type'
    // Chrome 的 Private Network Access：HTTPS 页面调 http://127.0.0.1 必须显式允许
    h['Access-Control-Allow-Private-Network'] = 'true'
  }
  res.writeHead(code, h)
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) {
    chunks.push(c)
    if (Buffer.concat(chunks).length > 1e6) throw new Error('请求体过大')
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'))
}

/** 列出 output/ 里最近产出的抓取文件 */
async function recentOutput(limit = 12) {
  try {
    const names = await readdir(OUT_DIR)
    const files = []
    for (const n of names) {
      if (!/\.(json|txt)$/.test(n) || n.startsWith('.')) continue
      const s = await stat(path.join(OUT_DIR, n))
      files.push({ name: n, size: s.size, mtime: s.mtimeMs })
    }
    return files.sort((a, b) => b.mtime - a.mtime).slice(0, limit)
  } catch {
    return []
  }
}

async function readJobsOutput() {
  // 抓取器写出的 JSON 结构：{ site_id, count, jobs: [...] }
  const out = []
  for (const f of await recentOutput(6)) {
    if (!f.name.endsWith('.json')) continue
    try {
      const raw = await readFile(path.join(OUT_DIR, f.name), 'utf-8')
      const d = JSON.parse(raw)
      if (Array.isArray(d.jobs)) out.push({ file: f.name, site: d.site_id, count: d.count, jobs: d.jobs })
    } catch {
      /* 忽略坏文件 */
    }
  }
  return out
}

/** 启动一次抓取：spawn 项目自带的 run.mjs —— 用的就是它自己的能力 */
function startCrawl(opts) {
  if (running) throw new Error(`已经有一个抓取在跑（${running.id}），等它结束再开`)

  const id = uid()
  const args = ['run.mjs']
  for (const s of opts.sites ?? []) args.push('--site', String(s))
  if (opts.keyword) args.push('--keyword', String(opts.keyword))
  args.push('--pages', String(opts.pages ?? 1))
  args.push('--limit', String(opts.limit ?? 20))
  args.push('--mode', String(opts.mode ?? 'all'))
  args.push('--detail', String(opts.detail ?? 0))

  const task = {
    id,
    args: args.join(' '),
    state: 'running',
    startedAt: Date.now(),
    endedAt: null,
    log: [],
    error: null,
    result: null,
  }
  tasks.set(id, task)
  running = task

  const child = spawn(process.execPath, args, { cwd: CRAWLER_DIR, windowsHide: true })
  const push = (line) => {
    const t = String(line).trimEnd()
    if (!t) return
    task.log.push(t)
    if (task.log.length > 400) task.log.splice(0, task.log.length - 400)
    process.stdout.write(`  [${id}] ${t}\n`)
  }

  child.stdout.on('data', (b) => String(b).split(/\r?\n/).forEach(push))
  child.stderr.on('data', (b) => String(b).split(/\r?\n/).forEach(push))

  child.on('error', (e) => {
    task.state = 'failed'
    task.error = String(e.message ?? e)
    task.endedAt = Date.now()
    running = null
  })

  child.on('close', async (code) => {
    task.endedAt = Date.now()
    if (code === 0) {
      task.state = 'done'
      task.result = { outputs: await readJobsOutput() }
    } else {
      task.state = 'failed'
      task.error = `run.mjs 退出码 ${code}`
    }
    running = null
  })

  return task
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin
  const url = new URL(req.url, `http://${HOST}:${PORT}`)

  if (req.method === 'OPTIONS') {
    return json(res, 204, {}, origin)
  }
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json(res, 403, { error: '来源不被允许' }, origin)
  }

  try {
    if (url.pathname === '/health') {
      return json(res, 200, {
        ok: true,
        service: '实习工作台 · 本地抓取助手',
        crawler: CRAWLER_DIR,
        busy: running ? running.id : null,
        outputs: (await recentOutput(5)).map((f) => f.name),
      }, origin)
    }

    if (url.pathname === '/sites') {
      // ⚠️ 必须用 pathToFileURL —— Windows 上传裸路径给 import() 会 500。
      // 项目 HANDOFF 里记过同一个坑（手拼 file:// 会少一道斜杠）。
      const { SITES } = await import(pathToFileURL(path.join(CRAWLER_DIR, 'sites.mjs')).href)
      return json(res, 200, {
        sites: SITES.map((s) => ({
          id: s.id, name: s.name, needsLogin: !!s.needsLogin,
          verified: s.verified ?? '', kwSearch: String(s.listUrl ?? '').includes('{kw}'),
        })),
      }, origin)
    }

    if (url.pathname === '/outputs') {
      return json(res, 200, { files: await recentOutput(20) }, origin)
    }

    if (url.pathname === '/crawl' && req.method === 'POST') {
      const body = await readBody(req)
      if (!Array.isArray(body.sites) || !body.sites.length) {
        return json(res, 400, { error: 'sites 不能为空' }, origin)
      }
      const t = startCrawl(body)
      return json(res, 202, { taskId: t.id, command: `node ${t.args}` }, origin)
    }

    const m = url.pathname.match(/^\/crawl\/([a-z0-9]+)$/)
    if (m) {
      const t = tasks.get(m[1])
      if (!t) return json(res, 404, { error: '没有这个任务' }, origin)
      return json(res, 200, t, origin)
    }

    return json(res, 404, { error: 'not found' }, origin)
  } catch (e) {
    return json(res, 500, { error: String(e.message ?? e) }, origin)
  }
})

server.listen(PORT, HOST, () => {
  console.log('')
  console.log('  实习工作台 · 本地抓取助手')
  console.log(`  监听 http://${HOST}:${PORT}`)
  console.log(`  抓取器 ${CRAWLER_DIR}`)
  console.log('')
  console.log('  端点：')
  console.log('    GET  /health          健康检查 + 最近产出')
  console.log('    GET  /sites           站点表（同 crawler/sites.mjs）')
  console.log('    POST /crawl           开始抓取  { sites:[], keyword, pages, limit, mode }')
  console.log('    GET  /crawl/:id       任务状态 + 日志 + 结果')
  console.log('')
  console.log('  爬虫跑在你自己的电脑上；本服务只监听 127.0.0.1，不对外暴露。')
  console.log('')
})
