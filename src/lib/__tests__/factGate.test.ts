import { describe, expect, it } from 'vitest'
import type { Profile, Row } from '../../types'

/**
 * 事实守门 —— BENCHMARK P1（career-ops verify-cv-facts 思路的规则版）。
 *
 * 面试官验证你所说数字的方式就是 clone 仓库。面试复盘里写下的数字
 * （「N 条测试」「N 个项目」）必须与简历口径一致——记错或说大了，
 * 面试当场就会被戳穿。规则：面试文本里「口径关键词 + 数字」的组合，
 * 数字必须出现在画像的简历口径文本（resume_summary / self_intro）中。
 *
 * 隐私红线同 blockers：工具只提示「口径对不上」，不断言个人短板；
 * 画像里没有口径文本时宁可不报（同 blockers 的「没线索不报」原则）。
 */

const { interviewFactGate } = await import('../factGate')

const profile: Profile = {
  resume_summary:
    '5 个开源项目 / 6 个仓库，合计 508 条测试（python-learning-agent 146 · campus-mutual-aid 71 · travel-rank 79 · mcp-toolkit 48 · offer-pipeline 前端 129 + agent-platform-java 后端 35）。',
  self_intro: '2028 届计算机本科在读，独立完成 5 个开源项目（6 个仓库、508 条测试），9 条评测。',
}

function iv(id: number, text: string): Row {
  return { id, company: '某公司', questions: text, reflection: '' }
}

describe('interviewFactGate（面试数字 vs 仓库口径）', () => {
  it('口径内的数字不报：146 条测试、508 条合计、9 条评测', () => {
    const items = interviewFactGate(
      [iv(1, '面试官问测试：我说主项目 146 条 pytest，全仓合计 508 条测试，另有 9 条评测')],
      profile,
    )
    expect(items).toHaveLength(0)
  })

  it('口径外的数字报违规，并带原句引用（证据原则）', () => {
    const items = interviewFactGate([iv(2, '我说我写了 200 条测试，还做了 12 条评测')], profile)
    expect(items).toHaveLength(1)
    expect(items[0].ok).toBe(false)
    expect(items[0].label).toContain('200')
    expect(items[0].label).toContain('12')
    expect(items[0].quote).toContain('200 条测试')
  })

  it('口径关键词之外的数字不管：3 个问题、2 点开始 不误报', () => {
    const items = interviewFactGate(
      [iv(3, '面试官问了 3 个问题，下午 2 点开始，聊了 40 分钟')],
      profile,
    )
    expect(items).toHaveLength(0)
  })

  it('画像没有口径文本时宁可不报（同 blockers 的没线索不报）', () => {
    const items = interviewFactGate([iv(4, '我说 999 条测试')], { resume_summary: '', self_intro: '' })
    expect(items).toHaveLength(0)
  })

  it('questions 和 reflection 都扫；多条面试分别出条目', () => {
    const items = interviewFactGate(
      [iv(5, '说了 77 条测试'), iv(6, '')],
      profile,
    )
    expect(items).toHaveLength(1)
    const reflectionIv: Row = { id: 6, company: 'x', questions: '', reflection: '复盘：说了 88 条测试' }
    expect(interviewFactGate([reflectionIv], profile)).toHaveLength(1)
    void items
  })
})
