import { describe, expect, it, vi } from 'vitest'

/**
 * 自备 Key 的**浏览器直发器**断言。
 *
 * 为什么存在这个文件：整条自费路的价值全在「Key 不经过本项目任何服务端」。
 * 一旦多一跳，就多一处能泄露它的地方，而泄露的是用户的钱。所以这里钉的四类事，
 * 每一类都对应一种真实会发生的事故：
 *
 * 1. **请求只能发往厂商白名单**（`assertForwardTarget` 在发之前再过一次）。
 *    地址来自数据表不等于来自数据表是对的：表会被改、路径会被拼。
 * 2. **Key 只出现在鉴权头里**：不进 URL、不进 query、不进错误文案。
 *    厂商 401 的响应体常常回显 Authorization，而用户会截图问人。
 * 3. **实测发不出去的厂商不许发**：明知必被 CORS 挡还发出去，用户看到的是一句
 *    「网络错误」，然后去反复重填 Key——那是把工程问题伪装成用户的错。
 * 4. **本机档不带任何鉴权头，也不许被当成通用代理口**：只认 127.0.0.1 的固定端口。
 *
 * 发送器用注入的 `fetchImpl` 测：测试里不发真请求（真请求要 Key、要网、要花人的钱）。
 */
import { BYO_PRESETS, assertForwardTarget } from '../aiChannels'
import { byoErrorText, byoUrl, buildByoHeaders, streamByoChat } from '../byoSend'

const enc = new TextEncoder()
const KEY = 'sk-abcdef1234567890wxyz'

function preset(id: string) {
  const p = BYO_PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`厂商表里没有 ${id}`)
  return p
}

/** 把若干段文本当成 SSE 分块喂回去（故意可以在任意位置切断一行） */
function sseBody(parts: string[]) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const one of parts) c.enqueue(enc.encode(one))
      c.close()
    },
  })
}
function frame(obj: unknown) {
  return `data: ${JSON.stringify(obj)}\n\n`
}
function response(status: number, body: ReadableStream<Uint8Array> | null, text = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    text: async () => text,
  } as unknown as Response
}

describe('请求长什么样', () => {
  it('远端厂商走 https + 表里的路径，URL 里没有 Key 的位置', () => {
    const url = byoUrl(preset('deepseek'))
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(url).not.toContain(KEY)
    expect(byoUrl(preset('dashscope'))).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
  })

  it('本机档是 http + 钉死的端口（这是 https 规则的唯一例外）', () => {
    expect(byoUrl(preset('ollama'))).toBe('http://127.0.0.1:11434/v1/chat/completions')
  })

  it('每个最终 URL 都还在白名单里（表被改坏时发不出去，而不是发错地方）', () => {
    for (const p of BYO_PRESETS) {
      expect(assertForwardTarget(byoUrl(p)).allowed, `${p.id} 的最终 URL 不在白名单`).toBe(true)
    }
  })

  it('鉴权头按厂商写法：bearer / x-api-key / 本机档一个头都不带', () => {
    expect(buildByoHeaders(preset('deepseek'), KEY).Authorization).toBe(`Bearer ${KEY}`)
    // 目前表里还没有 x-api-key 那一家，但写法是真存在的（Anthropic 系），
    // 分支持错的话只有那一家的用户会撞上，所以先钉住
    const keyed = { ...preset('deepseek'), authStyle: 'x-api-key' as const }
    const h = buildByoHeaders(keyed, KEY)
    expect(h.Authorization).toBeUndefined()
    expect(h['x-api-key']).toBe(KEY)
    const local = buildByoHeaders(preset('ollama'), '')
    expect(local.Authorization).toBeUndefined()
    expect(local).not.toHaveProperty('x-api-key')
    expect(JSON.stringify(local)).not.toContain(KEY)
  })
})

