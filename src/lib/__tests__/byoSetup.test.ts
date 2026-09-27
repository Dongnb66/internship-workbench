import { describe, expect, it, vi } from 'vitest'

/**
 * 「设置 — AI 通道」这块卡片的全部判定，抽成纯函数来测。
 *
 * 为什么不直接在页面上测（本仓库的 vitest 跑在 node，没有 DOM）：
 * 这页真正会出错的不是排版，而是**它说的那句话对不对**——
 * 「已配置」「能发出去」「花你自己的钱」每一句都是有代价的承诺，
 * 所以判定必须在纯模块里，页面只负责把它显示出来。
 *
 * 另有一条源码级断言（见 byoHygiene.test.mjs）钉住：页面**拿不到 Key 原文**。
 */
import { BYO_PRESETS } from '../aiChannels'
import { isLocalServiceReady, setLocalServiceReady } from '../billing'
import { channelCard, checkConnection, keyHint, keyNote, maskKey, probeUrl } from '../byoSetup'

const KEY = 'sk-abcdef1234567890wxyz'

function preset(id: string) {
  const p = BYO_PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`厂商表里没有 ${id}`)
  return p
}

describe('掩码', () => {
  it('掩码只留头尾，绝不返回整把 Key', () => {
    const m = maskKey(KEY)
    expect(m).not.toContain(KEY)
    expect(m).toMatch(/sk-abc/)
    expect(m).toMatch(/wxyz/)
    expect(m).toMatch(/\*+/)
  })

  it('空值与短值不炸（用户可能还没填，或者填了个残缺的）', () => {
    expect(maskKey('')).toBe('')
    expect(maskKey('ab')).toBe('已填写（2 位，太短，多半不完整）')
  })
})

describe('界面上的 Key 提示', () => {
  it('已存 Key 时只显示头尾掩码：页面拿不到原文（回填一次就等于交给截图）', () => {
    const mem = new Map<string, string>([['wb_byo_key', KEY]])
    const real = (globalThis as any).localStorage
    ;(globalThis as any).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    }
    try {
      const hint = keyHint()
      expect(hint).toMatch(/已存/)
      expect(hint).toMatch(/sk-abc/)
      expect(hint).not.toContain(KEY)
    } finally {
      ;(globalThis as any).localStorage = real
    }
  })

  it('没存过就说没存，不显示一个空掩码让人以为配好了', () => {
    const real = (globalThis as any).localStorage
    ;(globalThis as any).localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
    try {
      expect(keyHint()).toMatch(/没存|未填/)
    } finally {
      ;(globalThis as any).localStorage = real
    }
  })
})

describe('卡片说什么话', () => {
  it('要 Key 的厂商：没 Key 就是「还没配好」，配了就是能用', () => {
    const noKey = channelCard(preset('deepseek'), { hasKey: false, localReady: true })
    expect(noKey.configured).toBe(false)
    expect(noKey.status).toMatch(/填.*Key|需要.*Key/)
    const withKey = channelCard(preset('deepseek'), { hasKey: true, localReady: true })
    expect(withKey.configured).toBe(true)
    expect(withKey.sendable).toBe(true)
    expect(withKey.status).toMatch(/可以直接发|不需要.*创建者/)
  })

  it('本机档不看 Key，只看本机服务在不在跑', () => {
    expect(channelCard(preset('ollama'), { hasKey: false, localReady: false }).status).toMatch(/启动|没在跑|Ollama/)
    expect(channelCard(preset('ollama'), { hasKey: false, localReady: false }).configured).toBe(true)
    expect(channelCard(preset('ollama'), { hasKey: false, localReady: true }).sendable).toBe(true)
  })

  it('实测发不出去的厂商，卡片必须当场承认发不出去（不许留到调用时才失败）', () => {
    const c = channelCard(preset('zhipu'), { hasKey: true, localReady: true })
    expect(c.sendable).toBe(false)
    expect(c.status).toMatch(/发不出去|直发/)
  })

  it('每一张卡片都带一句「谁付钱」，且原样取自厂商表（不许页面自己编）', () => {
    for (const p of BYO_PRESETS) {
      const c = channelCard(p, { hasKey: true, localReady: true })
      expect(c.whoPays).toBe(p.whoPays)
      expect(c.whoPays.length).toBeGreaterThan(8)
    }
  })

  it('自检的话术分得清花钱与不花钱', () => {
    expect(keyNote(preset('deepseek'))).toMatch(/零头|真的发一条|花你自己/)
    expect(keyNote(preset('ollama'))).toMatch(/不花钱/)
  })
})

