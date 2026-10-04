import { beforeEach, describe, expect, it } from 'vitest'
import { detectOs } from '../usageEnv'

import {
  __setUsageSink,
  buildEventPayload,
  buildUserRow,
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

describe('用户表：只 INSERT（UPDATE 通道真机证实不可靠，2026-10-04）', () => {
  const row = (anon: string, now: string, installed?: boolean) => buildUserRow(anon, now, installed)
  it('一行 = 一台浏览器：anon_id + first/last_seen + 版本 + 系统', () => {
    const r = row('a_x', 'T')
    expect(r.anon_id).toBe('a_x')
    expect(r.first_seen).toBe('T')
    expect(r.last_seen).toBe('T')
    expect(typeof r.app_version).toBe('string')
    expect(typeof r.os).toBe('string')
  })
  it('真装上助手时才写 agent_installed：不确定不写（不把未知写成 false）', () => {
    expect(row('a_x', 'T', true).agent_installed).toBe(true)
    expect('agent_installed' in row('a_x', 'T', false)).toBe(false)
    expect('agent_installed' in row('a_x', 'T')).toBe(false)
  })
})

describe('上报的系统字段：手机必须先判（否则记成 mac/linux）', () => {
  it('iPhone / iPad / Android 都归 mobile', () => {
    expect(detectOs('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('mobile')
    expect(detectOs('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('mobile')
    expect(detectOs('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36')).toBe('mobile')
  })
  it('桌面三种与未知照旧', () => {
    expect(detectOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('win')
    expect(detectOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac')
    expect(detectOs('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux')
    expect(detectOs('')).toBe('unknown')
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
