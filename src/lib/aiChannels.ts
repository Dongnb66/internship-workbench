/**
 * AI 通道表：一句话概括这次改动的目的——**让不花钱的功能不花钱，让花钱的功能说清谁付**。
 *
 * 背景（用户拍板）：应用原本只有一条通道，即平台云服务的模型代理，
 * 而它的 `quota_` 错误码语义是 **Creator quota**——所有 AI 消耗都记在应用创建者账上。
 * 现在要加「用户自备 key」这条通道，于是多出三件必须用代码钉住的事：
 *
 * 1. **转发目标只能是表里那几家。** 一个「带上调用者给的 key、转发到调用者给的地址」的
 *    通道，本质就是任何人可用的跳板（SSRF、打内网元数据端点、借别人的 IP 刷站）。
 *    所以**不提供自定义 baseURL 的口子**——哪怕用户说"我知道我在干什么"也不行：
 *    被滥用伤害的不是填地址的人，而是能碰到这个入口的所有人。
 *    模型名可以随便填（它不改变请求去哪），主机不行。
 * 2. **保管 ≠ 记录。** key 只在本机内存与厂商之间流动：不进 URL、不进日志、不进错误文案。
 *    错误文案尤其重要——用户截图来问问题，就等于把 key 贴到了公开群里。
 * 3. **档位是显式选择，默认值必须落在「用户自费」那一档。**
 *    这次改动要解决的问题就是「创建者在替别人付钱」，
 *    所以默认值悄悄回到平台额度，等于功能没改。
 *
 * 2026-09-27 实测之后，第 1 条从「本地网关转发」改成「浏览器直发」：
 * 实测有四家厂商的响应带 `access-control-allow-origin`，浏览器可以直接把请求发给它们，
 * 于是**用户的 Key 一次也不需要经过本项目的任何服务端**。少一跳，就少一处能泄露它的地方。
 * 实测不通的厂商保留在表里、标成 `browserDirect: false`，界面据实说明它现在发不出去。
 */

export type ChannelId = 'byo' | 'platform'

export interface ChannelPreset {
  id: string
  label: string
  /** 精确主机名：白名单按全等匹配，不做前缀/后缀匹配 */
  host: string
  /** OpenAI 兼容的 chat 端点路径 */
  chatPath: string
  /** `none` = 连鉴权头都不带（本机档：Ollama 默认不校验） */
  authStyle: 'bearer' | 'x-api-key' | 'none'
  /** 该厂商的可用模型（前端下拉用，不写死单价——平台与厂商都不给前端权威价格） */
  models: string[]
  /** 界面上必须原样显示的一句话：谁付钱 */
  whoPays: string
  /**
   * 浏览器能不能直发。来自实测（preflight + 真 POST 是否带 ACAO），不是文档说的。
   * false 的厂商在界面上必须显示成「现在发不出去」，而不是伪装成「你的 Key 有问题」。
   */
  browserDirect: boolean
  /** 是否需要用户自备 Key。本机档 false：花的是自己电脑的算力 */
  requiresKey: boolean
  /** 本机档专用：只允许 http + 精确主机 + 精确端口，是 https 规则的唯一例外 */
  httpLocal?: boolean
  /** 本机档钉死的端口 */
  port?: string
}

/**
 * 自备 key 的厂商表。列进来的都满足两件事：OpenAI 兼容端点 + 学生用得起（有免费档或单价低）。
 * 刻意**只列主机不列自定义入口**：见文件头第 1 条。
 */
