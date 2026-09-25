import { describe, expect, it } from 'vitest'
import type { Row } from '../../types'

/**
 * 僵尸岗位检测 + 黑名单 —— BENCHMARK P1（career-ops detect-reposts 思路
 * + get_jobs 的三类黑名单维度，只借鉴维度设计不搬代码）。
 *
 * 「僵尸岗位」：同一家公司同一岗位你挂过/失效过，它换个渠道又出现了——
 * 再投大概率还是同样的结局，时间应该给新机会。判定复用 import.ts 的 dedupeKey
 * （契约一致性：入库查重和僵尸识别必须认同一个「同岗位」）。
 *
 * 黑名单三类维度（company / recruiter / job）按 get_jobs 的实体设计；
 * 存储用 localStorage（设备级偏好，与模型选择同一先例），这里只做纯匹配函数。
 */

const { flagReposts, REPOST_REASON } = await import('../reposts')
const { matchBlacklist } = await import('../blacklist')

describe('flagReposts（僵尸岗位识别）', () => {
  const pool: Row[] = [
    { id: 1, company: '凯通科技', title: 'Java 全栈实习', status: 'rejected' },
    { id: 2, company: '腾讯', title: 'AI 全栈工程师', status: 'pool' },
    { id: 3, company: '某厂', title: '后端实习', status: 'archived' },
  ]

  it('同公司同岗位、池里状态是 rejected/archived → 标记为僵尸重发', () => {
    const incoming: Row[] = [
      { id: 91, company: '凯通科技', title: 'Java 全栈实习' },
      { id: 92, company: '凯通科技', title: 'Java全栈招聘' }, // 归一化后同键（去空格/「招聘」后缀）
      { id: 93, company: '腾讯', title: 'AI 全栈工程师' },
    ]
    const flags = flagReposts(incoming, pool)
    expect(flags.map((f) => f.job.id).sort()).toEqual([91, 92])
    expect(flags[0].priorStatus).toBe('rejected')
    expect(flags[0].reason).toBe(REPOST_REASON)
  })

  it('池里还在正常跟踪（pool/applied）的不算僵尸——那只是重复，不是重发', () => {
    const incoming: Row[] = [{ id: 94, company: '腾讯', title: 'AI 全栈工程师' }]
    expect(flagReposts(incoming, pool)).toHaveLength(0)
  })

  it('新公司新岗位不误报', () => {
    const incoming: Row[] = [{ id: 95, company: '新公司', title: '新岗位' }]
    expect(flagReposts(incoming, pool)).toHaveLength(0)
  })
})

describe('matchBlacklist（黑名单三类维度）', () => {
  const list: { type: 'company' | 'recruiter' | 'job'; value: string; addedAt: string }[] = [
    { type: 'company', value: '骗子公司', addedAt: '2026-09-25' },
    { type: 'recruiter', value: '张中介', addedAt: '2026-09-25' },
    { type: 'job', value: '凯通科技||java全栈', addedAt: '2026-09-25' },
  ]

  it('公司黑名单命中（大小写与首尾空格无关）', () => {
    const hits = matchBlacklist({ company: ' 骗子公司 ', title: '任何岗位' }, list)
    expect(hits).toHaveLength(1)
    expect(hits[0].type).toBe('company')
  })

  it('岗位键黑名单按 dedupeKey 命中', () => {
    const hits = matchBlacklist({ company: '凯通科技', title: 'Java 全栈' }, list)
    expect(hits).toHaveLength(1)
    expect(hits[0].type).toBe('job')
  })

  it('recruiter 维度在岗位数据上不可判定 → 不命中也不报错', () => {
    expect(matchBlacklist({ company: '清白公司', title: '好岗位' }, list)).toHaveLength(0)
    expect(matchBlacklist({}, list)).toHaveLength(0)
  })
})
