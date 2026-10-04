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
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { checkInstall, formatProblems } from './selfcheck.mjs'
import { DEFAULT_SCHEDULE, dueNow, localDay, normalizeSchedule, scheduleSummary } from './scheduler.mjs'

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

// —— 定时抓取（每天自动跑一次，结果落 output/）——
const SCHEDULE_FILE = path.join(CRAWLER_DIR, '.schedule.json')
/** 默认关闭：要不要每天跑得用户自己决定 */
let schedule = { ...DEFAULT_SCHEDULE, lastRun: null }

async function siteIds() {
  const { SITES } = await import(pathToFileURL(path.join(CRAWLER_DIR, 'sites.mjs')).href)
  return SITES.map((s) => s.id)
}

async function loadSchedule() {
  try {
    const raw = JSON.parse(await readFile(SCHEDULE_FILE, 'utf8'))
    const next = normalizeSchedule(raw, await siteIds())
    if (next) schedule = { ...next, lastRun: raw.lastRun ?? null }
  } catch {
    /* 没有配置文件 / 读坏了：保持默认（关闭），不猜 */
  }
}

async function saveSchedule() {
  try {
    await writeFile(SCHEDULE_FILE, JSON.stringify(schedule, null, 1), 'utf8')
  } catch (e) {
    console.log('[schedule] 配置写不进去：' + (e && e.message))
  }
}

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
    if (url.pathname === '/schedule') {
      if (req.method === 'GET') return json(res, 200, { schedule, summary: scheduleSummary(schedule) }, origin)
      if (req.method === 'POST') {
        const next = normalizeSchedule(await readBody(req), await siteIds(), { strict: true })
        if (!next) return json(res, 400, { error: '配置不合法：at 要 HH:MM，sites 要站点 id 数组' }, origin)
        schedule = { ...next, lastRun: schedule.lastRun ?? null }
        await saveSchedule()
        console.log('[schedule] 配置已保存：' + scheduleSummary(schedule).text)
        return json(res, 200, { schedule, summary: scheduleSummary(schedule) }, origin)
      }
      return json(res, 405, { error: '只支持 GET / POST' }, origin)
    }

    // 桥接页：工作台开个小窗到这里，由它（与助手同源）替工作台调接口，再用 postMessage 送回。
    // 顶层导航到 127.0.0.1 不受浏览器「本地网络访问」权限限制 —— 这条路让用户完全不用翻设置。
    if (url.pathname === '/bridge' || url.pathname === '/bridge.js') {
      const wantOrigin = url.searchParams.get('origin') || ''
      if (url.pathname === '/bridge' && !ALLOWED_ORIGINS.includes(wantOrigin)) {
        return json(res, 403, { error: 'origin 不在白名单，不提供桥接' }, origin)
      }
      const file = url.pathname === '/bridge' ? 'bridge.html' : 'bridge.js'
      let body = await readFile(path.join(HERE, file), 'utf8')
      if (file === 'bridge.html') {
        // 把桥接逻辑**原地注入**成经典脚本（不用 ESM/import）：模块加载一旦失败，页面会静默停在初始
        // 文案，与「连不上」长得一模一样 —— 2026-10-04 在 Edge 上就踩到了。
        const logic = await readFile(path.join(HERE, 'bridge.js'), 'utf8')
        body = body.replace('/*__BRIDGE_JS__*/', logic.replace(/\bexport /g, ''))
      }
      res.writeHead(200, {
        'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end(body)
      return
    }

    if (url.pathname === '/health') {
      // 自检跟着 /health 一起回：缺件必须在用户点按钮**之前**就看得见（2026-10-03 的教训）
      const install = checkInstall({ crawlerDir: CRAWLER_DIR })
      return json(res, 200, {
        ok: true,
        service: '实习工作台 · 本地抓取助手',
        crawler: CRAWLER_DIR,
        busy: running ? running.id : null,
        outputs: (await recentOutput(5)).map((f) => f.name),
        ready: install.ready,
        problems: install.problems,
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

// —— 定时抓取：每分钟看一次「该不该跑」——
const SCHEDULE_TICK_MS = 60_000
async function scheduleTick() {
  try {
    if (running) return // 有抓取在跑：这轮跳过（并发闸门在 startCrawl 那边），下轮再看
    if (!dueNow(schedule)) return
    const before = new Set((await recentOutput(20)).map((f) => f.name))
    const task = startCrawl({
      sites: schedule.sites,
      keyword: schedule.keyword,
      pages: schedule.pages,
      limit: schedule.limit,
      mode: schedule.mode,
      detail: 0,
    })
    console.log('[schedule] 自动抓取开始：' + scheduleSummary(schedule).text)
    await new Promise((resolve) => {
      const iv = setInterval(() => {
        if (task.state !== 'running') { clearInterval(iv); resolve() }
      }, 1000)
    })
    const fresh = (await readJobsOutput()).filter((o) => !before.has(o.file))
    const newJobs = fresh.reduce((n, o) => n + (o.count || (o.jobs ? o.jobs.length : 0)), 0)
    schedule = {
      ...schedule,
      lastRun: {
        day: localDay(new Date()),
        at: new Date().toISOString(),
        ok: task.state === 'done',
        newJobs,
        files: fresh.map((o) => o.file),
        taskId: task.id, // 网页靠它把这次自动抓到的岗位取回来导入
      },
    }
    await saveSchedule()
    console.log('[schedule] 自动抓取结束：state=' + task.state + ' 新增 ' + newJobs + ' 条')
  } catch (e) {
    console.log('[schedule] 出错：' + (e && e.message))
  }
}
setInterval(scheduleTick, SCHEDULE_TICK_MS)
loadSchedule().then(() => setTimeout(scheduleTick, 4000))
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

  // 启动即自检：把「网页上一点就失败」提前成「打开就看见缺什么」
  const install = checkInstall({ crawlerDir: CRAWLER_DIR })
  if (!install.ready) {
    console.log('  ⚠️ 自检没过 —— 现在点「开始抓取」一定会失败：')
    console.log(formatProblems(install.problems).split('\n').map((l) => '  ' + l).join('\n'))
    console.log('')
  }
})
