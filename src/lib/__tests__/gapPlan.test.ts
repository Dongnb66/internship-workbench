import { describe, expect, it } from 'vitest'

import { gapPlan } from '../gapPlan'

describe('gapPlan · 三档结构', () => {
  it('已满足 = highlights 原样', () => {
    const plan = gapPlan(['熟悉 LangGraph', '有 RAG 实践'], ['没写 Vue 经验'], '要求 Vue 优先')
    expect(plan.met).toEqual(['熟悉 LangGraph', '有 RAG 实践'])
  })

  it('gaps 支持按行字符串（ai_reports 的存储格式）', () => {
    const plan = gapPlan('亮点A\n亮点B', '缺口A\n缺口B', '')
    expect(plan.met).toEqual(['亮点A', '亮点B'])
    expect(plan.missing.map((m) => m.item)).toEqual(['缺口A', '缺口B'])
  })

  it('每条缺口都带可执行动作，不能只有「你有缺口」没有「怎么办」', () => {
    const plan = gapPlan([], ['熟悉 Elasticsearch 优先', '会 Vue 者优先'], '')
    expect(plan.missing).toHaveLength(2)
    for (const m of plan.missing) {
      expect(m.action.trim().length).toBeGreaterThan(5)
    }
  })

  it('补齐动作遵守打招呼纪律：未接触的技术不主动提，用同类能力顶上', () => {
    const cases: Array<[string, RegExp]> = [
      ['熟悉 ES 优先', /不主动提/],
      ['要会 Redis', /不主动提/],
      ['用过 Dify 者 priority', /LangGraph/],
      ['熟悉 Vue', /React/],
    ]
    for (const [gap, re] of cases) {
      const plan = gapPlan([], [gap], '')
      expect(plan.missing[0].action, `缺口「${gap}」的动作`).toMatch(re)
    }
  })

  it('待确认档：从 JD 提取「只有用户自己能核实」的事实', () => {
    const jd = '要求本科及以上学历，每周到岗 4 天，实习 6 个月，2027 届优先，可转正'
    const plan = gapPlan([], [], jd)
    expect(plan.confirm.some((c) => c.includes('学历'))).toBe(true)
    expect(plan.confirm.some((c) => c.includes('到岗时长') || c.includes('周'))).toBe(true)
    expect(plan.confirm.some((c) => c.includes('届数'))).toBe(true)
    expect(plan.confirm.some((c) => c.includes('转正'))).toBe(true)
  })

  it('JD 为空时待确认档为空（不凭空猜）', () => {
    expect(gapPlan([], [], '').confirm).toEqual([])
    expect(gapPlan([], [], null).confirm).toEqual([])
  })

  it('成立年份/无关年份不误报届数；「XX年应届/毕业」仍命中', () => {
    // 旧规则 `20\d{2}年[^度]` 会把「公司成立于2019年」「2024年加入我们」
    // 全部当成届数待确认——多出一条误导项，用户会白跑一趟 HR
    expect(gapPlan([], [], '公司成立于2019年，团队规模 500 人').confirm.some((c) => c.includes('届数'))).toBe(false)
    expect(gapPlan([], [], '本岗位面向2026年应届毕业生').confirm.some((c) => c.includes('届数'))).toBe(true)
  })

  it('待确认不重复', () => {
    const jd = '本科及以上，本科学历，每周 4 天，实习 6 个月'
    const plan = gapPlan([], [], jd)
    expect(new Set(plan.confirm).size).toBe(plan.confirm.length)
  })

  it('全部为空输入时三档都空，不抛异常', () => {
    const plan = gapPlan(null, null, null)
    expect(plan).toEqual({ met: [], confirm: [], missing: [] })
  })
})