export const BYO_PRESETS: ChannelPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    host: 'api.deepseek.com',
    chatPath: '/chat/completions',
    authStyle: 'bearer',
    // 名单来源（2026-09-30 核对）：DeepSeek 线上 API 400 报错逐字列出「supported API model names
    // are deepseek-flash, deepseek-v4-pro」——deepseek-chat / deepseek-reasoner 已不在支持名单。
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    whoPays: '花你自己的 DeepSeek 账户余额，与应用创建者无关',
    browserDirect: true,
    requiresKey: true,
  },
  {
    id: 'moonshot',
    label: 'Kimi（Moonshot）',
    host: 'api.moonshot.cn',
    chatPath: '/v1/chat/completions',
    authStyle: 'bearer',
    // 名单来源（2026-09-30 核对）：platform.moonshot.cn 官方快速开始的 model 字段示例逐字
    // （kimi-k3 为主推默认，kimi-k2.7-code-highspeed 为编程高速档，kimi-k2.6 为通用档）。
    models: ['kimi-k3', 'kimi-k2.7-code-highspeed', 'kimi-k2.6'],
    whoPays: '花你自己的 Moonshot 账户余额，与应用创建者无关',
    browserDirect: true,
    requiresKey: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter（一把 Key 多家模型）',
    host: 'openrouter.ai',
    chatPath: '/api/v1/chat/completions',
    authStyle: 'bearer',
    // 名单来源（2026-09-30 核对）：openrouter.ai/api/v1/models 公开列表逐一核对存在。
    // moonshotai/kimi-k2-instruct 已从列表下架（核对日不存在），换成 moonshotai/kimi-k3。
    models: [
      'deepseek/deepseek-chat',
      'moonshotai/kimi-k3',
      'openai/gpt-5',
      'openai/gpt-5-mini',
      'anthropic/claude-fable-5.1',
      'google/gemini-3-flash-preview',
    ],
    whoPays: '花你自己的 OpenRouter 余额，与应用创建者无关',
    browserDirect: true,
    requiresKey: true,
  },
  {
    id: 'dashscope',
    label: '阿里云百炼（通义）',
    host: 'dashscope.aliyuncs.com',
    chatPath: '/compatible-mode/v1/chat/completions',
    authStyle: 'bearer',
    // 名单来源（2026-09-30 核对）：help.aliyun.com/zh/model-studio/models「文本生成」表首行
    // （qwen-turbo / qwen-plus 为旧一代命名，现役主推是 3.8-max / 3.7-plus / 3.8-flash）。
    models: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.8-flash'],
    whoPays: '花你自己的阿里云百炼额度（新用户有免费额度），与应用创建者无关',
    browserDirect: true,
    requiresKey: true,
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    host: 'open.bigmodel.cn',
    chatPath: '/api/paas/v4/chat/completions',
    authStyle: 'bearer',
    // 名单来源（2026-09-30 核对）：docs.bigmodel.cn GLM-5.3 模型页调用示例逐字
    // （glm-5.3 为现役旗舰，glm-5.2 为其基础模型的上一代 ID）。
    models: ['glm-5.3', 'glm-5.2'],
    whoPays: '花你自己的智谱账户额度，与应用创建者无关',
    // 实测两条路径的响应都不带 access-control-allow-origin：浏览器直发必被 CORS 挡掉。
    browserDirect: false,
    requiresKey: true,
  },
  {
    id: 'ollama',
    label: '本机 Ollama（不花钱）',
    host: '127.0.0.1',
    chatPath: '/v1/chat/completions',
    authStyle: 'none',
    // 名单来源（2026-09-30 核对）：ollama.com/library 各模型 tags 页逐一核对存在
    // （qwen3:4b / deepseek-r1:7b 沿用且仍存在，新增 qwen3.5:4b / gpt-oss:20b 两个常用小体积 tag）。
    models: ['qwen3:4b', 'qwen3.5:4b', 'deepseek-r1:7b', 'gpt-oss:20b'],
    whoPays: '跑在你自己电脑上，不花任何人的钱（慢一些，也没有额度这回事）',
    browserDirect: true,
    requiresKey: false,
    httpLocal: true,
    port: '11434',
  },
]

/** 远端厂商（要 Key、只走 https） */
export function remotePresets(): ChannelPreset[] {
  return BYO_PRESETS.filter((p) => !p.httpLocal)
}

/** 本机档（这台电脑的主人是用户自己，所以允许 http 这一个例外） */
export function localPresets(): ChannelPreset[] {
  return BYO_PRESETS.filter((p) => p.httpLocal === true)
}

