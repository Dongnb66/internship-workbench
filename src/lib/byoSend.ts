/**
 * 自备 Key 的浏览器直发器：**用户的 Key 一次也不经过本项目的任何服务端**。
 *
 * 为什么是这个形态（2026-09-27 实测之后的结论）：四家厂商的响应带
 * `access-control-allow-origin`，浏览器可以直接把 chat 请求发给它们。既然发得出去，
 * 就没必要再套一层自建代理——那一层每多存在一秒，就多一处能把用户的 Key 泄露掉的地方，
 * 而它泄露的还是别人的钱。
 *
 * 于是这四件事必须由代码钉住：
 * 1. **发之前再过一次白名单**。目标地址来自数据表不等于来自数据表是对的：表会被改、路径会被拼。
 * 2. **Key 只进鉴权头**。不进 URL、不进 query、不进错误文案；厂商 401 的响应体常常回显
 *    Authorization，而用户会拿截图去公开群里问。
 * 3. **实测发不出去的厂商不许发**。明知必被 CORS 挡还发出去，用户看到的是一句「网络错误」，
 *    然后开始反复重填 Key——那是把工程问题伪装成用户的错。
 * 4. **本机档只认 127.0.0.1 的固定端口，且一个鉴权头都不带**。它是 https 规则的唯一例外，
 *    所以例外必须小到只剩一个地址。
 */
import { assertForwardTarget, redactKey, type ChannelPreset } from './aiChannels'

/** 最终 URL：本机档是 http + 钉死端口，其余一律 https */
export function byoUrl(preset: ChannelPreset): string {
  const scheme = preset.httpLocal ? 'http' : 'https'
  const port = preset.httpLocal ? `:${preset.port ?? ''}` : ''
  return `${scheme}://${preset.host}${port}${preset.chatPath}`
}

/**
 * 只带 Content-Type/Accept 与鉴权头。**没有 caller-header 这个口子**：
 * 允许调用者塞任意头，等于允许他借这把 Key 伪造请求（`Origin`、`Referer`、厂商的计费标签）。
 */
export function buildByoHeaders(preset: ChannelPreset, key: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  const value = String(key ?? '').trim()
  if (preset.authStyle === 'bearer' && value) headers.Authorization = `Bearer ${value}`
  if (preset.authStyle === 'x-api-key' && value) headers['x-api-key'] = value
  // authStyle === 'none'（本机档）：什么都不加
  return headers
}

export interface ByoStreamArgs {
  preset: ChannelPreset
  /** 只有本机档可以空；要 Key 的厂商由调用方保证有值，这里再兜一次 */
  key: string
  model: string
  system: string
  user: string
  json?: boolean
  signal?: AbortSignal
  onDelta?: (text: string) => void
  onReasoning?: (text: string) => void
  /** 厂商末帧带的 token 数。自费这一档花钱的正是用户本人，所以这笔账必须能还给他看 */
  onUsage?: (usage: unknown) => void
  /** 注入点：测试里不发真请求（真请求要花的是用户的钱） */
  fetchImpl?: typeof fetch
}

function cannotSend(preset: ChannelPreset): string {
  return (
    `${preset.label} 现在发不出去：实测它的响应不带跨域头，浏览器直发一定会被挡。` +
    '换一个能直发的厂商（DeepSeek / Kimi / OpenRouter / 阿里云百炼）或本机 Ollama。' +
    '这里**不会改用本应用的额度**——那等于让应用创建者替你付钱。'
  )
}

/** 厂商错误 → 给人看的一句话。全部过脱敏，绝不把原文直接抛出去。 */
export function byoErrorText(preset: ChannelPreset, status: number, body: string): string {
  const safe = redactKey(String(body ?? '')).slice(0, 200)
  if (status === 401 || status === 403) {
    return `${preset.label}：你的 Key 不被接受（HTTP ${status}）。检查是否填全、是否过期、账户是否有余额；这与本应用账号无关。${safe}`
  }
  if (status === 429) {
    return `${preset.label}：被限流或账户余额不足（HTTP 429）。稍后重试，或去厂商控制台看余额与限流。${safe}`
  }
  if (status >= 500) return `${preset.label}：厂商服务暂时不可用（HTTP ${status}），稍后重试。`
  return `${preset.label}（HTTP ${status}）：${safe || '厂商拒绝了这次请求'}`
}

