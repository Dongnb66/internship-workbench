import { describe, expect, it } from 'vitest'

import { healthSummary, profileHealth } from '../healthCheck'
import type { Profile } from '../../types'

/**
 * 「齐全画像」用自己的假数据，不复用 PROFILE_TEMPLATE。
 *
 * 以前这里是 `{...PROFILE_TEMPLATE}`，于是模板一改，体检的测试就跟着红 ——
 * 而模板现在的职责恰恰是**骨架**（全是【】占位、技能只有 1 条、数字字段留空），
 * 拿它当「齐全」的样本是在断言一件反过来的事。
 */
const full: Profile = {
  full_name: '张三',
  grade: '大三',
  grad_year: '2028 届',
  major: '计算机科学与技术',
  school: '某大学',
  expect_city: ['广州', '远程'],
  expect_type: ['实习', '日常实习'],
  expect_daily: 180,
  skills: ['Python', 'FastAPI', 'React', 'TypeScript', 'Docker'],
  directions: ['AI Agent 应用', 'LLM 工程'],
  available_days: '每周 5 天，可连续实习 6 个月以上',
  self_intro:
    '2028 届计算机科学与技术本科在读，独立完成 3 个带测试的开源项目，主力项目用 FastAPI + LangGraph 实现多智能体系统，含检索增强与三层记忆。',
  resume_summary: '3 个开源项目 / 4 个仓库，合计 120 条测试，全部可 clone 复跑。',
  phone: '13800000000',
  contact_email: 'me@example.com',
  github: 'https://github.com/someone',
  portfolio: 'https://example.com',
} as Profile

describe('profileHealth', () => {
  it('画像齐全 + 有简历时全部通过', () => {
    const items = profileHealth(full, 1)
    expect(items.every((i) => i.ok), `未过的项：${items.filter((i) => !i.ok).map((i) => i.label).join('、')}`).toBe(true)
  })

  it('空画像 + 无简历：每一项都不过，且每条都给修复动作', () => {
    const items = profileHealth(null, 0)
    expect(items.every((i) => !i.ok)).toBe(true)
    for (const i of items) {
      expect(i.fix, `「${i.label}」缺修复动作`).toBeTruthy()
    }
  })

  it('简历库为空单独报出来', () => {
    const items = profileHealth(full, 0)
    const resumeItem = items.find((i) => i.label.includes('简历库'))
    expect(resumeItem?.ok).toBe(false)
  })

  it('技能少于 5 个会报（匹配分会失真）', () => {
    const few: Profile = { ...full, skills: ['Python'] }
    const items = profileHealth(few, 1)
    const skillItem = items.find((i) => i.label.includes('技能关键词'))
    expect(skillItem?.ok).toBe(false)
    expect(skillItem?.fix).toContain('匹配分')
  })

  it('数字口径检查：项目与可验证事实里必须有数字', () => {
    const noNumbers: Profile = { ...full, resume_summary: '做过一些项目，写过一些测试，效果不错。' }
    const items = profileHealth(noNumbers, 1)
    const item = items.find((i) => i.label.includes('数字口径'))
    expect(item?.ok).toBe(false)
  })

  it('自我介绍太短会报', () => {
    const short: Profile = { ...full, self_intro: '你好' }
    const items = profileHealth(short, 1)
    const item = items.find((i) => i.label.includes('自我介绍'))
    expect(item?.ok).toBe(false)
  })
})

describe('healthSummary', () => {
  it('统计通过与总数', () => {
    const items = profileHealth(full, 1)
    const s = healthSummary(items)
    expect(s.total).toBe(items.length)
    expect(s.passed).toBe(items.length)
    expect(s.allOk).toBe(true)
  })

  it('有不过项时 allOk 为 false', () => {
    const s = healthSummary(profileHealth(null, 0))
    expect(s.allOk).toBe(false)
    expect(s.passed).toBe(0)
  })
})
