/**
 * 「设置 — AI 通道」这张卡片的全部判定，抽成纯函数。
 *
 * 页面只负责显示，判定全在这里——这样每一句承诺都能被断言钉住。
 * 三类话最容易说错，每类都对应真实代价：
 * 1. **「已配置」**：要 Key 的厂商看有没有 Key，本机档看本机服务在不在跑。
 *    说错了用户会等到真用时才发现不能用。
 * 2. **「谁付钱」**：这句话必须原样取自厂商表，页面自己编一句就等于多了一个会腐烂的事实源。
 * 3. **Key 的显示**：界面永远只拿掩码。回填一次原文，Key 就同时存在于 DOM、截图与
 *    可能的录屏里——所以连这个模块都不读存储，Key 由调用方当参数传进来。
 */
import { type ChannelPreset } from './aiChannels'
import { byoErrorText, byoNetworkText, byoUrl, buildByoHeaders } from './byoSend'
import { readUserKey, setLocalServiceReady } from './billing'

export interface CardInput {
  /** 这台设备上有没有填过 Key */
  hasKey: boolean
  /** 本机模型服务最近一次探活的结果 */
  localReady: boolean
}

export interface ChannelCard {
  presetId: string
  label: string
  whoPays: string
  /** 这一档要不要 Key（本机档不要） */
  needsKey: boolean
  /** 该档要的东西齐了没 */
  configured: boolean
  /** 现在发得出吗——false 时界面必须直说，不许留到调用时才失败 */
  sendable: boolean
  /** 一句状态话，界面直接显示 */
  status: string
  /** 自检按钮旁边那句「会不会花钱」 */
  note: string
}

export function channelCard(preset: ChannelPreset, input: CardInput): ChannelCard {
  const needsKey = preset.requiresKey
  const configured = needsKey ? input.hasKey : true
  const sendable = preset.browserDirect && (!preset.httpLocal || input.localReady)
  let status: string
  if (!preset.browserDirect) {
    status = '这一家实测不能被浏览器直发（响应里不带跨域头），现在发不出去。换一家能直发的，或用本机 Ollama。'
  } else if (needsKey && !input.hasKey) {
    status = '还不能用：先填这一家的 Key。Key 只存在你这台设备的浏览器里，本应用没有服务端保管它。'
  } else if (preset.httpLocal && !input.localReady) {
    status = '还没跑起来：在本机启动 Ollama（默认 127.0.0.1:11434）后点「自检」，这里就会亮。'
  } else if (preset.httpLocal) {
    status = '本机模型在线，可以直接发。不花任何人的钱，也没有额度这回事。'
  } else {
    status = '可以直接发：请求由你的浏览器直接发给厂商，不经过本应用的服务端。'
  }
  return {
    presetId: preset.id,
    label: preset.label,
    whoPays: preset.whoPays,
    needsKey,
    configured,
    sendable,
    status,
    note: keyNote(preset),
  }
}

/** 自检花不花钱，一句话。用户点之前就该知道。 */
export function keyNote(preset: ChannelPreset): string {
  if (preset.httpLocal) return '自检只问一次本机服务，不花钱。'
  return '自检会真的发一条最小请求（几个 token 的量），花的是你自己账户的零头。'
}

/** 本机探活问哪个地址：端口钉死，跟转发白名单是同一个事实源 */
export function probeUrl(preset: ChannelPreset): string {
  if (!preset.httpLocal) return byoUrl(preset)
  return `http://${preset.host}:${preset.port ?? ''}/v1/models`
}

/** 掩码：只留头 6 位与尾 4 位，中间打星。界面上任何时候都不该拿到原文。 */
export function maskKey(key: string): string {
  const v = String(key ?? '').trim()
  if (!v) return ''
  if (v.length < 12) return `已填写（${v.length} 位，太短，多半不完整）`
  return `${v.slice(0, 6)}${'*'.repeat(Math.min(16, v.length - 10))}${v.slice(-4)}（${v.length} 位，只显示头尾）`
}

/**
 * 「这台设备上到底存了没」这句话由谁来说：由这个模块读存储、当场掩码后返回。
 * 页面自己去读原文再掩码，等于把原文交了出去——掩码必须在读到它的同一处完成。
 */
export function keyHint(): string {
  const v = readUserKey()
  if (!v) return '未填写'
  return `已存：${maskKey(v)}`
}

export interface CheckResult {
  ok: boolean
  text: string
}

export interface CheckOptions {
  preset: ChannelPreset
  /**
   * 可以不给：不给就在这个模块里现取。
   * 这是刻意的——**页面拿不到 Key 原文**，它只负责按一个按钮。
   */
  key?: string
  model: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

/**
 * 点「自检」时发生的事。
 *
 * 本机档：只 GET 一次本机服务的模型列表，并把结果写回计费门（`setLocalServiceReady`）——
 * 探活的全部意义就是让门知道该不该放行，所以**失败也要写**，否则上次成功的结果会一直留着。
 * 远端厂商：发一条 `max_tokens` 极小的非流式请求。流式没必要——自检要的是「有没有答」，
 * 而一条完整回答才花几个 token。
 */
export async function checkConnection(opts: CheckOptions): Promise<CheckResult> {
  const preset = opts.preset
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  if (!preset.browserDirect) {
    return { ok: false, text: channelCard(preset, { hasKey: true, localReady: true }).status }
  }

  if (preset.httpLocal) {
    try {
      const res = await fetchImpl(probeUrl(preset), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        ...(opts.signal ? { signal: opts.signal } : {}),
      })
      setLocalServiceReady(res.ok)
      return res.ok
        ? { ok: true, text: `本机模型服务在线（${preset.host}:${preset.port}），可以直接用。` }
        : { ok: false, text: `本机模型服务答了一声不对（HTTP ${res.status}）。确认它是 Ollama、且端口就是 ${preset.port}。` }
    } catch {
      setLocalServiceReady(false)
      return {
        ok: false,
        text: `没探到本机模型服务（${preset.host}:${preset.port}）。先启动它（例如命令行运行 ollama serve），再点一次自检。`,
      }
    }
  }

  const key = String(opts.key ?? readUserKey()).trim()
  if (preset.requiresKey && !key) {
    return { ok: false, text: '先填这一家的 Key，再自检。' }
  }
  const url = byoUrl(preset)
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: buildByoHeaders(preset, key),
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 4,
        stream: false,
      }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    if (!res.ok) {
      const raw = await res.text().catch(() => '')
      return { ok: false, text: byoErrorText(preset, res.status, raw) }
    }
    // 答回来了就把这一句读完：有些厂商不读体会留下挂着的连接
    await res.text().catch(() => '')
    return { ok: true, text: `厂商应答正常（${preset.label} · ${opts.model}）。可以开始用了。` }
  } catch (error) {
    if ((error as any)?.name === 'AbortError') throw error
    return { ok: false, text: byoNetworkText(preset) }
  }
}
