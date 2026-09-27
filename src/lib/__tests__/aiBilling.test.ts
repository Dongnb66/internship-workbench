import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 计费门的断言。
 *
 * 一句话目的：**默认不花创建者的钱**。这个应用原先只有一条通道（平台云服务额度，
 * 语义是 Creator quota），意味着「任何注册用户点一下 AI，钱记在你账上」。
 * 现在加一道门：没有用户自己的 Key、也没人显式开试用开关，AI 一律不调用。
 *
 * 四条最容易出事的地方，每条都是真实会发生的，不是我想象的：
 * 1. 「配好了但那一档现在发不出去」时**悄悄回落到平台额度**——那正是这次要消灭的行为，
 *    而且它不会报错，只会让你的账单安静地涨。
 * 2. 开关默认打开。默认必须是关。
 * 3. 门只挡在页面上：将来新增一个 AI 功能忘了挡，就又是一条白跑的路。
 *    所以门挡在唯一入口 `streamChat` 里，另有一条源码级断言兜底。
 * 4. 本机档（不花钱那条）不该被要求填 Key；反过来，要 Key 的厂商没 Key 就不算配置好。
 *    「配置好」这句话必须跟着**选的是哪一档**走，不能是一句全局的有没有 Key。
 */

let createCalls = 0
let byoCalls = 0
let byoText = 'byo-ok'
let byoThrows = ''

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