/** 平台额度档：没有厂商主机（走云服务 SDK），保留给创建者自己用 */
export const PLATFORM_PRESET = {
  id: 'platform',
  label: '本应用的云服务额度',
  host: '',
  chatPath: '',
  authStyle: 'bearer' as const,
  models: [] as string[],
  whoPays: '花应用创建者的额度（Creator quota）；已按日限与每任务步数封顶',
  browserDirect: false,
  requiresKey: false,
}

/**
 * **两条付费通道**（谁付厂商的钱），与上面的厂商表是两个层次：
 * 厂商表回答「key 发给哪家」，通道表回答「这单算谁的」。
 * 分开是因为用户会换厂商，但「自费 / 创建者付」这个区分只有两档。
 *
 * `byo` 这一条的 host/chatPath/models 取**默认厂商**（DeepSeek，最常见），
 * 选了别的厂商时由 `findPreset` 覆盖——不是冗余：界面要能在用户还没选之前就说出正确答案。
 */
export const CHANNELS: Array<ChannelPreset & { paidBy: 'user' | 'creator' }> = [
  {
    ...BYO_PRESETS[0],
    id: 'byo',
    label: `自备 Key（默认 ${BYO_PRESETS[0].label}）`,
    models: remotePresets().flatMap((p) => p.models.map((m) => `${p.id}:${m}`)),
    whoPays: '花你自己的账户余额或额度，与应用创建者无关',
    paidBy: 'user',
  },
  { ...PLATFORM_PRESET, paidBy: 'creator' },
]

/**
 * 默认档 = 自备 key。**这不是保守，是这次改动的目的**：
 * 默认落在平台额度上，就等于「用户用、创建者付」原样保留。
 */
export const AI_CHANNEL_DEFAULT = 'byo'

/** 本机档允许的主机写法：只有这两个，端口还得逐字等于表里那一个 */
const LOCAL_HOSTS = ['127.0.0.1', 'localhost']

function parseUrl(raw: string): URL | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  try {
    return new URL(text)
  } catch {
    return null
  }
}

/**
 * 一个 URL 属于不属于表里的某一档，以及这一档允不允许。
 *
 * **`findPreset` 与 `assertForwardTarget` 共用这一条规则**：「谁能被发到」写两遍，
 * 迟早一处严一处松——那正是 SSRF 类问题的来源。
 */
function matchPreset(url: URL): { preset: ChannelPreset; ok: boolean; reason: string } | null {
  const host = url.hostname.toLowerCase()
  const userinfo = url.username || url.password ? '转发地址不允许携带 userinfo（形如 host@evil 的写法）' : ''
  const local = localPresets()[0]
  if (local && LOCAL_HOSTS.includes(host)) {
    // 本机档只走 http：换成 https 就变成「拿自签证书冒充厂商」的另一条路。
    if (url.protocol !== 'http:') return { preset: local, ok: false, reason: '本机档只允许 http（Ollama 默认没有证书）' }
    if (userinfo) return { preset: local, ok: false, reason: userinfo }
    if (url.port !== local.port) return { preset: local, ok: false, reason: `本机档只允许端口 ${local.port ?? '—'}` }
    return { preset: local, ok: true, reason: '' }
  }
  const preset = remotePresets().find((p) => p.host === host)
  if (!preset) return null
  if (url.protocol !== 'https:') {
    return { preset, ok: false, reason: '只允许 https 转发（明文会把你的 key 发给路上任何人）' }
  }
  if (userinfo) return { preset, ok: false, reason: userinfo }
  if (url.port && url.port !== '443') return { preset, ok: false, reason: '转发地址只允许默认端口 443' }
  return { preset, ok: true, reason: '' }
}

/** 认得出表里的地址才返回那一档；认不出返回 null，绝不"勉强匹配一个"（那等于把 key 发给陌生主机） */
export function findPreset(baseUrl: string): ChannelPreset | null {
  const url = parseUrl(baseUrl)
  if (!url) return null
  const hit = matchPreset(url)
  return hit && hit.ok ? hit.preset : null
}

