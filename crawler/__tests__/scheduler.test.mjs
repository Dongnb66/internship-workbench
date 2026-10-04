import { describe, expect, it } from 'vitest'

import { CATCH_UP_MS, dueNow, localDay, normalizeSchedule, parseAt, scheduleSummary } from '../agent/scheduler.mjs'

/**
 * 定时抓取只会做两件事：**该跑的时候跑**、**不该跑的时候一次都别跑**。
 * 后者更重要 —— 半夜突然开浏览器抓岗位，用户会以为中毒了。
 */
const KNOWN = ['hikvision', 'tencent', 'meituan']
const base = { enabled: true, at: '09:00', sites: ['hikvision'], keyword: '前端', limit: 20, mode: 'all' }
const at = (h, m = 0) => new Date(2026, 9, 4, h, m, 0, 0) // 2026-10-04

describe('定时抓取：时刻解析', () => {
  it('只认 HH:MM（00:00–23:59）', () => {
    expect(parseAt('09:00')).toBe(540)
    expect(parseAt('00:00')).toBe(0)
    expect(parseAt('23:59')).toBe(1439)
    expect(parseAt('9:00')).toBe(null)
    expect(parseAt('24:00')).toBe(null)
    expect(parseAt('09:60')).toBe(null)
    expect(parseAt('随便')).toBe(null)
    expect(parseAt(null)).toBe(null)
  })
})

describe('定时抓取：该不该跑', () => {
  it('没开 / 没勾站点 / 没到点：一次都不跑', () => {
    expect(dueNow({ ...base, enabled: false }, at(10))).toBe(false)
    expect(dueNow({ ...base, sites: [] }, at(10))).toBe(false)
    expect(dueNow(base, at(8, 59))).toBe(false)
  })

  it('到点就跑', () => {
    expect(dueNow(base, at(9))).toBe(true)
    expect(dueNow(base, at(12))).toBe(true)
  })

  it('今天已经跑过就不再跑（哪怕还在窗口内）', () => {
    expect(dueNow({ ...base, lastRun: { day: localDay(at(9)), ok: true } }, at(11))).toBe(false)
  })

  it('昨天跑过不影响今天', () => {
    expect(dueNow({ ...base, lastRun: { day: '2026-10-03', ok: true } }, at(9))).toBe(true)
  })

  it('超过补跑窗口就不补了（深夜开机不该突然开爬）', () => {
    const late = new Date(at(9).getTime() + CATCH_UP_MS + 60_000)
    expect(dueNow(base, late)).toBe(false)
  })
})

describe('定时抓取：配置校验', () => {
  it('站点 id 不认识就丢掉；时刻不合法退回默认', () => {
    const s = normalizeSchedule({ enabled: true, at: '99:99', sites: ['hikvision', '不存在', 'tencent'], keyword: 'x'.repeat(200), limit: 9999 }, KNOWN)
    expect(s.at).toBe('09:00')
    expect(s.sites).toEqual(['hikvision', 'tencent'])
    expect(s.keyword.length).toBe(100)
    expect(s.limit).toBe(300)
  })

  it('坏输入一律拒（null），不猜', () => {
    expect(normalizeSchedule(null, KNOWN)).toBe(null)
    expect(normalizeSchedule('开着', KNOWN)).toBe(null)
  })

  it('enabled 必须是真正的 true', () => {
    expect(normalizeSchedule({ enabled: 'yes', sites: ['hikvision'] }, KNOWN).enabled).toBe(false)
  })

  it('开着但没勾站点：摘要要说清"不会抓"（这种配置最容易骗自己）', () => {
    expect(scheduleSummary({ ...base, sites: [] }).text).toContain('不会抓')
    expect(scheduleSummary({ ...base }).text).toContain('每天 09:00')
    expect(scheduleSummary({ enabled: false }).text).toBe('未开启')
  })
})