describe('自检', () => {
  it('探活问的是本机的模型列表端点，不是聊天端点（后者会真的花钱/占模型）', () => {
    expect(probeUrl(preset('ollama'))).toBe('http://127.0.0.1:11434/v1/models')
  })

  it('本机档只问一次本机服务，并且把探活结果写给计费门', async () => {
    setLocalServiceReady(false)
    const calls: Array<{ url: string; init: any }> = []
    const fetchImpl = vi.fn(async (url: string, init: any) => {
      calls.push({ url, init })
      return { ok: true, status: 200, text: async () => '{"models":[]}' } as never
    })
    const r = await checkConnection({ preset: preset('ollama'), key: '', model: 'qwen3:4b', fetchImpl: fetchImpl as never })
    expect(r.ok).toBe(true)
    expect(r.text).toMatch(/在线/)
    // 探活的意义就在于此：门只有在这里之后才肯放行本机档
    expect(isLocalServiceReady()).toBe(true)
    expect(calls[0].url).toBe(probeUrl(preset('ollama')))
    // 本机档连自检都不带鉴权头：这台电脑的主人不需要向自己出示 Key
    expect(calls[0].init.headers.Authorization).toBeUndefined()
  })

  it('本机服务没在跑 → 探活结果为否，门随之关回去', async () => {
    setLocalServiceReady(true)
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const r = await checkConnection({ preset: preset('ollama'), key: '', model: 'm', fetchImpl: fetchImpl as never })
    expect(r.ok).toBe(false)
    expect(r.text).toMatch(/没启动|启动|11434/)
    expect(isLocalServiceReady()).toBe(false)
  })

  it('本机服务答了但不对（非 2xx）→ 门照样要关回去', async () => {
    // 这一条是变异检查逼出来的：我原来只测了「fetch 抛错」那条失败路，
    // 于是「探活把结果写回门」这件事在**服务答 502** 时根本没被守过。
    setLocalServiceReady(true)
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 502, text: async () => 'bad gateway' }) as never)
    const r = await checkConnection({ preset: preset('ollama'), key: '', model: 'm', fetchImpl: fetchImpl as never })
    expect(r.ok).toBe(false)
    expect(r.text).toMatch(/502|不对/)
    expect(isLocalServiceReady()).toBe(false)
  })

  it('远端厂商的自检真的发一条最小请求，并带上 Key（Key 只在 header 里）', async () => {
    let sent: { url: string; init: any } | null = null
    const fetchImpl = vi.fn(async (url: string, init: any) => {
      sent = { url, init }
      return { ok: true, status: 200, text: async () => '{"choices":[{"message":{"content":"pong"}}]}' } as never
    })
    const r = await checkConnection({ preset: preset('deepseek'), key: KEY, model: 'deepseek-chat', fetchImpl: fetchImpl as never })
    expect(r.ok).toBe(true)
    expect(sent).not.toBeNull()
    expect((sent as any).url).toBe('https://api.deepseek.com/chat/completions')
    expect((sent as any).url).not.toContain(KEY)
    expect((sent as any).init.headers.Authorization).toBe(`Bearer ${KEY}`)
    const body = JSON.parse((sent as any).init.body)
    expect(body.max_tokens).toBeLessThanOrEqual(8)
    expect(body.stream).toBe(false)
  })

  it('远端自检失败说人话：厂商 401 就指着 Key，网络断了就指着网络，二者不许混', async () => {
    const denied = await checkConnection({
      preset: preset('deepseek'),
      key: KEY,
      model: 'm',
      fetchImpl: (async () => ({ ok: false, status: 401, text: async () => 'invalid key' })) as never,
    })
    expect(denied.ok).toBe(false)
    expect(denied.text).toMatch(/Key/)
    expect(denied.text).not.toMatch(/网络|跨域/)

    const dead = await checkConnection({
      preset: preset('deepseek'),
      key: KEY,
      model: 'm',
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch')
      }) as never,
    })
    expect(dead.ok).toBe(false)
    expect(dead.text).toMatch(/网络|跨域/)
    expect(dead.text).not.toMatch(/Key 不被接受/)
  })

  it('实测发不出去的厂商：自检不发请求，直接说清楚', async () => {
    const fetchImpl = vi.fn()
    const r = await checkConnection({ preset: preset('zhipu'), key: KEY, model: 'm', fetchImpl: fetchImpl as never })
    expect(r.ok).toBe(false)
    expect(r.text).toMatch(/直发|发不出去/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('自检文案里不许出现 Key 原文', async () => {
    const r = await checkConnection({
      preset: preset('deepseek'),
      key: KEY,
      model: 'm',
      fetchImpl: (async () => ({ ok: false, status: 400, text: async () => `rejected ${KEY}` })) as never,
    })
    expect(r.text).not.toContain(KEY)
  })
})
