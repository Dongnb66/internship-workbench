import type { Profile, Row } from '../types'

/**
 * 事实守门 —— BENCHMARK P1（career-ops verify-cv-facts 思路的规则版）。
 *
 * 面试官验证你所说数字的方式就是 clone 仓库。面试复盘里写下的数字
 * （「N 条测试」「N 个项目」）必须与简历口径一致——记错或说大了，
 * 面试当场就会被戳穿。
 *
 * 规则：只扫「口径关键词 + 数字」的组合（测试/断言/评测/冒烟/项目/仓库/智能体/节点），
 * 数字必须出现在画像的口径文本（resume_summary / self_intro）里；
 * 口径关键词之外的数字（聊了几个问题、几点开始）不归它管。
 * 画像没有口径文本时宁可不报（同 blockers 的「没线索不报」原则）。
 *
 * 隐私红线同 blockers：只提示「口径对不上，复核一下」，不断言个人短板。
 */

import type { HealthItem } from './healthCheck'

/** 口径关键词：这些词后面的数字才会被比对 */
const GATE_WORDS = '测试|断言|评测|冒烟|项目|仓库|智能体|节点|接口'

export interface FactGateItem extends HealthItem {
  /** 数字所在的原句片段，用户据此定位并复核 */
  quote: string
  interviewId: number
}

function allowedNumbers(profile: Profile | null): Set<number> {
  const text = `${profile?.resume_summary ?? ''} ${profile?.self_intro ?? ''}`
  const set = new Set<number>()
  for (const m of text.matchAll(/\d+/g)) set.add(Number(m[0]))
  return set
}

function scanText(text: string, allowed: Set<number>): { num: number; quote: string }[] {
  const bad: { num: number; quote: string }[] = []
  for (const m of text.matchAll(new RegExp(`(\\d+)\\s*(?:条|个|款)?\\s*(?:${GATE_WORDS})`, 'g'))) {
    const num = Number(m[1])
    if (!allowed.has(num)) {
      const start = Math.max(0, m.index! - 12)
      bad.push({ num, quote: text.slice(start, Math.min(text.length, m.index! + m[0].length + 8)) })
    }
  }
  return bad
}

/** 面试记录的事实守门：只返回违规条目（空数组 = 全部对得上） */
export function interviewFactGate(interviews: Row[], profile: Profile | null): FactGateItem[] {
  const allowed = allowedNumbers(profile)
  if (allowed.size === 0) return []
  const out: FactGateItem[] = []
  for (const iv of interviews) {
    const text = `${iv.questions ?? ''}\n${iv.reflection ?? ''}`.trim()
    if (!text) continue
    const bad = scanText(text, allowed)
    if (!bad.length) continue
    const nums = [...new Set(bad.map((b) => b.num))].join('、')
    out.push({
      ok: false,
      label: `面试记录里的数字（${nums}）与简历口径不符`,
      fix: '复核是记错了还是说大了：口径以简历为准（面试官会 clone 仓库核对），面试里说错的下次别再说',
      quote: bad[0].quote,
      interviewId: Number(iv.id),
    })
  }
  return out
}
