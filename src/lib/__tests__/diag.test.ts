import { describe, expect, it } from 'vitest'
import { buildDiagDetail, diagEnabled, DIAG_MAX_KEYS, DIAG_STR_MAX } from '../diag'
import { sanitizeDetail } from '../usage'

describe('?diag=1：把版式问题自报给库（sanitizeDetail 有两道门：<=40 字符 + 只留前 6 键）', () => {
  it('只认 ?diag=1，不误命中', () => {
    expect(diagEnabled('?diag=1')).toBe(true)
    expect(diagEnabled('?a=1&diag=1')).toBe(true)
    expect(diagEnabled('?diag=10')).toBe(false)
    expect(diagEnabled('?xdiag=1')).toBe(false)
    expect(diagEnabled('')).toBe(false)
  })

  const sample = () =>
    buildDiagDetail({
      viewport: 390,
      scroll: 430,
      os: 'mobile',
      page: 'jobs',
      worst: [
        { name: 'table.tbl', width: 420 },
        { name: 'div.card', width: 401 },
      ],
    })

  it('键数不超过 6（第二道门），字符串不超过 40（第一道门）', () => {
    const d = sample()
    expect(Object.keys(d).length).toBeLessThanOrEqual(DIAG_MAX_KEYS)
    for (const v of Object.values(d)) {
      if (typeof v === 'string') expect(v.length).toBeLessThanOrEqual(DIAG_STR_MAX)
    }
  })

  it('⚠️ 回归：整条必须能过真实调用链 —— 两次踩坑都是在这一步被砍（240 字符 summary 被丢 / 第 7、8 个键被截）', () => {
    const kept = sanitizeDetail(sample()) as Record<string, number | string>
    expect(kept.d).toBe(40)
    expect(kept.vw).toBe(390)
    expect(kept.os).toBe('mobile')
    expect(kept.page).toBe('jobs')
    expect(kept.e1).toBe('table.tbl(420)')
    expect(kept.e2).toBe('div.card(401)')
  })

  it('没有超宽元素时只有 4 个键，也不报假元凶', () => {
    const d = buildDiagDetail({ viewport: 390, scroll: 390, os: 'mobile', page: 'jobs', worst: [] })
    expect(d.d).toBe(0)
    expect(d.e1).toBeUndefined()
    expect(sanitizeDetail(d)).toEqual({ d: 0, vw: 390, os: 'mobile', page: 'jobs' })
  })

  it('对照（那道 40 字符门为什么危险）：41 字符的串会被丢，40 字符能过', () => {
    expect(sanitizeDetail({ s: 'x'.repeat(41) })).toBeUndefined()
    expect(sanitizeDetail({ s: 'x'.repeat(40) })).toEqual({ s: 'x'.repeat(40) })
  })
})
