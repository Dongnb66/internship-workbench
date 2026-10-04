import { describe, expect, it } from 'vitest'

import { BRIDGE_READY, BRIDGE_REQUEST, BRIDGE_RESPONSE, createBridge, isAllowedBridgePath } from '../agent/bridge.js'

/**
 * 桥接协议：不靠用户去翻浏览器设置就能让工作台用上本地助手。
 * 判据是「不安全的东西一条都不许过」——origin 白名单、nonce、路径白名单，缺一不可。
 */
const ORIGIN = 'https://internship-workbench-47024.app.workbuddy.host'

function harness(opts) {
  const sent = []
  const fetchImpl = (opts && opts.fetchImpl) || (async () => ({ status: 200, text: async () => '{"ok":true}' }))
  const bridge = createBridge({
    openerOrigin: ORIGIN,
    nonce: 'n1',
    postToOpener: (m) => sent.push(m),
    fetchImpl,
  })
  return { sent, bridge }
}

const req = (over) => ({ type: BRIDGE_REQUEST, nonce: 'n1', id: '1', path: '/health', ...over })

describe('桥接：路径白名单', () => {
  it('只允许助手自己的相对路径', () => {
    expect(isAllowedBridgePath('/health')).toBe(true)
    expect(isAllowedBridgePath('/crawl/abc123')).toBe(true)
    expect(isAllowedBridgePath('http://evil.example/x')).toBe(false)
    expect(isAllowedBridgePath('//evil.example/x')).toBe(false)
    expect(isAllowedBridgePath('/../secret')).toBe(false)
    expect(isAllowedBridgePath('')).toBe(false)
    expect(isAllowedBridgePath('/')).toBe(false)
  })
})

describe('桥接：握手与转发', () => {
  it('一连上就把 ready（含 nonce）发给工作台', () => {
    const { sent } = harness()
    expect(sent[0]).toEqual({ type: BRIDGE_READY, nonce: 'n1' })
  })

  it('不是白名单 origin 的消息一律不理', async () => {
    const { bridge, sent } = harness()
    bridge.onMessage({ origin: 'https://evil.example', data: req() })
    expect(sent.length).toBe(1) // 只有 ready
  })

  it('nonce 不对不理（防别的页面往这个窗口塞指令）', () => {
    const { bridge, sent } = harness()
    bridge.onMessage({ origin: ORIGIN, data: req({ nonce: 'wrong' }) })
    expect(sent.length).toBe(1)
  })

  it('转发成功：回 status + body', async () => {
    const { bridge, sent } = harness({ fetchImpl: async () => ({ status: 200, text: async () => '{"ready":true}' }) })
    bridge.onMessage({ origin: ORIGIN, data: req() })
    await new Promise((r) => setTimeout(r, 0))
    expect(sent[1]).toEqual({ type: BRIDGE_RESPONSE, nonce: 'n1', id: '1', status: 200, body: '{"ready":true}' })
  })

  it('路径不在白名单：不回请求，只回错误（不能当任意代理用）', () => {
    const { bridge, sent } = harness()
    bridge.onMessage({ origin: ORIGIN, data: req({ path: 'https://evil.example/steal' }) })
    expect(sent[1].error).toContain('只转发助手自己的路径')
  })

  it('fetch 抛错：把错误原样回给工作台，不让它永远转圈', async () => {
    const { bridge, sent } = harness({ fetchImpl: async () => { throw new Error('boom') } })
    bridge.onMessage({ origin: ORIGIN, data: req() })
    await new Promise((r) => setTimeout(r, 0))
    expect(sent[1]).toEqual({ type: BRIDGE_RESPONSE, nonce: 'n1', id: '1', error: 'boom' })
  })

  it('POST 的 method / headers / body 原样透传', async () => {
    let seen = null
    const { bridge } = harness({ fetchImpl: async (p, init) => { seen = { p, init }; return { status: 202, text: async () => '{}' } } })
    bridge.onMessage({
      origin: ORIGIN,
      data: req({ path: '/crawl', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"sites":["hikvision"]}' }),
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(seen.p).toBe('/crawl')
    expect(seen.init.method).toBe('POST')
    expect(seen.init.headers['Content-Type']).toBe('application/json')
    expect(seen.init.body).toBe('{"sites":["hikvision"]}')
  })
})
