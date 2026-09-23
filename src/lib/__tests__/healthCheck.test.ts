import { describe, expect, it } from 'vitest'

import { healthSummary, profileHealth } from '../healthCheck'
import { PROFILE_TEMPLATE } from '../constants'
import type { Profile } from '../../types'

const full: Profile = {
  ...PROFILE_TEMPLATE,
  phone: '13800000000',
  contact_email: 'me@example.com',
  github: 'https://github.com/Dongnb66',
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