export interface ForwardCheck {
  allowed: boolean
  reason?: string
  /** 放行时告诉调用方这是哪一档：要不要带 Key、是不是本机档 */
  preset?: ChannelPreset
}

/**
 * 发送前的最后一道闸。**浏览器直发也要过它**：目标地址虽然来自数据表，
 * 但表会被改、路径会被拼、调用方会传进用户输入——发出去之前再核一遍最终 URL。
 *
 * **拒绝理由里一律不回显传入的地址**：地址可能带着 key 或 token，
 * 而这句话会被打印进日志、被用户截图问人。
 */
export function assertForwardTarget(url: string): ForwardCheck {
  const raw = String(url ?? '').trim()
  if (!raw) return { allowed: false, reason: '转发地址为空' }
  const parsed = parseUrl(raw)
  if (!parsed) return { allowed: false, reason: '转发地址无法解析' }
  const hit = matchPreset(parsed)
  // 全等匹配。`api.deepseek.com.evil.cn` 这种后缀伪装在这里被挡掉：
  // 它不等于任何白名单主机，而按「以 xxx 开头」匹配就会放行。
  if (!hit) {
    return { allowed: false, reason: '这个主机不在厂商白名单里。只发白名单厂商与本机 Ollama，不做通用代理' }
  }
  if (!hit.ok) return { allowed: false, reason: hit.reason }
  return { allowed: true, preset: hit.preset }
}

/** 形如 sk-xxxx / rk-xxxx / pk-xxxx 的密钥串（长度门槛避免误伤普通文本） */
const KEY_SHAPE = /\b(?:sk|rk|pk|wt|api)[-_][A-Za-z0-9]{12,}\b/g

function mask(one: string): string {
  return `${one.slice(0, 6)}${'*'.repeat(10)}（${one.length} 位已隐藏）`
}

/**
 * 脱敏。**两种输入都覆盖**：
 * - 传进来就是一把 key → 返回掩码形式，保留前 6 位便于「是不是这把」的对号；
 * - 传进来是一段错误文本/日志行 → 把里面所有 key 形态的子串逐个换掉。
 *
 * 之所以存在这个函数：后端一旦被要求把上游响应原文回传（401/429 排障很常见），
 * 厂商的错误体里常常回显 Authorization；那行文字一旦进 console 或 UI，key 就泄露了。
 */
export function redactKey(input: string): string {
  const text = String(input ?? '')
  if (!text) return ''
  const replaced = text.replace(KEY_SHAPE, (one) => mask(one))
  // 整串就是一把 key 时上面已经处理；若是「长得像 key 但没有前缀」的裸 token，
  // 至少保证调用方传空/异常输入不会炸。
  return replaced
}

export interface ChannelState {
  id: ChannelId
  paidBy: 'user' | 'creator'
  label: string
  whoPays: string
  /** true = 传进来的值不认识，已回落到默认档（不抛错也不静默变成另一档） */
  fallback: boolean
}

/**
 * 界面上「谁付钱」这句话的唯一来源。
 * 未知值不抛错：档位存在 localStorage 里，用户手改/旧版本残留都会喂进奇怪的值，
 * 但**也不静默按另一档计费**——回落的同时把 fallback 标出来，让界面能显示「档位不认识，已按默认」。
 */
export function describeChannel(id: string): ChannelState {
  const known = CHANNELS.find((c) => c.id === id)
  if (known) {
    return {
      id: known.id as ChannelId,
      paidBy: known.paidBy,
      label: known.label,
      whoPays: known.whoPays,
      fallback: false,
    }
  }
  const fallbackState = CHANNELS.find((c) => c.id === AI_CHANNEL_DEFAULT) ?? CHANNELS[0]
  return {
    id: fallbackState.id as ChannelId,
    paidBy: fallbackState.paidBy,
    label: fallbackState.label,
    whoPays: fallbackState.whoPays,
    fallback: true,
  }
}
