import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * streamChat 的两件事最容易悄悄坏掉，所以单独盯住：
 * 1) 消耗入账：应用不需要用户自备 API Key，走的是应用云服务额度，用户看不见账单——
 *    前端这层统计是唯一的可见性，记漏或重复计数都会让设置页的数字骗人。
 * 2) 推理通道隔离：思考型模型先吐 reasoning_content，它**不是结论**，
 *    一旦混进 text/onDelta，页面就会把模型的思考过程当分析结果渲染出来。
 */

let streamChunks: any[] = []
let modelList: any[] = []

vi.mock('../../cloud', () => ({
  cloud: {
    llm: {
      models: { list: async () => modelList },
      chat: { completions: { create: async () => (async function* () { for (const c of streamChunks) yield c })() } },
    },
  },
  errText: (e: unknown) => String(e),
}))

// node 环境没有 sessionStorage；统计被 try/catch 兜住，但那样就测不到了，显式补一个
const store = new Map<string, string>()
;(globalThis as any).sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
}

const { getTokenStats, listUsableModels, modelCostLabel, streamChat } = await import('../ai')

beforeEach(() => {
  store.clear()
  streamChunks = []
  modelList = [{ id: 'm1', name: '模型一', enabled: true }]
})

function chunk(choices: any[], usage?: any) {
  return { id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm1', choices, usage }
}

describe('streamChat 消耗入账', () => {
  it('末帧带 usage 时计入会话统计（含调用次数）', async () => {
    streamChunks = [
      chunk([{ index: 0, delta: { content: '{"a":1}' }, finish_reason: null }]),
      chunk([], { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 }),
    ]
    await streamChat({ system: 's', user: 'u' })
    expect(getTokenStats()).toEqual({ calls: 1, prompt: 1200, completion: 300, total: 1500 })
  })

  it('每帧都带 usage 时只记一次——取最后一帧，不逐帧累加', async () => {
    streamChunks = [
      chunk([{ index: 0, delta: { content: 'a' }, finish_reason: null }], { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }),
      chunk([{ index: 0, delta: { content: 'b' }, finish_reason: null }], { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }),
      chunk([], { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }),
    ]
    await streamChat({ system: 's', user: 'u' })
    expect(getTokenStats()).toEqual({ calls: 1, prompt: 10, completion: 2, total: 12 })
  })

  it('网关没回 usage 时只计调用次数，不编造 token 数', async () => {
    streamChunks = [chunk([{ index: 0, delta: { content: 'x' }, finish_reason: 'stop' }])]
    await streamChat({ system: 's', user: 'u' })
    expect(getTokenStats()).toEqual({ calls: 1, prompt: 0, completion: 0, total: 0 })
  })

  it('多次调用累加在同一会话上', async () => {
    streamChunks = [chunk([], { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 })]
    await streamChat({ system: 's', user: 'u' })
    streamChunks = [chunk([], { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })]
    await streamChat({ system: 's', user: 'u' })
    expect(getTokenStats()).toEqual({ calls: 2, prompt: 6, completion: 6, total: 12 })
  })
})

describe('streamChat 推理通道隔离', () => {
  it('reasoning_content 只进 onReasoning，不进正文也不进 onDelta', async () => {
    streamChunks = [
      chunk([{ index: 0, delta: { reasoning_content: '先看学历…' }, finish_reason: null }]),
      chunk([{ index: 0, delta: { reasoning_content: '再看项目…' }, finish_reason: null }]),
      chunk([{ index: 0, delta: { content: '{"summary":"ok"}' }, finish_reason: 'stop' }]),
    ]
    const deltas: string[] = []
    const reasoning: string[] = []
    const text = await streamChat({
      system: 's',
      user: 'u',
      json: true,
      onDelta: (t) => deltas.push(t),
      onReasoning: (t) => reasoning.push(t),
    })
    expect(text).toBe('{"summary":"ok"}')
    expect(deltas.join('')).toBe('{"summary":"ok"}')
    expect(reasoning.join('')).toBe('先看学历…再看项目…')
    expect(text).not.toContain('先看学历')
  })

  it('没传 onReasoning 时思考型模型也不会抛错（只是没有进度提示）', async () => {
    streamChunks = [
      chunk([{ index: 0, delta: { reasoning_content: '推理中' }, finish_reason: null }]),
      chunk([{ index: 0, delta: { content: '答案' }, finish_reason: 'stop' }]),
    ]
    await expect(streamChat({ system: 's', user: 'u' })).resolves.toBe('答案')
  })
})

describe('listUsableModels 目录投影', () => {
  it('保留 credits 与思考型标记，并过滤被禁用的模型', async () => {
    modelList = [
      { id: 'a', name: '快模型', provider: 'p1', credits: '2 credits/1K tokens', enabled: true },
      { id: 'b', name: '思考模型', enabled: true, onlyReasoning: true },
      { id: 'c', name: '思考模型2', enabled: true, supportsReasoning: true },
      { id: 'd', name: '已禁用', enabled: true, disabled: true },
      { id: 'e', name: '不可选', enabled: false },
    ]
    // 目录在模块里是进程内缓存，前面的用例已经把它填成 m1 了；重新加载模块拿干净的缓存
    vi.resetModules()
    const fresh = await import('../ai')
    const list = await fresh.listUsableModels()
    expect(list.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    expect(list[0]).toMatchObject({ credits: '2 credits/1K tokens', reasoning: false })
    expect(list[1].reasoning).toBe(true)
    expect(list[2].reasoning).toBe(true)
    // 目录没给 credits 时留 undefined，让 UI 显示「平台未下发」而不是编一个数字
    expect(list[1].credits).toBeUndefined()
  })

  it('vendor 是单字母打码代号时不当作厂商名展示', async () => {
    modelList = [{ id: 'z', name: 'Z', enabled: true, vendor: 'f' }]
    vi.resetModules()
    const fresh = await import('../ai')
    const list = await fresh.listUsableModels()
    expect(list[0].provider).toBeUndefined()
  })
})

describe('modelCostLabel 计费文案', () => {
  it('把目录的 credits 文案归一成倍率，不换算成金额', () => {
    expect(modelCostLabel({ id: 'deepseek-v4.1-flash', credits: 'x0.11 credits', reasoning: false })).toBe('积分倍率 x0.11')
    // 实测目录里有不带 credits 字样的写法，也要认
    expect(modelCostLabel({ id: 'hy3-x', credits: 'x0.05', reasoning: false })).toBe('积分倍率 x0.05')
    // 高倍率的贵模型必须原样呈现，不能被四舍五入掩盖
    expect(modelCostLabel({ id: 'kimi-k3-1', credits: 'x1.62 credits', reasoning: false })).toBe('积分倍率 x1.62')
  })

  it('Auto 不给倍率时说清是浮动，不编数字', () => {
    expect(modelCostLabel({ id: 'auto', reasoning: true })).toBe('积分倍率按任务浮动（Auto 自动挑模型） · 思考型，更慢')
  })

  it('目录没给倍率时如实说未下发，且思考型标记仍要带上', () => {
    expect(modelCostLabel({ id: 'hunyuan-chat', reasoning: false })).toBe('平台未下发该模型的积分倍率')
    expect(modelCostLabel({ id: 'hunyuan-chat', reasoning: true })).toBe('平台未下发该模型的积分倍率 · 思考型，更慢')
  })

  it('未选模型时指向平台默认', () => {
    expect(modelCostLabel(null)).toBe('未选具体模型，按平台默认（Auto）计费')
  })
})
