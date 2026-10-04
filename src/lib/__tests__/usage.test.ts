import { beforeEach, describe, expect, it } from 'vitest'

import {
  __setUsageSink,
  buildEventPayload,
  userPatch,
  isUsageEvent,
  makeAnonId,
  sanitizeDetail,
  setUsageOptOut,
  telemetryAllowed,
  track,
  USAGE_EVENTS,
} from '../usage'

/** 计数只该做两件事：该记的记准、不该记的一个都别记（隐私边界比数字重要）。 */
describe('匿名计数：事件白名单', () => {
  it('只认 5 个事件名，别的（含空串/undefined）一律丢', () => {
    expect(USAGE_EVENTS).toEqual(['app_open', 'agent_download', 'agent_connected', 'crawl_ok', 'import_ok'])
    expect(isUsageEvent('crawl_ok')).toBe(true)
    expect(isUsageEvent('import_failed')).toBe(false)
    expect(isUsageEvent('')).toBe(false)
    expect(isUsageEvent(undefined)).toBe(false)
  })

  it('detail 只留数字和短字符串 —— 岗位内容塞进来会被丢掉', () => {
    expect(sanitizeDetail({ jobs: 5, site: 'hikvision' })).toEqual({ jobs: 5, site: 'hikvision' })
    expect(sanitizeDetail({ jd: '这是一段很长的岗位描述'.repeat(10) })).toBe(undefined)
    expect(sanitizeDetail({ obj: { a: 1 }, arr: [1, 2] })).toBe(undefined)
    expect(sanitizeDetail({ n: Number.NaN })).toBe(undefined)
    expect(sanitizeDetail(undefined)).toBe(undefined)
  })

  it('最多 6 个键，数字取整', () => {
    const d = sanitizeDetail({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 })
    expect(Object.keys(d as object).length).toBe(6)
    expect(sanitizeDetail({ x: 1.6 })?.x).toBe(2)
  })
})

describe('匿名计数：隐私开关', () => {
  it('GPC 或用户关掉 ⇒ 一个都不发', () => {
    expect(telemetryAllowed({})).toBe(true)
    expect(telemetryAllowed({ gpc: true })).toBe(false)
    expect(telemetryAllowed({ optOut: true })).toBe(false)
    expect(telemetryAllowed({ gpc: true, optOut: false })).toBe(false)
  })

  it('opt-out 存在 localStorage，能读回来', () => {
    const mem = new Map<string, string>()
    ;(globalThis as any).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    }
    setUsageOptOut(true)
    expect(mem.get('wb_usage_optout')).toBe('1')
    setUsageOptOut(false)
    expect(mem.get('wb_usage_optout')).toBe(undefined)
  })
})

describe('匿名计数：匿名 id 与载荷', () => {
  it('匿名 id 是 a_ + 24 位十六进制（不绑账号）', () => {
    const id = makeAnonId((n) => Uint8Array.from({ length: n }, (_, i) => i))
    expect(id).toMatch(/^a_[0-9a-f]{24}$/)
  })

  it('载荷形状固定（含 schema_version，便于以后加字段不炸老数据）', () => {
    const p = buildEventPayload('crawl_ok', 'a_deadbeef', '2026-10-05T00:00:00.000Z', { jobs: 5 })
    expect(p.schema_version).toBe(1)
    expect(p.anon_id).toBe('a_deadbeef')
    expect(p.event).toBe('crawl_ok')
    expect(p.detail).toEqual({ jobs: 5 })
    expect(p.received_at).toBe('2026-10-05T00:00:00.000Z')
    expect(typeof p.app_version).toBe('string')
  })
})

describe('用户表更新字段：agent_installed 那个真 bug', () => {
  it('真装上助手时要把它写成 true（否则老用户永远停在 false）', () => {
    expect(userPatch('2026-10-04T00:00:00.000Z', true).agent_installed).toBe(true)
  })
  it('不确定时不写这个字段（不把未知写成 false）', () => {
    expect('agent_installed' in userPatch('now')).toBe(false)
    expect('agent_installed' in userPatch('now', false)).toBe(false)
  })
  it('每次更新都推进 last_seen 与 app_version', () => {
    const p = userPatch('T', true)
    expect(p.last_seen).toBe('T')
    expect(typeof p.app_version).toBe('string')
  })
})

describe('匿名计数：永不打扰用户', () => {
  beforeEach(() => {
    ;(globalThis as any).localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    }
    ;(globalThis as any).sessionStorage = {
      getItem: () => null,
      setItem: () => {},
    }
  })

  it('上报失败（比如表还没建）时不抛错、不阻塞', async () => {
    const seen: string[] = []
    __setUsageSink(async (table) => {
      seen.push(table)
      throw new Error('表不存在 / 网络挂了')
    })
    expect(() => track('crawl_ok', { jobs: 3 })).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
    expect(seen).toContain('usage_events')
    __setUsageSink(null)
  })

  it('正常时把事件写进 usage_events（表名不能写错）', async () => {
    const rows: Array<{ table: string; payload: Record<string, unknown> }> = []
    __setUsageSink(async (table, payload) => {
      rows.push({ table, payload })
    })
    track('app_open')
    await new Promise((r) => setTimeout(r, 0))
    expect(rows[0].table).toBe('usage_events')
    expect(rows[0].payload.event).toBe('app_open')
    __setUsageSink(null)
  })
})
