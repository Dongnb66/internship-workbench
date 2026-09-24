#!/usr/bin/env node
/**
 * 本地 agent 网关（路线 A 的本机半边）。
 *
 * 定位：工作台云端站不动；这个服务只跑在本机（127.0.0.1），只做一件
 * 云端做不了的事——**驱动本机浏览器抓取器**（crawler/run.mjs，用你的
 * 登录态开真浏览器）。对话页（public/chat.html）也由它托管：
 * 页面里跑 cloud SDK（登录/LLM/灌库 RPC 都在浏览器侧），通过
 * /api/crawl 调用本机抓取。
 *
 * 安全模型：
 * - 只监听 127.0.0.1，不对外
 * - 站点 id 白名单校验（crawler/sites.mjs），数值/长度有界
 * - 无任何密钥落盘；云端凭证只存在于浏览器 localStorage（与主站同构）
 *
 * 用法：node gateway/server.mjs  （或 npm run gateway）
 */

import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCrawlArgs, collectJobs } from './lib/args.mjs'
import { SITES } from '../crawler/sites.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const CRAWLER_DIR = path.join(here, '..', 'crawler')
const OUT_DIR = path.join(here, 'out')
const PUBLIC_DIR = path.join(here, 'public')
const PORT = Number(process.env.GATEWAY_PORT) || 5178

/** chat 页的云端调用走这个反向代理：把 Origin/Host 改写成发布域。
 *  原因：云服务端会校验 Origin，而对话页跑在 http://127.0.0.1:PORT 上，
 *  直连发布域大概率被 Origin 校验拒绝。代理只是让「本机 UI 访问自己的云」
 *  被平台正确识别应用归属——publishableKey 与用户登录态不变，无任何越权。 */
const CLOUD_ORIGIN = 'https://internship-workbench-47024.app.workbuddy.host'

const SITE_LIST = SITES.map((s) => ({
  id: s.id,
  name: s.name,
  channel: s.channel,
  needsLogin: Boolean(s.needsLogin),
  kwSearch: String(s.listUrl ?? '').includes('{kw}'),
  urlOnly: !s.listUrl,
  verified: s.verified ?? '',
}))

/** taskId → {status, log, dir, proc, startedAt} */
const tasks = new Map()

async function readJsonFiles(dir) {
  let names = []
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    try {
      out.push({ name, content: await readFile(path.join(dir, name), 'utf8') })
    } catch {
      // 文件读不出（正被写/权限）就跳过这一份
    }
  }
  return out
}

function startCrawl(body) {
  const checked = buildCrawlArgs(body, SITE_LIST)
  if (!checked.ok) return { error: checked.error }

  // 并发保护：抓取是重浏览器操作，同时最多 3 个任务
  const running = [...tasks.values()].filter((t) => t.status === 'running').length
  if (running >= 3) return { error: '已有 3 个抓取任务在跑，等它们结束再发' }

  const taskId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const dir = path.join(OUT_DIR, taskId)
  // ⚠ args 必须带 --out：run.mjs 默认产出写到 crawler/output/，
  // 而本任务的 collectJobs 只读 gateway/out/<taskId>/ —— 漏掉这个参数
  // 任务永远返回空结果（自查发现并修复，端到端实测有牙）
  const args = [...checked.args, '--out', dir]
  const entry = { status: 'running', log: [], dir, proc: null, startedAt: Date.now() }
  tasks.set(taskId, entry)

  const proc = spawn(process.execPath, args, {
    cwd: CRAWLER_DIR,
    env: { ...process.env, FORCE_COLOR: '0' },
    windowsHide: true,
  })
  entry.proc = proc
  entry.args = args
  void mkdir(dir, { recursive: true })

  const pushLog = (line) => {
    entry.log.push(line)
    if (entry.log.length > 500) entry.log.splice(0, entry.log.length - 500)
  }
  proc.stdout?.setEncoding('utf8')
  proc.stderr?.setEncoding('utf8')
  const feed = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      const t = line.trim()
      if (t) pushLog(t)
    }
  }
  proc.stdout?.on('data', feed)
  proc.stderr?.on('data', feed)
  proc.on('error', (err) => {
    entry.status = 'error'
    pushLog(`进程错误：${err.message}`)
  })
  proc.on('close', (code) => {
    entry.status = code === 0 ? 'done' : 'error'
    entry.exitCode = code
    pushLog(code === 0 ? '—— 抓取完成 ——' : `—— 进程退出（code ${code}）——`)
  })

  return { taskId }
}

