// 第一步「限额护栏」的断言。
//
// 纪律：这一批断言必须先变红，再看它红在预期位置。所有额度判断都是**纯函数**
// （输入是已有的调用流水，不是模块内部的隐式状态），这样「关掉守卫就变红」可验证。
//
// 为什么额度单位是「任务」而不是「调用」：AGENT_PLAN §5 红线写的就是这个 —— 用户能理解
// 「今天还能跑 20 次巡检/评估」，理解不了「还能调 137 次模型」。但任务数挡不住
// **单次任务内部的失控循环**，所以另外两道上限（每任务调用数、每日调用总数）必须同时存在。

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUOTA,
  canStartTask,
  createQuotaStore,
  quotaStatus,
  type CallRecord,
} from '../quota'

const NOW = new Date('2026-09-26T10:30:00+08:00')
const TODAY = '2026-09-26'
const YESTERDAY = '2026-09-25'

function rec(task: string, day = TODAY): CallRecord {
  return { day, task }
}

/** 同一个任务里的 n 次模型调用（agent 循环一圈 = 一次调用，任务名不变） */
function calls(n: number, task: string): CallRecord[] {
  return Array.from({ length: n }, () => rec(task))
}

/** n 个**互不相同**的任务，每个只调一次（用户视角「今天干了 n 件事」） */
function tasks(n: number): CallRecord[] {
  return Array.from({ length: n }, (_, i) => rec(`任务${i + 1}`))
}

describe('额度配置', () => {
  it('三道上限都在，且缺任何一道就挡不住 agent 循环', () => {
    // dailyTasks 管用户可见的「今天还能干几件事」；
    // maxCallsPerTask 管「一件事最多转几圈」；maxCallsPerDay 是总保险丝。
    expect(DEFAULT_QUOTA.dailyTasks).toBeGreaterThan(0)
    expect(DEFAULT_QUOTA.maxCallsPerTask).toBeGreaterThan(1)
    expect(DEFAULT_QUOTA.maxCallsPerDay).toBeGreaterThanOrEqual(DEFAULT_QUOTA.dailyTasks)
    // 每任务调用数必须 ≤ maxSteps：agent 一圈一次调用，超了就等于护栏比循环还松
    expect(DEFAULT_QUOTA.maxCallsPerTask).toBeLessThanOrEqual(8)
  })
})

describe('quotaStatus：按天派生，不靠手写计数器', () => {
  it('今天一次没用过 → 允许，并给出剩余任务数', () => {
    const s = quotaStatus([], DEFAULT_QUOTA, NOW)
    expect(s.usedTasks).toBe(0)
    expect(s.remainingTasks).toBe(DEFAULT_QUOTA.dailyTasks)
    expect(s.allowed).toBe(true)
    expect(s.reasons).toEqual([])
  })

  it('任务数用满 → 拒绝，且原因点名「今天」和额度归属（不是用户欠费）', () => {
    const used = tasks(DEFAULT_QUOTA.dailyTasks)
    const s = quotaStatus(used, DEFAULT_QUOTA, NOW)
    expect(s.usedTasks).toBe(DEFAULT_QUOTA.dailyTasks)
    expect(s.allowed).toBe(false)
    expect(s.remainingTasks).toBe(0)
    // 红线：额度记在应用创建者账号上。文案如果不含这个意思，用户会以为自己欠费
    // 去找客服，而那个客服跟他对不上（AGENTS/aiErrorText 同一条理由）。
    expect(s.reasons.join('')).toMatch(/今天|今日/)
    expect(s.reasons.join('')).toMatch(/创建者/)
  })

  it('昨天的流水不影响今天（按天窗口是从 day 字段派生的，不是累加计数器）', () => {
    const many = tasks(DEFAULT_QUOTA.dailyTasks + 5).map((r) => ({ ...r, day: YESTERDAY }))
    const s = quotaStatus(many, DEFAULT_QUOTA, NOW)
    expect(s.usedTasks).toBe(0)
    expect(s.allowed).toBe(true)
  })

  it('同一任务的多次调用只算一个任务，但受每任务上限约束', () => {
    const oneTaskManyCalls = calls(5, '生成行动清单')
    const s = quotaStatus(oneTaskManyCalls, DEFAULT_QUOTA, NOW)
    expect(s.usedTasks).toBe(1)
    expect(s.callsInTask.get('生成行动清单')).toBe(5)
  })

  it('单个任务转满 maxCallsPerTask 圈 → 该任务被熔断（这就是 agent 失控的那一道）', () => {
    const looping = calls(DEFAULT_QUOTA.maxCallsPerTask, '每日巡检')
    const s = quotaStatus(looping, DEFAULT_QUOTA, NOW)
    expect(s.usedTasks).toBe(1) // 对用户仍是「1 件事」
    expect(s.taskStopped).toBe(true) // 但这件事不许再转了
    expect(s.allowed).toBe(false)
    expect(s.reasons.join('')).toMatch(/循环|步数|上限/)
  })

  it('总保险丝：任务数没超但当日调用超了 → 仍然拒绝', () => {
    // 构造：几个任务、每个都离每任务上限还差一点，总量却已过每日调用上限
    const per = DEFAULT_QUOTA.maxCallsPerTask - 1
    const neededTasks = Math.ceil(DEFAULT_QUOTA.maxCallsPerDay / per)
    const many: CallRecord[] = []
    for (let i = 0; i < neededTasks; i += 1) many.push(...calls(per, `任务${i}`))
    expect(many.length).toBeGreaterThanOrEqual(DEFAULT_QUOTA.maxCallsPerDay)
    const s = quotaStatus(many, DEFAULT_QUOTA, NOW)
    expect(s.usedTasks).toBeLessThan(DEFAULT_QUOTA.dailyTasks) // 不是靠任务数挡住的
    expect(s.allowed).toBe(false)
    expect(s.callsToday).toBeGreaterThanOrEqual(DEFAULT_QUOTA.maxCallsPerDay)
  })
})

