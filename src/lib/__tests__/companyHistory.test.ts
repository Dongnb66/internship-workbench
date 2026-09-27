import { describe, expect, it } from 'vitest'

/**
 * 「同一家公司在我的池子里是什么历史」——投递决策智能体的对照面（AGENT_PLAN 第三步）。
 *
 * 为什么需要它：单看一个 JD 永远判断不出「值不值得投」。同一家公司已经在池里挂了 6 个岗位、
 * 上次投了 3 轮全挂、匹配分平均 41，那第 7 个岗位的性价比就必须带着这些事实来评估。
 * 模型自己查不到这种横向对照，所以做成纯函数工具。
 *
 * 纪律：本文件先红在 `../companyHistory` 不存在。
 */
import { companyHistory } from '../companyHistory'

const TODAY = '2026-09-26'

function job(id: number, company: string, over: Record<string, unknown> = {}) {
  return { id, company, title: '后端实习', match_score: 60, status: '待投', ...over }
}

describe('companyHistory：按公司聚合池内与投递历史', () => {
  it('只看这一家公司，别的公司一条都不许混进来', () => {
    const jobs = [job(1, '字节'), job(2, '美团'), job(3, '字节')]
    const h = companyHistory(jobs, [], '字节', [], TODAY)
    expect(h.company).toBe('字节')
    expect(h.poolJobs.map((j) => j.id).sort()).toEqual([1, 3])
  })

  it('公司名匹配忽略大小写与首尾空格（平台写的和粘进来的经常不一致）', () => {
    const jobs = [job(1, '  ByteDance  ')]
    const h = companyHistory(jobs, [], 'bytedance', [], TODAY)
    expect(h.poolJobs).toHaveLength(1)
  })

  it('投递阶段汇总：投了几条、到哪一步、有没有被拒', () => {
    const jobs = [job(1, '字节'), job(2, '字节')]
    const apps = [
      { id: 11, job_id: 1, company: '字节', stage: 'rejected' },
      { id: 12, job_id: 2, company: '字节', stage: 'interview' },
    ]
    const h = companyHistory(jobs, apps, '字节', [], TODAY)
    expect(h.applied).toBe(2)
    expect(h.rejected).toBe(1)
    expect(h.reachedInterview).toBe(1)
    expect(h.stages).toEqual(expect.arrayContaining(['rejected', 'interview']))
  })

  it('投递没有 job_id 时按公司名归到同一家（历史数据里 job_id 常缺）', () => {
    const jobs = [job(1, '字节')]
    const apps = [{ id: 11, company: '字节', stage: 'rejected' }]
    const h = companyHistory(jobs, apps, '字节', [], TODAY)
    expect(h.applied).toBe(1)
    expect(h.rejected).toBe(1)
  })

  it('平均匹配分只算真的评过分的（没评分的岗位不能当 0 分拉低均值）', () => {
    const jobs = [job(1, '字节', { match_score: 80 }), job(2, '字节', { match_score: null }), job(3, '字节', { match_score: 60 })]
    const h = companyHistory(jobs, [], '字节', [], TODAY)
    expect(h.avgScore).toBe(70)
    expect(h.scoredCount).toBe(2)
    // 没评分的那条要如实标出来，否则用户以为三个岗位都评过了
    expect(h.unscored).toBe(1)
  })

  it('最近一次沟通带回来：上次跟这家公司说话是什么时候', () => {
    const jobs = [job(1, '字节')]
    const apps = [{ id: 11, job_id: 1, company: '字节', stage: 'applied' }]
    const messages = [
      { id: 1, application_id: 11, direction: 'out', sent_at: '2026-09-02T10:00:00' },
      { id: 2, application_id: 11, direction: 'in', sent_at: '2026-09-15T09:00:00', replied_at: '2026-09-16' },
    ]
    const h = companyHistory(jobs, apps, '字节', messages, TODAY)
    expect(h.lastContactAt).toBe('2026-09-16')
    expect(h.daysSinceLastContact).toBe(10)
  })

  it('没有这家公司任何记录时给出空历史而不是 undefined（工具结果要能直接拼进 prompt）', () => {
    const h = companyHistory([job(1, '美团')], [], '字节', [], TODAY)
    expect(h.poolJobs).toEqual([])
    expect(h.applied).toBe(0)
    expect(h.avgScore).toBeNull()
    expect(h.lastContactAt).toBeNull()
    expect(h.daysSinceLastContact).toBeNull()
    expect(JSON.stringify(h)).toBeTruthy()
  })

  it('大池子要裁剪：结果直接进 prompt，不能把 300 条岗位全倒进去', () => {
    const jobs = Array.from({ length: 300 }, (_, i) => job(i + 1, '字节', { match_score: 50 + (i % 30) }))
    const h = companyHistory(jobs, [], '字节', [], TODAY)
    expect(h.poolJobs.length).toBeLessThanOrEqual(20)
    expect(h.truncated).toBe(true)
    expect(h.hidden).toBeGreaterThan(0)
    // 总数仍然要说实话，否则模型以为池子里只有 20 条
    expect(h.poolTotal).toBe(300)
  })

  it('空公司名不炸：返回空历史（用户还没填公司时工具也会被调到）', () => {
    const h = companyHistory([job(1, '字节')], [], '', [], TODAY)
    expect(h.poolTotal).toBe(0)
    expect(h.company).toBe('')
  })
})
