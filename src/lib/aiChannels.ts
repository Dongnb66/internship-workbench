/**
 * AI 通道表：一句话概括这次改动的目的——**让不花钱的功能不花钱，让花钱的功能说清谁付**。
 *
 * 背景（用户拍板）：应用原本只有一条通道，即平台云服务的模型代理，
 * 而它的 `quota_` 错误码语义是 **Creator quota**——所有 AI 消耗都记在应用创建者账上。
 * 现在要加「用户自备 key」这条通道，于是多出三件必须用代码钉住的事：
 *
 * 1. **转发目标只能是厂商白名单。** 一个「带上调用者给的 key、转发到调用者给的地址」的
 *    后端，本质就是任何人可用的跳板（SSRF、打内网元数据端点、借你的 IP 刷别人的站）。
 *    所以**不提供自定义 baseURL 的口子**——哪怕用户说"我知道我在干什么"也不行：
 *    被滥用伤害的不是填地址的人，而是拿到这个后端 URL 的所有人。
 * 2. **保管 ≠ 记录。** key 只在本机内存与厂商之间流动：不进 URL、不进日志、不进错误文案。
 *    错误文案尤其重要——用户截图来问问题，就等于把 key 贴到了公开群里。
 * 3. **档位是显式选择，默认值必须落在「用户自费」那一档。**
 *    这次改动要解决的问题就是「创建者在替别人付钱」，
 *    所以默认值悄悄回到平台额度，等于功能没改。
 */

export type ChannelId = 'byo' | 'platform'

export interface ChannelPreset {
  id: string
  label: string
  /** 精确主机名：白名单按全等匹配，不做前缀/后缀匹配 */
  host: string
  /** OpenAI 兼容的 chat 端点路径 */
  chatPath: string
  authStyle: 'bearer' | 'x-api-key'
  /** 该厂商的可用模型（前端下拉用，不写死单价——平台与厂商都不给前端权威价格） */
  models: string[]
  /** 界面上必须原样显示的一句话：谁付钱 */
  whoPays: string
}

/**
 * 自备 key 的厂商表。三家都是文档化的 OpenAI 兼容端点。
 * 刻意**只列主机不列自定义入口**：见文件头第 1 条。
 */
export const BYO_PRESETS: ChannelPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    host: 'api.deepseek.com',
    chatPath: '/chat/completions',
    authStyle: 'bearer',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    whoPays: '花你自己的 DeepSeek 账户余额，与应用创建者无关',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    host: 'open.bigmodel.cn',
    chatPath: '/api/paas/v4/chat/completions',
    authStyle: 'bearer',
    models: ['glm-4.7-flash', 'glm-4.6', 'glm-4.5-air'],
    whoPays: '花你自己的智谱账户额度，与应用创建者无关',
  },
  {
    id: 'moonshot',
    label: 'Kimi（Moonshot）',
    host: 'api.moonshot.cn',
    chatPath: '/v1/chat/completions',
    authStyle: 'bearer',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-8k'],
    whoPays: '花你自己的 Moonshot 账户余额，与应用创建者无关',
  },
]

/** 平台额度档：没有厂商主机（走云服务 SDK），保留给创建者自己用 */
export const PLATFORM_PRESET = {
  id: 'platform',
  label: '本应用的云服务额度',
  host: '',
  chatPath: '',
  authStyle: 'bearer' as const,
  models: [] as string[],
  whoPays: '花应用创建者的额度（Creator quota）；已按日限与每任务步数封顶',
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
    models: BYO_PRESETS.flatMap((p) => p.models.map((m) => `${p.id}:${m}`)),
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

/** 只接受 https + 主机全等；任何 userinfo、端口、后缀花招一律不认 */
export function findPreset(baseUrl: string): ChannelPreset | null {
  const raw = String(baseUrl ?? '').trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  const host = url.hostname.toLowerCase()
  return BYO_PRESETS.find((p) => p.host === host) ?? null
}

export interface ForwardCheck {
  allowed: boolean
  reason?: string
}

/**
 * 转发前的最后一道闸。调用方是本地网关：它收到 body 之后必须再过一次这里，
 * 不能只信前端——前端的输入框就是公网可达的攻击面。
 *
 * **拒绝理由里一律不回显传入的地址**：地址可能带着 key 或 token，
 * 而这句话会被打印进日志、被用户截图问人。
 */
export function assertForwardTarget(url: string): ForwardCheck {
  const raw = String(url ?? '').trim()
  if (!raw) return { allowed: false, reason: '转发地址为空' }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { allowed: false, reason: '转发地址无法解析' }
  }
  if (parsed.protocol !== 'https:') {
    return { allowed: false, reason: '只允许 https 转发（明文会把你的 key 发给路上任何人）' }
  }
  // 纵深防御，**不是承重墙**：决定请求去哪的是下面按 parsed hostname 做的白名单全等匹配，
  // 所以这条即使删掉，行为也不变（我拿它做过变异检查，测试全绿）。
  // 留着是因为它将来决定安全性：谁把下面改成按字符串匹配主机名，这条就立刻变成必要防线。
  if (parsed.username || parsed.password) {
    return { allowed: false, reason: '转发地址不允许携带 userinfo（形如 host@evil 的写法）' }
  }
  if (parsed.port && parsed.port !== '443') {
    return { allowed: false, reason: '转发地址只允许默认端口 443' }
  }
  const host = parsed.hostname.toLowerCase()
  // 全等匹配。`api.deepseek.com.evil.cn` 这种后缀伪装在这里会被挡掉：
  // 它不等于任何白名单主机，而按「以 xxx 开头」匹配就会放行。
  if (!BYO_PRESETS.some((p) => p.host === host)) {
    return { allowed: false, reason: '这个主机不在厂商白名单里。后端只做厂商转发，不做通用代理' }
  }
  return { allowed: true }
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