describe('发之前先问白名单', () => {
  it('目标不在白名单里 → 一次 fetch 都不发', async () => {
    const evil = { ...preset('deepseek'), host: 'evil.cn' }
    const fetchImpl = vi.fn()
    await expect(
      streamByoChat({ preset: evil, key: KEY, model: 'm', system: 's', user: 'u', fetchImpl: fetchImpl as never }),
    ).rejects.toThrow(/白名单|不在/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('实测发不出去的厂商直接说清楚，不发那条注定被 CORS 挡掉的请求', async () => {
    const fetchImpl = vi.fn()
    await expect(
      streamByoChat({ preset: preset('zhipu'), key: KEY, model: 'm', system: 's', user: 'u', fetchImpl: fetchImpl as never }),
    ).rejects.toThrow(/直发|CORS|发不出去/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('要 Key 的厂商没给 Key → 不发（否则只会被厂商打回来，用户看到一句莫名其妙的 401）', async () => {
    const fetchImpl = vi.fn()
    await expect(
      streamByoChat({ preset: preset('deepseek'), key: '', model: 'm', system: 's', user: 'u', fetchImpl: fetchImpl as never }),
    ).rejects.toThrow(/Key/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('流式回包', () => {
  it('逐帧回调、拼出全文，[DONE] 之后就停下', async () => {
    const seen: string[] = []
    const body = sseBody([
      frame({ choices: [{ delta: { content: '你好' } }] }),
      frame({ choices: [{ delta: { content: '，世界' } }] }) + 'data: [DONE]\n\n',
      frame({ choices: [{ delta: { content: '不该出现' } }] }),
    ])
    const fetchImpl = vi.fn(async () => response(200, body))
    const out = await streamByoChat({
      preset: preset('deepseek'),
      key: KEY,
      model: 'deepseek-chat',
      system: 's',
      user: 'u',
      onDelta: (t) => seen.push(t),
      fetchImpl: fetchImpl as never,
    })
    expect(out).toBe('你好，世界')
    expect(seen).toEqual(['你好', '，世界'])
  })

  it('一行被网络切断也要能拼回来（分块边界不等于帧边界）', async () => {
    const one = frame({ choices: [{ delta: { content: '拼接' } }] })
    const body = sseBody([one.slice(0, 9), one.slice(9)])
    const out = await streamByoChat({
      preset: preset('deepseek'),
      key: KEY,
      model: 'm',
      system: 's',
      user: 'u',
      fetchImpl: (async () => response(200, body)) as never,
    })
    expect(out).toBe('拼接')
  })

  it('思考型模型的推理内容只报进度，绝不混进正文', async () => {
    const deltas: string[] = []
    const reasonings: string[] = []
    const body = sseBody([
      frame({ choices: [{ delta: { reasoning_content: '我在想' } }] }),
      frame({ choices: [{ delta: { content: '结论' } }] }),
      frame({ choices: [{ delta: { reasoning_content: '还想' } }] }),
    ])
    const out = await streamByoChat({
      preset: preset('deepseek'),
      key: KEY,
      model: 'm',
      system: 's',
      user: 'u',
      onDelta: (t) => deltas.push(t),
      onReasoning: (t) => reasonings.push(t),
      fetchImpl: (async () => response(200, body)) as never,
    })
    expect(out).toBe('结论')
    expect(deltas).toEqual(['结论'])
    expect(reasonings).toEqual(['我在想', '还想'])
  })

  it('请求体是 OpenAI 兼容那套：stream:true、system 在最前、要 JSON 就带 response_format', async () => {
    let sent: any = null
    const fetchImpl = vi.fn(async (_url: string, init: any) => {
      sent = JSON.parse(init.body)
      return response(200, sseBody([frame({ choices: [{ delta: { content: 'ok' } }] })]))
    })
    await streamByoChat({
      preset: preset('moonshot'),
      key: KEY,
      model: 'kimi-k2-0905-preview',
      system: 'S',
      user: 'U',
      json: true,
      fetchImpl: fetchImpl as never,
    })
    expect(sent.stream).toBe(true)
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'S' })
    expect(sent.response_format).toEqual({ type: 'json_object' })
  })

  it('取消信号透传给 fetch（点了停止就该真的停）', async () => {
    let captured: { signal?: AbortSignal } = {}
    const ctrl = new AbortController()
    const fetchImpl = vi.fn(async (_u: string, init: any) => {
      captured = { signal: init.signal }
      return response(200, sseBody([frame({ choices: [{ delta: { content: 'x' } }] })]))
    })
    await streamByoChat({
      preset: preset('deepseek'),
      key: KEY,
      model: 'm',
      system: 's',
      user: 'u',
      signal: ctrl.signal,
      fetchImpl: fetchImpl as never,
    })
    expect(captured.signal).toBe(ctrl.signal)
  })

  it('[DONE] 之后要把流关掉（不然连接挂着，agent 一轮八圈就是八个没关的流）', async () => {
    // 注意：这里**故意不 close()** —— 厂商给完 [DONE] 之后把连接留着是真实存在的形态。
    // 流要是已经自然关闭，cancel() 按规范就是空操作，那样写这条断言等于自证假绿。
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(frame({ choices: [{ delta: { content: 'x' } }] })))
        c.enqueue(enc.encode('data: [DONE]\n\n'))
      },
      cancel() {
        cancelled = true
      },
    })
    const out = await streamByoChat({
      preset: preset('deepseek'),
      key: KEY,
      model: 'm',
      system: 's',
      user: 'u',
      fetchImpl: (async () => response(200, body)) as never,
    })
    expect(out).toBe('x')
    expect(cancelled).toBe(true)
  })

  it('末帧的 token 数要交回给调用方（自费那一档，花的钱得能还给人家看）', async () => {
    let usage: any = null
    const body = sseBody([
      frame({ choices: [{ delta: { content: 'x' } }] }),
      frame({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } }),
    ])
    await streamByoChat({
      preset: preset('deepseek'),
      key: KEY,
      model: 'm',
      system: 's',
      user: 'u',
      onUsage: (u) => {
        usage = u
      },
      fetchImpl: (async () => response(200, body)) as never,
    })
    expect(usage).toMatchObject({ prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 })
  })
})

describe('出错时说的是什么话', () => {
  it('厂商回 401：话指着 Key，不指着用户的账号', () => {
    const t = byoErrorText(preset('deepseek'), 401, '{"error":"invalid api key"}')
    expect(t).toMatch(/Key|密钥/)
    expect(t).toMatch(/DeepSeek/)
  })

  it('厂商的错误体里回显了 Authorization → 脱敏之后再进文案', () => {
    const leaky = `upstream rejected: Bearer ${KEY} (see ${KEY})`
    const t = byoErrorText(preset('deepseek'), 401, leaky)
    expect(t).not.toContain(KEY)
    expect(t).toMatch(/\*{3,}/)
  })

  it('429 说清是频率或余额，不是"模型服务不可用"', () => {
    expect(byoErrorText(preset('deepseek'), 429, 'rate limit')).toMatch(/频繁|余额|额度|限流/)
  })

  it('网络层失败 = 大概率 CORS 或没联网，文案不许赖用户的 Key', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(
      streamByoChat({ preset: preset('deepseek'), key: KEY, model: 'm', system: 's', user: 'u', fetchImpl: fetchImpl as never }),
    ).rejects.toThrow(/CORS|跨域|网络/)
  })

  it('错误文案里没有 Key 的位置（用户会截图问人）', async () => {
    const body = sseBody([])
    let message = ''
    try {
      await streamByoChat({
        preset: preset('deepseek'),
        key: KEY,
        model: 'm',
        system: 's',
        user: 'u',
        fetchImpl: (async () => response(400, body, `bad request for ${KEY}`)) as never,
      })
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).not.toContain(KEY)
    expect(message).toContain('DeepSeek')
  })
})