vi.mock('../byoSend', () => ({
  streamByoChat: async (args: any) => {
    byoCalls += 1
    if (byoThrows) throw new Error(byoThrows)
    args.onDelta?.(byoText)
    return byoText
  },
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
const {
  BYO_KEY_KEY,
  BYO_PRESET_KEY,
  OWNER_TRIAL_KEY,
  currentAccess,
  currentPreset,
  getByoModel,
  getOwnerTrialEnabled,
  isByoConfigured,
  isByoSendable,
  setByoModel,
  setByoPresetId,
  setLocalServiceReady,
  setOwnerTrialEnabled,
} = await import('../billing')
const { streamChat } = await import('../ai')
const { DEFAULT_QUOTA } = await import('../quota')
const { todayISO } = await import('../format')

beforeEach(() => {
  mem.clear()
  createCalls = 0
  byoCalls = 0
  byoText = 'byo-ok'
  byoThrows = ''
  setLocalServiceReady(false)
  setOwnerTrialEnabled(false)
})

describe('decideAccess：谁付钱这件事只有一个判定点', () => {
  it('没配置、没开试用 → 不放行，且明确说自备 Key 这条路在哪', () => {
    const a = decideAccess({ byoConfigured: false, byoSendable: false, ownerTrial: false })
    expect(a.allowed).toBe(false)
    expect(a.access).toBe('none')
    expect(a.reason).toMatch(/自备|自己的.*Key|开通/)
  })

  it('配好了但那一档发不出去：**绝不回落到创建者额度**（宁可拒绝）', () => {
    const a = decideAccess({ byoConfigured: true, byoSendable: false, ownerTrial: false })
    expect(a.allowed).toBe(false)
    expect(a.access).toBe('none')
    expect(a.reason).toMatch(/发不出去|没接通|未接通/)
    expect(a.reason).toMatch(/不会改用本应用的额度|创建者/)
    expect(a.paidBy).not.toBe('creator')
  })

  it('配好且发得出 → 走 byo，付款方是用户', () => {
    const a = decideAccess({ byoConfigured: true, byoSendable: true, ownerTrial: false })
    expect(a.allowed).toBe(true)
    expect(a.access).toBe('byo')
    expect(a.paidBy).toBe('user')
  })

  it('创建者试用档：明确标出来是创建者付，不是一句「额度不足」糊过去', () => {
    const a = decideAccess({ byoConfigured: false, byoSendable: false, ownerTrial: true })
    expect(a.allowed).toBe(true)
    expect(a.access).toBe('owner-trial')
    expect(a.paidBy).toBe('creator')
  })

  it('既能自备 Key 又开了试用 → 用用户自己的 Key，不动创建者的额度', () => {
    const a = decideAccess({ byoConfigured: true, byoSendable: true, ownerTrial: true })
    expect(a.access).toBe('byo')
    expect(a.paidBy).toBe('user')
  })
})

describe('「配置好了」跟着选的那一档走', () => {
  it('默认档（要 Key 的厂商）没填 Key = 没配置好', () => {
    expect(isByoConfigured()).toBe(false)
  })

  it('默认档填了 Key = 配置好，且浏览器能直发', () => {
    mem.set(BYO_KEY_KEY, 'sk-abcdef1234567890wxyz')
    expect(isByoConfigured()).toBe(true)
    expect(isByoSendable()).toBe(true)
    expect(currentAccess().access).toBe('byo')
  })

  it('本机档不需要 Key 就算配置好了（花的是自己电脑的算力）', () => {
    mem.set(BYO_PRESET_KEY, 'ollama')
    expect(isByoConfigured()).toBe(true)
    // 但本机服务没探到在跑之前，仍然不许发——发出去只会得到一句网络错误
    expect(isByoSendable()).toBe(false)
    setLocalServiceReady(true)
    expect(isByoSendable()).toBe(true)
    expect(currentAccess().paidBy).toBe('user')
  })

  it('实测不能被浏览器直发的厂商：算配置好，但不算发得出', () => {
    mem.set(BYO_PRESET_KEY, 'zhipu')
    mem.set(BYO_KEY_KEY, 'sk-abcdef1234567890wxyz')
    expect(isByoConfigured()).toBe(true)
    expect(isByoSendable()).toBe(false)
  })

  it('档位存了个不认识的值为回落默认档，且默认档要 Key（不因脏值白放行）', () => {
    mem.set(BYO_PRESET_KEY, '乱填的值')
    expect(isByoConfigured()).toBe(false)
    mem.set(BYO_KEY_KEY, 'sk-abcdef1234567890wxyz')
    expect(isByoConfigured()).toBe(true)
  })

  it('没选过模型时用那一档表里的第一个；换了厂商不会带上一家的模型名', () => {
    expect(getByoModel()).toBe('deepseek-chat')
    setByoModel('deepseek', 'deepseek-reasoner')
    expect(getByoModel()).toBe('deepseek-reasoner')
    mem.set(BYO_PRESET_KEY, 'moonshot')
    expect(getByoModel()).toBe('kimi-k2-0905-preview')
  })

  it('档位只认表里存在的 id：写脏值等于写回默认档，而不是留下一个下次读会崩的东西', () => {
    setByoPresetId('moonshot')
    expect(mem.get(BYO_PRESET_KEY)).toBe('moonshot')
    setByoPresetId('乱填的值')
    expect(mem.get(BYO_PRESET_KEY)).toBeUndefined()
    expect(currentPreset().id).toBe('deepseek')
  })

  it('存储坏掉时读到的是「没配置」，AI 宁可不能用（不抛错也不猜测）', () => {
    const real = (globalThis as any).localStorage
    ;(globalThis as any).localStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    }
    try {
      expect(isByoConfigured()).toBe(false)
      expect(currentAccess().allowed).toBe(false)
    } finally {
      ;(globalThis as any).localStorage = real
    }
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
    expect(byoCalls).toBe(0)
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

  it('byo 通了就真的走 byo，且平台通道一次都没被碰', async () => {
    mem.set(BYO_KEY_KEY, 'sk-abcdef1234567890wxyz')
    await expect(streamChat({ system: 's', user: 'u', task: 'JD 评估' })).resolves.toBe('byo-ok')
    expect(byoCalls).toBe(1)
    expect(createCalls).toBe(0)
  })

  it('byo 花的是用户自己的钱，循环保护照样要有：记账、并且填满后拒绝再发', async () => {
    mem.set(BYO_KEY_KEY, 'sk-abcdef1234567890wxyz')
    await streamChat({ system: 's', user: 'u', task: '每日巡检' })
    const ledger = JSON.parse(mem.get(`wb_quota_${todayISO()}`) ?? '[]')
    expect(ledger).toContain('每日巡检')

    mem.set(`wb_quota_${todayISO()}`, JSON.stringify(Array.from({ length: DEFAULT_QUOTA.dailyTasks }, (_, i) => `任务${i}`)))
    byoCalls = 0
    await expect(streamChat({ system: 's', user: 'u', task: '再来一件' })).rejects.toThrow(/额度|今天/)
    expect(byoCalls).toBe(0)
  })

  it('byo 发送失败 → 抛出去的那句话是厂商的原因，而且**不拿平台额度顶着**', async () => {
    mem.set(BYO_KEY_KEY, 'sk-abcdef1234567890wxyz')
    byoThrows = 'DeepSeek：你的 Key 不被接受（HTTP 401）'
    await expect(streamChat({ system: 's', user: 'u', task: 'JD 评估' })).rejects.toThrow(/Key 不被接受/)
    expect(createCalls).toBe(0)
  })

  it('byo 那一档发不出去时（没探到本机服务 / 厂商不吃浏览器直发），连一次都不试', async () => {
    mem.set(BYO_PRESET_KEY, 'ollama')
    setLocalServiceReady(false)
    await expect(streamChat({ system: 's', user: 'u', task: 'JD 评估' })).rejects.toThrow(/发不出去|没接通|未接通/)
    expect(byoCalls).toBe(0)
    expect(createCalls).toBe(0)
  })
})
