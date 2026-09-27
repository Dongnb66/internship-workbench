import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 计费门的断言。
 *
 * 一句话目的：**默认不花创建者的钱**。这个应用原先只有一条通道（平台云服务额度，
 * 语义是 Creator quota），意味着「任何注册用户点一下 AI，钱记在你账上」。
 * 现在加一道门：没有用户自己的 key、也没显式开试用开关，AI 一律不调用。
 *
 * 三条最容易出事的地方，每条都是真实会发生的，不是我想象的：
 * 1. 「配了 key 但通道还没接通」时**悄悄回落到平台额度**——那正是这次要消灭的行为，
 *    而且它不会报错，只会让你的账单安静地涨。
 * 2. 开关默认打开。默认必须是关。
 * 3. 门只挡在页面上：将来新增一个 AI 功能忘了挡，就又是一条白跑的路。
 *    所以门挡在唯一入口 `streamChat` 里，另有一条源码级断言兜底。
 */

let createCalls = 0

vi.mock('../../cloud', () => ({
  cloud: {
    llm: {
      models: { list: async () => [{ id: 'm1', name: '模型', enabled: true, credits: 'x0.11 credits' }] },
      chat: {
        completions: {
          create: async () => {
            createCalls += 1
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
const stub = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
}
;(globalThis as any).localStorage = stub
;(globalThis as any).sessionStorage = stub

const { decideAccess } = await import('../billing')
const { OWNER_TRIAL_KEY, getOwnerTrialEnabled, setOwnerTrialEnabled, setByoReady } = await import('../billing')
const { streamChat } = await import('../ai')
const { DEFAULT_QUOTA } = await import('../quota')
const { todayISO } = await import('../format')

beforeEach(() => {
  mem.clear()
  createCalls = 0
  setByoReady(false)
  setOwnerTrialEnabled(false)
})

describe('decideAccess：谁付钱这件事只有一个判定点', () => {
  it('没 key、没开试用 → 不放行，且明确说「不消耗本应用额度」这条路在哪', () => {
    const a = decideAccess({ hasUserKey: false, ownerTrial: false, byoReady: false })
    expect(a.allowed).toBe(false)
    expect(a.access).toBe('none')
    expect(a.reason).toMatch(/自备|自己的.*Key|开通/)
  })

  it('有 key 但通道没接通：**绝不回落到创建者额度**（宁可拒绝）', () => {
    const a = decideAccess({ hasUserKey: true, ownerTrial: false, byoReady: false })
    expect(a.allowed).toBe(false)
    expect(a.access).toBe('none')
    expect(a.reason).toMatch(/未接通|没接通|本地网关|稍后/)
    expect(a.paidBy).not.toBe('creator')
  })

  it('有 key 且通道就绪 → 走 byo，付款方是用户', () => {
    const a = decideAccess({ hasUserKey: true, ownerTrial: false, byoReady: true })
    expect(a.allowed).toBe(true)
    expect(a.access).toBe('byo')
    expect(a.paidBy).toBe('user')
  })

  it('创建者试用档：明确标出来是创建者付，不是一句「额度不足」糊过去', () => {
    const a = decideAccess({ hasUserKey: false, ownerTrial: true, byoReady: false })
    expect(a.allowed).toBe(true)
    expect(a.access).toBe('owner-trial')
    expect(a.paidBy).toBe('creator')
  })

  it('同时有 key 又开了试用 → 用用户自己的 key，不动创建者的额度', () => {
    const a = decideAccess({ hasUserKey: true, ownerTrial: true, byoReady: true })
    expect(a.access).toBe('byo')
    expect(a.paidBy).toBe('user')
  })
})

describe('试用开关的默认值', () => {
  it('没设置过 = 关', () => {
    expect(getOwnerTrialEnabled()).toBe(false)
    expect(mem.get(OWNER_TRIAL_KEY)).toBeUndefined()
  })

  it('打开后能被读回来，且值是显式写入的字符串', () => {
    setOwnerTrialEnabled(true)
    expect(getOwnerTrialEnabled()).toBe(true)
    expect(mem.get(OWNER_TRIAL_KEY)).toBeTruthy()
  })

  it('存储不可用时读到的是「关」而不是抛错（宁可不能用，不可悄悄花钱）', () => {
    const real = (globalThis as any).localStorage
    ;(globalThis as any).localStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => undefined,
    }
    try {
      expect(getOwnerTrialEnabled()).toBe(false)
    } finally {
      ;(globalThis as any).localStorage = real
    }
  })
})

describe('streamChat 上真的挂了这道门', () => {
  it('默认状态下一次模型请求都不发，也不记额度账', async () => {
    await expect(streamChat({ system: 's', user: 'u', task: 'JD 评估' })).rejects.toThrow(/自备|Key|开通/)
    expect(createCalls).toBe(0)
    expect(mem.get(`wb_quota_${todayISO()}`)).toBeUndefined()
  })

  it('开了试用档才放行（并仍受额度护栏约束）', async () => {
    setOwnerTrialEnabled(true)
    await expect(streamChat({ system: 's', user: 'u', task: 'JD 评估' })).resolves.toBe('ok')
    expect(createCalls).toBe(1)

    // 试用档走的是平台额度，所以日限照样生效：把今天的任务数填满，就该被挡
    mem.set(`wb_quota_${todayISO()}`, JSON.stringify(Array.from({ length: DEFAULT_QUOTA.dailyTasks }, (_, i) => `任务${i}`)))
    createCalls = 0
    await expect(streamChat({ system: 's', user: 'u', task: '再来一件' })).rejects.toThrow(/额度|今天/)
    expect(createCalls).toBe(0)
  })

  it('byo 通道未接通时，即使本地存了 key 也不发请求', async () => {
    mem.set('wb_byo_key', 'sk-abcdef1234567890wxyz')
    setByoReady(false)
    await expect(streamChat({ system: 's', user: 'u', task: 'JD 评估' })).rejects.toThrow(/未接通|没接通/)
    expect(createCalls).toBe(0)
  })

  it('byo 已就绪但发送器还没接上 → 也拒，绝不"先拿平台额度顶着"', async () => {
    // 这是最坏的一种"聪明"：通道没通就用现成的那条发出去，
    // 用户以为花的是自己的钱，实际记在创建者账上，而且一声不吭。
    mem.set('wb_byo_key', 'sk-abcdef1234567890wxyz')
    setByoReady(true)
    await expect(streamChat({ system: 's', user: 'u', task: 'JD 评估' })).rejects.toThrow(/发送器|没接上|未接通|暂不可用/)
    expect(createCalls).toBe(0)
  })
})
