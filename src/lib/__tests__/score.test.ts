import { describe, expect, it } from 'vitest'
import { localScore, prefilterJob, PREFILTER_THRESHOLD, WATCH_WORDS } from '../score'
import type { Profile } from '../../types'

const profile: Profile = {
  skills: ['Python', 'React', 'FastAPI'],
  directions: ['AI Agent 应用', 'Python 后端'],
  expect_city: ['广州', '深圳'],
}

describe('localScore', () => {
  it('画像关键词命中越多分越高，且命中项可解释', () => {
    const hit = localScore('广州 AI Agent 应用 后端开发 Python React FastAPI', 'AI Agent 实习生', profile)
    const miss = localScore('负责门店排班与考勤统计', '行政实习生', profile)
    expect(hit.score).toBeGreaterThan(miss.score)
    expect(hit.hits).toContain('Python')
    expect(hit.hits).toContain('React')
    expect(hit.hits).toContain('工作城市符合期望')
    expect(hit.hits.length).toBeGreaterThan(0)
  })

  it('命中 watch 词会扣分，并被记录为潜在缺口', () => {
    const base = 'Python 后端开发，广州'
    const plain = localScore(base, 'Python 实习生', profile)
    const withGap = localScore(`${base}，要求熟悉 Redis 与 Kafka`, 'Python 实习生', profile)
    expect(withGap.missing).toContain('redis')
    expect(withGap.missing).toContain('kafka')
    expect(withGap.score).toBeLessThan(plain.score)
  })

  it('画像为空时回落到基线分，不抛错', () => {
    const r = localScore('任意 JD 文本', '任意岗位', null)
    expect(r.score).toBe(40)
    expect(r.hits).toEqual([])
  })

  it('分数被夹在 0-100 且命中列表去重、截断', () => {
    const duplicated: Profile = { skills: ['Python', 'Python', 'React'], directions: [], expect_city: [] }
    const r = localScore('python react 全栈', '开发', duplicated)
    expect(r.score).toBeLessThanOrEqual(100)
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.hits.filter((h) => h === 'Python')).toHaveLength(1)
    expect(r.hits.length).toBeLessThanOrEqual(10)
  })

  it('大量命中时分数不超过 100', () => {
    const many: Profile = {
      skills: ['Python', 'React', 'FastAPI', 'Node', 'MySQL', 'Docker', 'Git', 'TS', 'Vite'],
      directions: ['AI Agent 应用', 'Python 后端'],
      expect_city: ['广州'],
    }
    const r = localScore('广州 Python React FastAPI Node MySQL Docker Git TS Vite AI Agent 应用 Python 后端', '全栈实习', many)
    expect(r.score).toBe(100)
  })

  it('watch 词表保持小写，避免大小写漏判', () => {
    for (const w of WATCH_WORDS) expect(w).toBe(w.toLowerCase())
  })
})

describe('prefilterJob', () => {
  it('没有 JD 原文直接不通过，并给出原因', () => {
    const r = prefilterJob('   ', 'Python 实习生', profile)
    expect(r.pass).toBe(false)
    expect(r.reason).toContain('没有 JD 原文')
  })

  it('高度相关的 JD 通过预筛', () => {
    const r = prefilterJob('广州 AI Agent 应用方向，Python + FastAPI，负责后端接口开发', 'AI Agent 实习生', profile)
    expect(r.pass).toBe(true)
    expect(r.reason).toContain('预筛通过')
  })

  it('一条关键词都没命中的 JD 被挡在 AI 深评之前', () => {
    const r = prefilterJob('负责门店排班、考勤统计与月度报表', '行政实习生', profile)
    expect(r.score).toBeLessThan(PREFILTER_THRESHOLD)
    expect(r.pass).toBe(false)
    expect(r.reason).toContain('跳过 AI')
  })

  it('阈值可覆盖，便于调试与回测', () => {
    const jd = '负责门店排班与考勤统计'
    expect(prefilterJob(jd, '行政实习生', profile, 10).pass).toBe(true)
    expect(prefilterJob(jd, '行政实习生', profile, 99).pass).toBe(false)
  })
})
