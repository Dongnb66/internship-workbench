import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 限额护栏**接在唯一模型入口上**的断言（AGENT_PLAN 第一步的落地部分）。
 *
 * 为什么挡在 streamChat 内部而不是各个页面：本应用有 8 个模型调用点，
 * 页面各挡一次等于「谁记得写 guard 谁才有 guard」——正是仓库踩过的那类错位
 * （手写清单漏掉第 8 个调用点）。挡在 streamChat 里，新增调用点**默认就被挡**；
 * task 名做成必填参数，漏标的调用点在编译期就红，配合 aiQuotaCoverage.test.mjs 兜住。
 *
 * 记账落在 localStorage（设备级），理由见 quota.ts 文件头。
 */
import { DEFAULT_QUOTA } from '../quota'
import { recentDays, todayISO } from '../format'

let createCalls = 0
let createError: any = null

vi.mock('../../cloud', () => ({
  cloud: {
    llm: {
      models: { list: async () => [{ id: 'm1', name: '模型一', enabled: true }] },
      chat: {
        completions: {
          create: async () => {
            createCalls += 1
            if (createError) throw createError
            return (async function* () {
              yield { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }
            })()
          },
        },
      },
    },
  },
  errText: (e: unknown) => String(e),
}))

const mem = new Map<string, string>()
const localStub = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
}
;(globalThis as any).localStorage = localStub
;(globalThis as any).sessionStorage = localStub

const { getQuotaSnapshot, streamChat } = await import('../ai')
const { setOwnerTrialEnabled } = await import('../billing')


const TODAY = todayISO()
const quotaKey = `wb_quota_${TODAY}`

/** 直接写额度流水，不经过被测代码——否则「写进去」和「读出来」互相圆场 */
function seedTasks(names: string[]): void {
  mem.set(quotaKey, JSON.stringify(names))
}

function repeated(task: string, times: number): string[] {
  return Array.from({ length: times }, () => task)
}

function distinctTasks(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `任务${i}`)
}

beforeEach(() => {
  mem.clear()
  // 计费门默认关闭；这里测的是创建者试用档那条通道，必须显式打开（清完存储要重开）
  setOwnerTrialEnabled(true)
  createCalls = 0
  createError = null
})

describe('额度不足时一个请求都不发', () => {
  it('当天任务数已满 → 拒绝，且不打到模型（拒了还发请求等于没挡）', async () => {
    seedTasks(distinctTasks(DEFAULT_QUOTA.dailyTasks))
    await expect(streamChat({ system: 's', user: 'u', task: 'JD 评估' })).rejects.toThrow(/额度|今天/)
    expect(createCalls).toBe(0)
  })

  it('拒绝的文案点名创建者额度（用户不会以为自己欠费）', async () => {
    seedTasks(distinctTasks(DEFAULT_QUOTA.dailyTasks))
    await expect(streamChat({ system: 's', user: 'u', task: 'JD 评估' })).rejects.toThrow(/创建者/)
  })

  it('单个任务转满 maxCallsPerTask 圈 → 熔断（这就是 agent 死循环那一道）', async () => {
    seedTasks(repeated('每日巡检', DEFAULT_QUOTA.maxCallsPerTask))
    await expect(streamChat({ system: 's', user: 'u', task: '每日巡检' })).rejects.toThrow(/上限|循环|步数/)
    expect(createCalls).toBe(0)
  })

  it('昨天的流水不算今天的量', async () => {
    const yester = recentDays(2)[0]
    mem.set(`wb_quota_${yester}`, JSON.stringify(distinctTasks(DEFAULT_QUOTA.dailyTasks)))
    await expect(streamChat({ system: 's', user: 'u', task: 'JD 评估' })).resolves.toBe('ok')
  })
})

describe('放行时记账', () => {
  it('正常调用把这次记进流水（漏记等于护栏自己失效）', async () => {
    const text = await streamChat({ system: 's', user: 'u', task: '打招呼' })
    expect(text).toBe('ok')
    expect(createCalls).toBe(1)
    expect(JSON.parse(mem.get(quotaKey) ?? '[]')).toEqual(['打招呼'])
  })

  it('同一任务连续调用累加在同一格子里', async () => {
    await streamChat({ system: 's', user: 'u', task: '每日巡检' })
    await streamChat({ system: 's', user: 'u', task: '每日巡检' })
    expect(JSON.parse(mem.get(quotaKey) ?? '[]')).toEqual(['每日巡检', '每日巡检'])
    expect(getQuotaSnapshot().usedTasks).toBe(1)
  })

  it('请求发出去后失败也要记账：额度已经真花掉了', async () => {
    createError = new Error('上游炸了')
    await expect(streamChat({ system: 's', user: 'u', task: '简历分析' })).rejects.toThrow()
    expect(createCalls).toBe(1)
    expect(JSON.parse(mem.get(quotaKey) ?? '[]')).toEqual(['简历分析'])
  })

  it('用户主动停止（AbortError）不记账：没花额度不该扣', async () => {
    createError = Object.assign(new Error('aborted'), { name: 'AbortError' })
    await expect(streamChat({ system: 's', user: 'u', task: '面试准备包' })).rejects.toThrow('aborted')
    expect(mem.get(quotaKey)).toBeUndefined()
  })
})

describe('存储坏掉时的姿态', () => {
  /**
   * 两道门在存储坏掉时**方向相反**，这是刻意的，别改回去：
   * - 额度台账读不到 → fail-open（挡不住就放行），因为误伤一个自用工作台不划算；
   * - 计费门读不到 → fail-**closed**（一律拒绝），因为"读不到试用开关"的默认值
   *   只能是「没人同意花创建者的钱」。
   * 原来这条断言写的是「降级仍放行」，那是计费门存在之前的语义；现在放行的是计费错误文案，
   * 而不是悄悄用你的额度把请求发出去。
   */
  it('localStorage 读写抛错 → 计费门拒绝发请求（额度侧仍是降级可见，但不参与决定）', async () => {
    const real = (globalThis as any).localStorage
    ;(globalThis as any).localStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceeded')
      },
    }
    try {
      await expect(streamChat({ system: 's', user: 'u', task: 'JD 评估' })).rejects.toThrow(/自备|Key|开通/)
      expect(createCalls).toBe(0)
      // 额度快照本身仍要如实标出降级，设置页靠这句话提示用户
      const { getQuotaSnapshot } = await import('../ai')
      expect(getQuotaSnapshot().degraded).toBe(true)
    } finally {
      ;(globalThis as any).localStorage = real
    }
  })
})

describe('getQuotaSnapshot：设置页与巡检面板要能显示剩余额度', () => {
  it('没用过时满额可用', () => {
    const s = getQuotaSnapshot()
    expect(s.remainingTasks).toBe(DEFAULT_QUOTA.dailyTasks)
    expect(s.allowed).toBe(true)
    expect(s.degraded).toBe(false)
  })

  it('用过之后剩余变少、已用对得上', async () => {
    await streamChat({ system: 's', user: 'u', task: '打招呼' })
    const s = getQuotaSnapshot()
    expect(s.usedTasks).toBe(1)
    expect(s.remainingTasks).toBe(DEFAULT_QUOTA.dailyTasks - 1)
  })
})