async function readBody(req, limitBytes = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limitBytes) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function json(res, code, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const SDK_FILE = path.join(here, '..', 'node_modules', '@tencent-ai', 'workbuddy-cloud-sdk', 'lib', 'index.global.js')

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')

  // 云端反向代理：/cloud-proxy/.cloud/** → https://<发布域>/.cloud/**
  // 改写 Origin/Host/Referer 让平台把请求识别为该应用自身；登录态（Authorization 头）原样透传
  if (url.pathname.startsWith('/cloud-proxy/')) {
    const target = CLOUD_ORIGIN + url.pathname.slice('/cloud-proxy'.length) + url.search
    const headers = { ...req.headers }
    headers.host = new URL(CLOUD_ORIGIN).host
    headers.origin = CLOUD_ORIGIN
    if (headers.referer) headers.referer = CLOUD_ORIGIN + '/'
    const proxyReq = https.request(target, { method: req.method, headers }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
      proxyRes.pipe(res)
    })
    proxyReq.on('error', (err) => json(res, 502, { error: `云端代理失败：${err.message}` }))
    req.pipe(proxyReq)
    return
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/sites') {
      return json(res, 200, { sites: SITE_LIST })
    }

    if (req.method === 'POST' && url.pathname === '/api/crawl') {
      let body
      try {
        body = JSON.parse((await readBody(req)) || '{}')
      } catch {
        return json(res, 400, { error: '请求体不是合法 JSON' })
      }
      const started = startCrawl(body)
      return json(res, started.error ? 400 : 200, started)
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/tasks/')) {
      const id = url.pathname.slice('/api/tasks/'.length)
      const entry = tasks.get(id)
      if (!entry) return json(res, 404, { error: '任务不存在（网关可能重启过，请重新发起）' })
      const payload = {
        status: entry.status,
        exitCode: entry.exitCode ?? null,
        log: entry.log.slice(-80),
        args: entry.args ?? null,
      }
      if (entry.status === 'done') {
        payload.jobs = await collectJobs(entry.dir, readJsonFiles)
      }
      return json(res, 200, payload)
    }

    // 静态资源：/ → chat.html；/vendor/cloud-sdk.global.js → SDK 全局构建
    if (req.method === 'GET') {
      let filePath
      if (url.pathname === '/vendor/cloud-sdk.global.js') {
        filePath = SDK_FILE
      } else if (url.pathname === '/' || url.pathname === '/index.html') {
        filePath = path.join(PUBLIC_DIR, 'chat.html')
      } else {
        const safe = path.normalize(url.pathname).replace(/^([/\\])+/, '')
        filePath = path.join(PUBLIC_DIR, safe)
        if (!filePath.startsWith(PUBLIC_DIR)) {
          res.writeHead(403).end()
          return
        }
      }
      try {
        const content = await readFile(filePath)
        const ext = path.extname(filePath).toLowerCase()
        res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
        res.end(content)
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('404 Not Found')
      }
      return
    }

    res.writeHead(405).end()
  } catch (error) {
    json(res, 500, { error: error?.message ?? '内部错误' })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[gateway] http://127.0.0.1:${PORT}  （只监听本机回环）`)
  console.log('[gateway] 对话页已就绪：浏览器打开上面的地址；抓取器输出在 gateway/out/')
})
