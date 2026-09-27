import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 智能体走便宜档的断言（AGENT_PLAN §3.4）。
 *
 * 为什么必须专门做：循环一次任务要打 1–8 次模型，选错档不是一点点差价，
 * 而额度记在**创建者**账号上（用户既看不见也不会欠费）。
 * 同时 §8 的实测坑摆在那里：默认是 `auto`，而它是 `onlyReasoning` 的思考型——
 * **默认就是又慢又不确定价格**，所以「让它自己挑最便宜的」必须是代码，不是建议。
 */

let modelList: any[] = []
let lastRequest: any = null

vi.mock('../../cloud', () => ({
  cloud: {
    llm: {
      models: { list: async () => modelList },
      chat: {
        completions: {
          create: async (req: any) => {
            lastRequest = req
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

const { modelRate, pickCheapModel, streamChat } = await import('../ai')
const { setOwnerTrialEnabled } = await import('../billing')


beforeEach(() => {
  mem.clear()
  // 计费门默认关闭；这里测的是创建者试用档那条通道，必须显式打开（清完存储要重开）
  setOwnerTrialEnabled(true)
  lastRequest = null
  modelList = [
    { id: 'auto', name: 'Auto', enabled: true, onlyReasoning: true },
    { id: 'glm-flash', name: 'GLM-Flash', enabled: true, credits: 'x0.06 credits' },
    { id: 'ds-flash', name: 'DeepSeek-Flash', enabled: true, credits: 'x0.11 credits' },
    { id: 'kimi', name: 'Kimi', enabled: true, credits: 'x1.62 credits' },
  ]
})

describe('modelRate 倍率解析', () => {
  it('认得目录里两种写法', () => {
    expect(modelRate({ credits: 'x0.06 credits' })).toBe(0.06)
    expect(modelRate({ credits: 'x0.05' })).toBe(0.05)
    expect(modelRate({ credits: 'x1.62 credits' })).toBe(1.62)
  })

  it('没下发倍率就是 null，不当成 0（0 会被当成「免费」而永远当选）', () => {
    expect(modelRate({})).toBeNull()
    expect(modelRate({ credits: '' })).toBeNull()
    expect(modelRate({ credits: '按任务浮动' })).toBeNull()
  })
})

describe('pickCheapModel 挑最便宜', () => {
  it('选倍率最低的那个，而不是目录第一个', async () => {
    const { listUsableModels } = await import('../ai')
    const list = await listUsableModels()
    expect(pickCheapModel(list)).toBe('glm-flash')
  })

  it('倍率未知的模型一律不参选（auto 属于未知，不是便宜）', async () => {
    const { listUsableModels } = await import('../ai')
    const list = await listUsableModels()
    expect(pickCheapModel(list)).not.toBe('auto')
    const noRates = list.filter((m) => m.credits === undefined)
    expect(pickCheapModel(noRates)).toBeNull()
  })

  it('并列时不选思考型（同样便宜，慢的那个别拿去转循环）', () => {
    const list = [
      { id: 'think', name: '思考', credits: 'x0.06 credits', reasoning: true },
      { id: 'fast', name: '快', credits: 'x0.06 credits', reasoning: false },
    ]
    expect(pickCheapModel(list as never)).toBe('fast')
  })
})

describe('streamChat 的 cheap 开关', () => {
  it('cheap:true 用便宜档；不传时仍是用户所选优先（不能悄悄改变别的功能）', async () => {
    mem.set('wb_model_choice', 'kimi')
    const { setModelChoice } = await import('../ai')
    setModelChoice('kimi')

    await streamChat({ system: 's', user: 'u', task: '默认档用例' })
    expect(lastRequest.model).toBe('kimi')

    await streamChat({ system: 's', user: 'u', task: '便宜档用例', cheap: true })
    expect(lastRequest.model).toBe('glm-flash')
  })

  it('两种档各自缓存，不能第一次选了谁就一直串下去', async () => {
    const { setModelChoice } = await import('../ai')
    setModelChoice('kimi')
    await streamChat({ system: 's', user: 'u', task: 'a', cheap: true })
    expect(lastRequest.model).toBe('glm-flash')
    await streamChat({ system: 's', user: 'u', task: 'b' })
    expect(lastRequest.model).toBe('kimi')
    await streamChat({ system: 's', user: 'u', task: 'c', cheap: true })
    expect(lastRequest.model).toBe('glm-flash')
  })

  it('目录没下发任何倍率 → 回退到原有默认，而不是没有模型可用', async () => {
    modelList = [{ id: 'only', name: '唯一', enabled: true }]
    // 目录是进程内缓存（ai.ts 的 cachedModels），前面用例已经把它填过了，
    // 所以这一条必须重新加载模块拿干净缓存——与 aiUsage.test.ts 同一个手法。
    vi.resetModules()
    const fresh = await import('../ai')
    fresh.setModelChoice(null)
    await fresh.streamChat({ system: 's', user: 'u', task: '无倍率目录', cheap: true })
    expect(lastRequest.model).toBe('only')
  })
})
