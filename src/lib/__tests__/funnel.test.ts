import { describe, expect, it } from 'vitest'
import type { Row } from '../../types'

/**
 * 漏斗转化统计 —— BENCHMARK P0（来自 career-ops stats / rejection-latency 的思路）。
 *
 * 为什么必须做：投递阶段历史一直在积累（沟通台账 + 面试记录），但没有汇总——
 * 「投了多少、几个有回复、几个到面试、转化率多少、卡在哪一环」全靠脑子记。
 * 数据输入只有四张表：applications / messages / interviews / offers（+ jobs 取匹配分做校准）。
 */

const { funnelStats, calibration } = await import('../funnel')

const apps: Row[] = [
  { id: 1, company: '腾讯', title: 'AI 全栈', stage: 'applied', job_id: 201, applied_at: '2026-09-25' },
  { id: 2, company: '同元软控', title: 'Agent 实习', stage: 'written', job_id: 202, applied_at: '2026-09-20' },
  { id: 3, company: '行至智能', title: 'AI Agent 全栈', stage: 'interview', job_id: 203, applied_at: '2026-09-15' },
  { id: 4, company: '凯通科技', title: 'Java 全栈', stage: 'rejected', job_id: 204, applied_at: '2026-09-10' },
  { id: 5, company: '大湾区国创', title: 'AI 检索后端', stage: 'offer', job_id: 205, applied_at: '2026-09-05' },
]

const msgs: Row[] = [
  // 腾讯：打了招呼，无回复
  { id: 1, application_id: 1, reply_status: 'sent', direction: 'out', sent_at: '2026-09-25T09:00:00' },
  // 同元：已回复，约了笔试
  { id: 2, application_id: 2, reply_status: 'replied', direction: 'in', sent_at: '2026-09-21T10:00:00' },
  { id: 3, application_id: 2, reply_status: 'interview', direction: 'in', sent_at: '2026-09-22T10:00:00' },
  // 行至：直接约面
  { id: 4, application_id: 3, reply_status: 'interview', direction: 'in', sent_at: '2026-09-16T10:00:00' },
  // 凯通：被婉拒
  { id: 5, application_id: 4, reply_status: 'rejected', direction: 'in', sent_at: '2026-09-11T10:00:00' },
]

const interviews: Row[] = [{ id: 1, application_id: 3, company: '行至智能', kind: '面试', result: 'pending' }]

const jobs: Row[] = [
  { id: 201, url: '', match_score: 40 },
  { id: 202, match_score: 75 },
  { id: 203, match_score: 82 },
  { id: 204, match_score: 30 },
  { id: 205, match_score: 88 },
]

describe('funnelStats（投递 → 回复 → 面试 → Offer）', () => {
  const stats = funnelStats(apps, msgs, interviews, [])

  it('总数与阶段计数', () => {
    expect(stats.applied).toBe(5)
    expect(stats.byStage.rejected).toBe(1)
  })

  it('回复 = 对方回过话的投递（replied/interview 状态或阶段已推进）', () => {
    // 同元/行至/凯通 都有回复；大湾区 stage=offer 也算；腾讯只有 sent 不算
    expect(stats.replied).toBe(4)
  })

  it('面试 = 有约面消息、或面试记录、或阶段推进到面试', () => {
    // 同元(约笔试消息 interview)、行至(消息+面试记录)、大湾区(阶段 offer)
    expect(stats.interview).toBe(3)
  })

  it('Offer = 阶段到达或 offers 表有记录', () => {
    expect(stats.offer).toBe(1)
  })

  it('转化率：回复率 80%、面试率 60%、Offer 率 20%，回复后到面 75%', () => {
    expect(stats.repliedRate).toBe(80)
    expect(stats.interviewRate).toBe(60)
    expect(stats.offerRate).toBe(20)
    expect(stats.interviewAfterReplyRate).toBe(75)
  })

  it('零投递时不产生 NaN（比率全为 0）', () => {
    const empty = funnelStats([], [], [], [])
    expect(empty.applied).toBe(0)
    expect(empty.repliedRate).toBe(0)
    expect(empty.interviewAfterReplyRate).toBe(0)
  })
})

describe('calibration（评分校准：当时评的分 vs 实际结果）', () => {
  it('被拒的均分 vs 进入面试的均分，差值就是预筛的准头', () => {
    const cal = calibration(apps, jobs)
    // 被拒：凯通 30 分；进入面试（written/interview/offer）：同元75 行至82 大湾区88 → 均分 81.7
    expect(cal.rejectedAvg).toBe(30)
    expect(cal.advancedAvg).toBe(82)
    expect(cal.gap).toBe(52)
  })

  it('没有结果数据时返回 null，不硬编 0', () => {
    const cal = calibration([apps[0]], [jobs[0]])
    expect(cal.rejectedAvg).toBeNull()
    expect(cal.advancedAvg).toBeNull()
    expect(cal.gap).toBeNull()
  })
})
