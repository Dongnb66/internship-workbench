import { describe, expect, it } from 'vitest'

import { detectBlockers, gradYearsIn, yearOf } from '../blockers'
import type { Profile } from '../../types'

const me: Profile = {
  grad_year: '2028 届',
  grade: '大三',
  expect_city: ['广州', '深圳', '远程'],
  skills: ['Python', 'React'],
  directions: ['AI Agent 应用'],
}

describe('detectBlockers 硬门槛检测', () => {
  it('届数不符 → 硬阻断，且 quote 逐字来自 JD 原句', () => {
    const jd = '招聘对象：2027 届本科及以上应届毕业生\n岗位：后端开发实习生'
    const r = detectBlockers(jd, '', me)
    expect(r.hard).toHaveLength(1)
    expect(r.hard[0].label).toContain('2027')
    // 证据必须是原文，不能是规则自己编的话
    expect(jd).toContain(r.hard[0].quote)
    expect(r.verdict).toContain('别投')
  })

  it('届数命中自己的年份 → 不报', () => {
    const r = detectBlockers('面向 2028 届毕业生招聘', '', me)
    expect(r.hard).toHaveLength(0)
  })

  it('JD 同时写多个届且含自己 → 不报（不误伤）', () => {
    const r = detectBlockers('面向 2027 届、2028 届毕业生', '', me)
    expect(r.hard).toHaveLength(0)
  })

  it('英语证书：明确要求算硬，写了"优先"只能算软', () => {
    const hard = detectBlockers('要求通过大学英语四级（CET-4）', '', me)
    expect(hard.hard.some((b) => b.label.includes('四级'))).toBe(true)

    const soft = detectBlockers('通过英语六级者优先', '', me)
    expect(soft.hard.some((b) => b.label.includes('六级'))).toBe(false)
    expect(soft.soft.some((b) => b.label.includes('六级'))).toBe(true)
  })

  it('英语条目无法判定强弱时按硬处理（初筛真会卡），但绝不判断"你是否持有"', () => {
    const r = detectBlockers('英语要求：CET-6', '', me)
    expect(r.hard.some((b) => b.label.includes('六级'))).toBe(true)
    // 输出里不得出现对个人事实的断言
    expect(JSON.stringify(r)).not.toMatch(/未通过|没过|没有四级/)
  })

  it('学历：本科在读遇到"硕士及以上"报硬；写"本科及以上"不报', () => {
    const bad = detectBlockers('学历要求：硕士及以上', '', me)
    expect(bad.hard.some((b) => b.label.includes('学历'))).toBe(true)

    const ok = detectBlockers('学历要求：本科及以上', '', me)
    expect(ok.hard).toHaveLength(0)
  })

  it('没有年级信息时不推断学历不符（宁可不报）', () => {
    const r = detectBlockers('学历要求：硕士及以上', '', { grad_year: '2028 届' })
    expect(r.hard).toHaveLength(0)
  })

  it('经验年限 ≥2 年报硬阻断', () => {
    const r = detectBlockers('岗位要求：3 年以上相关工作经验', '', me)
    expect(r.hard.some((b) => b.label.includes('年限'))).toBe(true)
    const one = detectBlockers('有 1 年实习经验优先', '', me)
    expect(one.hard).toHaveLength(0)
  })

  it('院校层级：限定才算硬，"优先"只算软', () => {
    expect(detectBlockers('仅限 985/211 院校毕业生', '', me).hard.some((b) => b.label.includes('院校'))).toBe(true)
    const soft = detectBlockers('985/211 院校毕业生优先', '', me)
    expect(soft.hard).toHaveLength(0)
    expect(soft.soft.some((b) => b.label.includes('院校'))).toBe(true)
  })

  it('完全无线索的表述不报（避免误报挡掉好岗位）', () => {
    // 只出现"硕士"字样但没有强度线索：可能是介绍团队，不是门槛
    const r = detectBlockers('团队由多位硕士、博士组成，氛围很好', '', me)
    expect(r.hard).toHaveLength(0)
  })

  it('工作地点与期望城市不符 → 只算软，不算硬', () => {
    const r = detectBlockers('工作地点：北京', '', me)
    expect(r.hard).toHaveLength(0)
    expect(r.soft.some((b) => b.label.includes('地点'))).toBe(true)
    // 期望城市命中时不报
    expect(detectBlockers('工作地点：深圳', '', me).soft).toHaveLength(0)
  })

  it('同类门槛只报一次', () => {
    const r = detectBlockers('要求通过四级\n英语要求：CET-4 必须', '', me)
    expect(r.hard.filter((b) => b.label.includes('四级'))).toHaveLength(1)
  })

  it('干净岗位给出可投结论，且没有原文依据的推断一条都不出现', () => {
    const r = detectBlockers('负责 Agent 后端开发，熟悉 Python 与 FastAPI 优先', '', me)
    expect(r.hard).toHaveLength(0)
    expect(r.soft).toHaveLength(0)
    expect(r.verdict).toBe('没发现写死的门槛')
  })

  it('quote 长度受控，不会把整段 JD 塞进提示', () => {
    const long = `要求通过四级${'很长的描述'.repeat(40)}`
    const r = detectBlockers(long, '', me)
    expect(r.hard[0].quote.length).toBeLessThanOrEqual(91)
  })

  it('工具函数：抽届数与抽年份', () => {
    expect(gradYearsIn('2026届/2027 届/2028届')).toEqual([2026, 2027, 2028])
    expect(yearOf('2028 届')).toBe(2028)
    expect(yearOf('大三')).toBeNull()
  })

  it('空 profile 不崩且不误报', () => {
    const r = detectBlockers('要求通过四级', '', null)
    expect(r.hard.some((b) => b.label.includes('四级'))).toBe(true)
    expect(detectBlockers('面向 2027 届', '', null).hard).toHaveLength(0)
  })
})