describe('canStartTask：面向「用户点一下」的入口', () => {
  it('额度满时拒绝开新任务，并说明是额度而不是网络问题', () => {
    const used = tasks(DEFAULT_QUOTA.dailyTasks)
    const r = canStartTask(used, DEFAULT_QUOTA, NOW)
    expect(r.allowed).toBe(false)
    expect(r.text).toMatch(/额度|用完/)
  })

  it('额度没用完时放行', () => {
    const r = canStartTask(tasks(1), DEFAULT_QUOTA, NOW)
    expect(r.allowed).toBe(true)
    expect(r.text).toBe('')
  })
})

describe('focusTask：每任务熔断只针对「正在问的那个任务」', () => {
  it('另一个任务已经失控，不影响这个正常任务继续', () => {
    // 批量评估 20 个岗位时，每个岗位各是一件事；如果把「所有任务里最大的那个」当成熔断依据，
    // 第 9 个岗位会被一句「agent 循环被熔断」误杀 —— 熔断必须问对了对象才算数。
    const rows = [...calls(DEFAULT_QUOTA.maxCallsPerTask, '每日巡检'), ...calls(2, '打招呼')]
    const s = quotaStatus(rows, DEFAULT_QUOTA, NOW, '打招呼')
    expect(s.taskStopped).toBe(false)
    expect(s.allowed).toBe(true)
  })

  it('问的就是那个失控任务 → 仍然熔断', () => {
    const rows = [...calls(DEFAULT_QUOTA.maxCallsPerTask, '每日巡检'), ...calls(2, '打招呼')]
    const s = quotaStatus(rows, DEFAULT_QUOTA, NOW, '每日巡检')
    expect(s.taskStopped).toBe(true)
    expect(s.allowed).toBe(false)
    expect(s.reasons.join('')).toContain('每日巡检')
  })

  it('没见过的任务名：taskStopped 为 false，但当天任务数满了照样挡', () => {
    const rows = tasks(DEFAULT_QUOTA.dailyTasks)
    const s = quotaStatus(rows, DEFAULT_QUOTA, NOW, '第一次跑的任务')
    expect(s.taskStopped).toBe(false)
    expect(s.allowed).toBe(false)
  })
})

describe('存储不可用时的姿态（隐私模式 / 配额爆了）', () => {
  it('读写额度记录失败 → 明确标记降级，不静默假装「还有额度」', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceeded')
      },
    }
    const store = createQuotaStore(broken)
    expect(store.available).toBe(false)
    // 降级时必须让调用方知道「这一条挡不住了」，而不是 silently allow。
    // 选 fail-open 的理由写进实现注释：这是自用工作台，把 AI 全禁掉会让人连手工记录都用不了；
    // 但降级状态必须可见（UI 要提示），否则护栏坏掉没人知道。
    const s = store.status(TODAY)
    expect(s.degraded).toBe(true)
    expect(s.allowed).toBe(true)
  })

  it('存储可用时不降级', () => {
    const mem = new Map<string, string>()
    const store = createQuotaStore({
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    })
    expect(store.available).toBe(true)
    store.record('每日巡检', TODAY)
    const s = store.status(TODAY)
    expect(s.usedTasks).toBe(1)
    expect(s.degraded).toBe(false)
  })
})
