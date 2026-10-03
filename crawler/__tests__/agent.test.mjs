/**
 * 本地抓取助手 · 契约测试
 *
 * 为什么要有：这个服务是「网页点一下就抓岗位」那一半的地基。
 * 它的响应结构一变，网页端会**静默**坏掉（字段读不到，界面显示空）。
 * 所以这里断言的是**字段名与类型**，不是「跑起来没报错」。
 *
 * ⚠️ 两条纪律：
 *   ① 用**测试端口**，不要抢占用户正在用的 8787
 *   ② **绝不真跑爬虫** —— 那会开真浏览器、会触发风控、会在 CI 里挂住
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.join(HERE, '..', 'agent', 'server.mjs')
const PORT = 8791
const BASE = `http://127.0.0.1:${PORT}`
const ORIGIN = 'https://internship-workbench-47024.app.workbuddy.host'

let child = null

async function waitHealthy(timeoutMs = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health`)
      if (r.ok) return true
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

beforeAll(async () => {
  child = spawn(process.execPath, [SERVER, '--port', String(PORT)], {
    stdio: 'ignore',
    windowsHide: true,
  })
  const ok = await waitHealthy()
  if (!ok) throw new Error('本地助手没能在 15 秒内起来')
}, 30000)

afterAll(() => {
  if (child && !child.killed) child.kill()
})

describe('本地抓取助手 · 契约', () => {
  it('GET /health 返回 ok 与最近产出', async () => {
    const r = await fetch(`${BASE}/health`)
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.ok).toBe(true)
    expect(typeof d.service).toBe('string')
    expect(typeof d.crawler).toBe('string')
    // 自检（2026-10-03 起）：缺件要在用户点按钮**之前**就看得见
    expect(typeof d.ready).toBe('boolean')
    expect(Array.isArray(d.problems)).toBe(true)
    // busy 为 null（空闲）或任务 id —— 网页端靠它判断「能不能再开一个」
    expect(d.busy === null || typeof d.busy === 'string').toBe(true)
    expect(Array.isArray(d.outputs)).toBe(true)
  })

  it('GET /sites 的每个站点都含网页端要用的 5 个字段', async () => {
    const r = await fetch(`${BASE}/sites`)
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(Array.isArray(d.sites)).toBe(true)
    expect(d.sites.length).toBeGreaterThan(10)

    for (const s of d.sites) {
      expect(typeof s.id, `站点 ${s.id} 的 id`).toBe('string')
      expect(typeof s.name).toBe('string')
      expect(typeof s.needsLogin).toBe('boolean')
      expect(typeof s.kwSearch).toBe('boolean')
      // verified 只允许契约定下的取值（和 crawler/sites.mjs 同源）
      expect(['', 'live', 'offline']).toContain(s.verified)
    }
  })

  it('GET /sites 与 crawler/sites.mjs 同源（不是另抄一份）', async () => {
    const { SITES } = await import(path.join(HERE, '..', 'sites.mjs'))
    const r = await fetch(`${BASE}/sites`)
    const d = await r.json()
    expect(d.sites.map((s) => s.id)).toEqual(SITES.map((s) => s.id))
  })

  it('CORS：只在白名单 Origin 上放行，并允许私有网络访问', async () => {
    const ok = await fetch(`${BASE}/health`, { headers: { Origin: ORIGIN } })
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    // Chrome 的 Private Network Access：HTTPS 页面调 http://127.0.0.1 靠这个头
    expect(ok.headers.get('access-control-allow-private-network')).toBe('true')

    const bad = await fetch(`${BASE}/health`, { headers: { Origin: 'https://evil.example' } })
    expect(bad.status).toBe(403)
    expect(bad.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('OPTIONS 预检返回 204（浏览器跨域要先问这一下）', async () => {
    const r = await fetch(`${BASE}/health`, { method: 'OPTIONS', headers: { Origin: ORIGIN } })
    expect(r.status).toBe(204)
  })

  it('POST /crawl 空站点列表返回 400（不是 500，也不许静默启动）', async () => {
    const r = await fetch(`${BASE}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ sites: [], keyword: '实习' }),
    })
    expect(r.status).toBe(400)
    const d = await r.json()
    expect(typeof d.error).toBe('string')
  })

  it('GET /crawl/<不存在的 id> 返回 404', async () => {
    const r = await fetch(`${BASE}/crawl/nope12345`, { headers: { Origin: ORIGIN } })
    expect(r.status).toBe(404)
  })

  it('未知路径返回 404（不吞）', async () => {
    const r = await fetch(`${BASE}/whatever`, { headers: { Origin: ORIGIN } })
    expect(r.status).toBe(404)
  })
})