/** 请求根本没发出去：多半是 CORS 或断网。**这句话不许赖用户的 Key**——那是最贵的一种误诊。 */
function byoNetworkText(preset: ChannelPreset): string {
  return (
    `${preset.label}：浏览器没能把请求发出去（网络或跨域被挡）。` +
    '这与你的 Key 无关，不用重填。可以换一个能直发的厂商，或改用本机 Ollama。'
  )
}

/** 一行 SSE 里的 `data:` 载荷；不是 data 行返回空串 */
function dataPayload(line: string): string {
  const t = line.trim()
  if (!t.startsWith('data:')) return ''
  return t.slice(5).trim()
}

/**
 * 累积流式正文。
 *
 * 分块边界不等于帧边界：一次 `read()` 可能把一行 JSON 劈成两半，
 * 所以按 `\n` 切完之后，尾部不完整的那段必须留到下一轮再拼（测试里专门有一条钉它）。
 */
async function readSse(
  body: ReadableStream<Uint8Array>,
  onDelta?: (text: string) => void,
  onReasoning?: (text: string) => void,
  onUsage?: (usage: unknown) => void,
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let buffer = ''
  let usage: unknown = null
  let done = false
  while (!done) {
    const r = await reader.read()
    if (r.done) break
    buffer += decoder.decode(r.value, { stream: true })
    const lines = buffer.split('\n')
    // 最后一段可能是不完整的一行，留到下一个分块再拼
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const payload = dataPayload(line)
      if (!payload) continue
      if (payload === '[DONE]') {
        done = true
        break
      }
      let parsed: any
      try {
        parsed = JSON.parse(payload)
      } catch {
        continue // 心跳、注释、厂商自定义的半截帧：跳过，正文不该因为噪声中断
      }
      const delta = parsed?.choices?.[0]?.delta
      if (delta?.reasoning_content) onReasoning?.(String(delta.reasoning_content))
      if (delta?.content) {
        const piece = String(delta.content)
        text += piece
        onDelta?.(piece)
      }
      // 末帧才带 usage（OpenAI 兼容契约），逐帧记「最后一次」
      if (parsed?.usage) usage = parsed.usage
    }
  }
  try {
    reader.releaseLock()
  } catch {
    // 已经关掉了不必再管
  }
  if (usage) onUsage?.(usage)
  return text
}

/** 唯一的自备 Key 发送入口：只支持流式，返回累积全文。失败一律抛错，绝不改走平台额度。 */
export async function streamByoChat(args: ByoStreamArgs): Promise<string> {
  const preset = args.preset
  if (!preset.browserDirect) throw new Error(cannotSend(preset))
  const key = String(args.key ?? '').trim()
  if (preset.requiresKey && !key) {
    throw new Error(`${preset.label} 需要你自己的 Key：在「设置 — AI 通道」里填一次就好。`)
  }

  const url = byoUrl(preset)
  const check = assertForwardTarget(url)
  if (!check.allowed) throw new Error(check.reason ?? '转发目标不在白名单里')

  const fetchImpl = args.fetchImpl ?? globalThis.fetch
  const body: Record<string, unknown> = {
    model: args.model,
    // 厂商契约：第一条必须是 system
    messages: [
      { role: 'system', content: args.system },
      { role: 'user', content: args.user },
    ],
    stream: true,
    stream_options: { include_usage: true },
  }
  if (args.json) body.response_format = { type: 'json_object' }

  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: buildByoHeaders(preset, key),
      body: JSON.stringify(body),
      ...(args.signal ? { signal: args.signal } : {}),
    })
  } catch (error) {
    // 用户点了停止：原样抛，让调用方自己判断是不是取消
    if ((error as any)?.name === 'AbortError') throw error
    throw new Error(byoNetworkText(preset))
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => '')
    throw new Error(byoErrorText(preset, res.status, raw))
  }
  if (!res.body) throw new Error(byoNetworkText(preset))

  try {
    return await readSse(res.body, args.onDelta, args.onReasoning, args.onUsage)
  } catch (error) {
    if ((error as any)?.name === 'AbortError') throw error
    throw new Error(byoNetworkText(preset))
  }
}
