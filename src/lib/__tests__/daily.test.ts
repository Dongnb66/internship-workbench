import { describe, expect, it } from 'vitest'

import { daysFrom, todayPicks } from '../daily'
import { daysLeft, pad, todayISO } from '../format'
import type { Row } from '../../types'

const TODAY = '2026-09-23'

const job = (over: Partial<Row> & { id: number }): Row => ({
  company: '示例公司',
  title: 'AI 应用开发实习生',
  status: 'pool',
  ...over,
} as Row)

const profile = {
  skills: ['Python', 'FastAPI', 'LangGraph', 'React'],
  directions: ['AI Agent 应用'],
  expect_city: ['深圳'],
} as never

describe('daysFrom', () => {
  it('纯日期串按本地日历日相减', () => {
    expect(daysFrom(TODAY, '2026-09-23')).toBe(0)
    expect(daysFrom(TODAY, '2026-09-25')).toBe(2)
    expect(daysFrom(TODAY, '2026-09-20')).toBe(-3)
  })

  it('带时间的时间戳按**本地日历日**取，不取 UTC 日期部分', () => {
    // 老实现是 `slice(0, 10)`（取时间戳的 UTC 日期），UTC+8 下与列表页差一天：
    // 同一份 deadline 在「今日优先」算 2 天、在岗位池列表算 3 天，且不报错。
    // 注意别写成 `expect(daysFrom(TODAY, instant)).toBe(2)` 这种硬编码整数 ——
    // 时间戳的「本地日历日」本来就是随时区变的（`2026-09-23T12:00:00Z` 在 UTC+12
    // 已是次日），硬编码会把这条断言变成"测时区"。只断言"与它本地日历日算出来的一致"。
    for (const instant of ['2026-09-25T16:00:00.000Z', '2026-09-23T12:00:00.000Z']) {
      const t = new Date(instant)
      const localDay = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
      expect(daysFrom(TODAY, instant), `daysFrom(${instant})`).toBe(daysFrom(TODAY, localDay))
    }
    // 纯日期串这一支与本地时区无关，可以钉死整数
    expect(daysFrom(TODAY, '2026-09-23')).toBe(0)
  })

  it('与岗位池列表同一条规则：同一截止日两处算出的天数必须一致', () => {
    for (const value of ['2026-09-25', '2026-09-25T16:00:00.000Z', '2026-12-31T23:59:59.999Z']) {
      expect(daysFrom(todayISO(), value), `daysFrom(${value})`).toBe(daysLeft(value))
    }
  })

  it('空值与非日期返回 null，不抛异常', () => {
    expect(daysFrom(TODAY, null)).toBeNull()
    expect(daysFrom(TODAY, '')).toBeNull()
    expect(daysFrom(TODAY, '不是日期')).toBeNull()
  })
})

describe('todayPicks', () => {
  it('只推岗位池里、还没投的岗位', () => {
    const jobs = [
      job({ id: 1 }),
      job({ id: 2, status: 'applied' }),
      job({ id: 3, status: 'archived' }),
    ]
    const apps = [{ job_id: 1 } as Row]
    const picks = todayPicks(jobs, apps, profile, 5, TODAY)
    expect(picks.map((p) => p.job.id)).toEqual([]) // 1 已投，2/3 非 pool
  })

  it('已投的岗位（通过 applications.job_id）不会再被推', () => {
    const jobs = [job({ id: 1 }), job({ id: 2 })]
    const apps = [{ job_id: 1 } as Row]
    const picks = todayPicks(jobs, apps, profile, 5, TODAY)
    expect(picks.map((p) => p.job.id)).toEqual([2])
  })

  it('截止紧急度优先：今天截止的排在高分未到期岗位前面', () => {
    const jobs = [
      job({ id: 1, match_score: 95, deadline: '2026-10-30' }),
      job({ id: 2, match_score: 60, deadline: '2026-09-23' }), // 今天截止
    ]
    const picks = todayPicks(jobs, [], profile, 5, TODAY)
    expect(picks[0].job.id).toBe(2)
    expect(picks[0].urgency).toBe('today')
  })

  it('同为无截止时，优先级 高 > 低；优先级缺省按「中」', () => {
    const jobs = [
      job({ id: 1, priority: '低', match_score: 90, jd_text: 'Python FastAPI LangGraph 实习' }),
      job({ id: 2, priority: '高', match_score: 60, jd_text: 'Python FastAPI LangGraph 实习' }),
      job({ id: 3, match_score: 70, jd_text: 'Python FastAPI LangGraph 实习' }), // 无优先级
    ]
    const picks = todayPicks(jobs, [], profile, 5, TODAY)
    expect(picks.map((p) => p.job.id)).toEqual([2, 3, 1])
  })

  it('匹配依据来自真实命中，不编造', () => {
    const jobs = [job({ id: 1, jd_text: '要求熟悉 Python 与 FastAPI，有 LangGraph 经验优先' })]
    const [pick] = todayPicks(jobs, [], profile, 5, TODAY)
    expect(pick.reason).toContain('命中：')
    expect(pick.reason).toContain('Python')
  })

  it('待确认标记：缺截止日/缺 JD/缺链接都要说出来', () => {
    const jobs = [job({ id: 1 })]
    const [pick] = todayPicks(jobs, [], profile, 5, TODAY)
    expect(pick.confirm).toContain('未填截止日')
    expect(pick.confirm).toContain('无 JD 原文，分数仅供参考')
    expect(pick.confirm).toContain('未录投递链接')
  })

  it('limit 生效', () => {
    const jobs = [job({ id: 1 }), job({ id: 2 }), job({ id: 3 }), job({ id: 4 })]
    expect(todayPicks(jobs, [], profile, 3, TODAY)).toHaveLength(3)
  })

  it('空输入不抛异常', () => {
    expect(todayPicks([], [], null, 3, TODAY)).toEqual([])
  })
})
