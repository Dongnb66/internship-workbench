import { cloud } from '../cloud'
import { currentAccess, currentPreset, getByoModel, readUserKey } from './billing'
import { streamByoChat } from './byoSend'
import { DIMS, GREETING_RULES } from './constants'
import { todayISO } from './format'
import { createQuotaStore, DEFAULT_QUOTA, type QuotaStatus, type QuotaStorage } from './quota'
import { wrapUntrusted } from './untrusted'
import type { Profile } from '../types'

/**
 * 用户自选模型的 localStorage 键。
 *
 * 为什么放 localStorage 而不是 profile 表：这是**设备级偏好**（同一账号在不同
 * 设备上可能想用不同模型），而且模型目录是平台级的、跟账号数据无关。
 */
const MODEL_CHOICE_KEY = 'wb_model_choice'

// 按档分开缓存：见 pickModel 的注释
let cachedModel = new Map<boolean, string>()
let cachedModels: UsableModel[] | null = null

export interface UsableModel {
  id: string
  name: string
  /** 目录里可能给 vendor（本环境是 f/j/e/v 这类打码代号，展示无意义），有真名才用 */
  provider?: string
  /** 平台下发的积分倍率文案，实测形如「x0.11 credits」；Auto 不固定所以目录不填 */
  credits?: string
  /** 思考型模型：先吐 reasoning_content（不出正文）再出结果，选它要有等更久的预期 */
  reasoning: boolean
}

/** 可选模型目录（供设置页下拉框用）。列表进程内缓存，选模型后手动刷新即可。 */
export async function listUsableModels(): Promise<UsableModel[]> {
  if (cachedModels) return cachedModels
  const models = await cloud.llm.models.list()
  cachedModels = (models ?? [])
    .filter((m: any) => m?.disabled !== true && m?.enabled !== false)
    .map((m: any) => {
      // vendor 在本环境是单字母打码代号，显示出来只是噪声；>1 字符才当成可读厂商名
      const vendor = typeof m?.vendor === 'string' && m.vendor.length > 1 ? m.vendor : undefined
      return {
        id: String(m.id),
        name: String(m.name || m.id),
        provider: m.provider ? String(m.provider) : vendor,
        credits: m.credits ? String(m.credits) : undefined,
        reasoning: m.supportsReasoning === true || m.onlyReasoning === true,
      }
    })
  return cachedModels
}

/**
 * 模型计费展示文案（纯函数，便于断言）。
 *
 * 「花的是谁的额度」在本应用里唯一的可核对依据：目录下发的 credits 是**积分倍率**，
 * 不是价格——绝对金额无法在前端算出（目录不给单价、也不给余额接口）。
 * 所以文案只说倍率与相对快慢，绝不换算成钱。
 */
export function modelCostLabel(m?: Pick<UsableModel, 'id' | 'credits' | 'reasoning'> | null): string {
  if (!m) return '未选具体模型，按平台默认（Auto）计费'
  const rate = m.credits?.replace(/credits?/i, '').trim().replace(/^x/i, '')
  const base = rate
    ? `积分倍率 x${rate}`
    : m.id === 'auto'
      ? '积分倍率按任务浮动（Auto 自动挑模型）'
      : '平台未下发该模型的积分倍率'
  return m.reasoning ? `${base} · 思考型，更慢` : base
}

/**
 * 目录倍率文案 → 数字（纯解析，便于断言）。实测目录里有「x0.06 credits」与「x0.05」两种写法。
 *
 * **不可解析时返回 null，绝不返回 0**：0 会被当成「免费」而永远当选，
 * 而 `auto` 那类「按任务浮动」是根本没下发倍率——那是**未知价格**，不是便宜。
 *
 * 注意 `modelCostLabel` 走的是另一条路：它要**原样显示平台给的文本**
 * （`x0.60` 不该被我们打印成 `x0.6`），只有做数值比较时才用这个解析。
 */
export function modelRate(m: Pick<UsableModel, 'credits'>): number | null {
  const text = String(m.credits ?? '').replace(/credits?/i, '').trim().replace(/^x/i, '')
  if (!text) return null
  const n = Number(text)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 挑目录里**倍率最低**的模型 id；一个倍率都没下发时返回 null（调用方回退默认）。
 * 并列时偏向非思考型：同样便宜，慢的那个别拿去转循环——巡检一圈要打 1–8 次模型，
 * 而默认档 `auto` 恰好是 `onlyReasoning` 的思考型（实测），所以这条不是洁癖。
 */
export function pickCheapModel(models: Array<Pick<UsableModel, 'id' | 'credits' | 'reasoning'>>): string | null {
  let best: { id: string; rate: number; reasoning: boolean } | null = null
  for (const m of models) {
    const rate = modelRate(m)
    if (rate === null) continue
    const reasoning = m.reasoning === true
    const better =
      !best || rate < best.rate || (rate === best.rate && best.reasoning && !reasoning)
    if (better) best = { id: m.id, rate, reasoning }
  }
  return best?.id ?? null
}

export function getModelChoice(): string | null {
  try {
    return localStorage.getItem(MODEL_CHOICE_KEY)
  } catch {
    return null
  }
}

/** 保存/清除用户的模型选择；清除后回退到目录默认（usable[0]） */
export function setModelChoice(id: string | null): void {
  try {
    if (id) localStorage.setItem(MODEL_CHOICE_KEY, id)
    else localStorage.removeItem(MODEL_CHOICE_KEY)
  } catch {
    // localStorage 不可用（隐私模式等）：本次会话内仍可通过 pickModel 兜底
  }
  cachedModel = new Map()
}

/**
 * 决定本次调用用哪个模型：
 * 1. `cheap=true`（智能体循环）→ 目录里倍率最低的那个；一个倍率都没下发时回退到下面的默认逻辑，
 *    而不是「没有模型可用」；
 * 2. 用户在设置页选过的模型，且它仍在可用目录里 → 用它；
 * 3. 否则回退到目录第一个可用模型（旧行为，保证永远有模型可调）。
 * 所选模型被平台下架/禁用时不报错，静默回退——评估失败比换模型更糟。
 *
 * 缓存**按档分开**（`Map<boolean, string>`）而不是一个变量：巡检走便宜档、
 * 单次评估走用户档，如果共用一个格子，谁先调用就把另一个也冻在那个答案上——
 * 症状是「用户在设置页换了模型，但跑过一次巡检之后又变回便宜档」，极难归因。
 */
export async function pickModel(cheap = false): Promise<string | null> {
  const hit = cachedModel.get(cheap)
  if (hit) return hit
  const models = await listUsableModels()
  if (!models.length) return null
  if (cheap) {
    const cheapest = pickCheapModel(models)
    if (cheapest) {
      cachedModel.set(cheap, cheapest)
      return cheapest
    }
  }
  const choice = getModelChoice()
  const chosen = choice ? models.find((m) => m.id === choice) : null
  const picked = (chosen ?? models[0]).id
  cachedModel.set(cheap, picked)
  return picked
}

export interface StreamOptions {
  system: string
  user: string
  /**
   * 这次调用属于哪件「任务」。必填是刻意的：额度按任务数算（AGENT_PLAN §5 红线——
   * 用户理解「今天还能跑 20 次巡检」，理解不了「还能调 137 次模型」），
   * 没有归属就没有每任务熔断，agent 死循环时没人知道是谁在转。
   * 新增调用点漏标会在编译期红，另有 aiQuotaCoverage.test.mjs 从源码推导兜底。
   */
  task: string
  json?: boolean
  signal?: AbortSignal
  onDelta?: (text: string) => void
  /**
   * 思考型模型的推理增量（reasoning_content）。
   * 只用于「它还在动」的进度提示，绝不混进正文——推理内容不是给用户看的结论。
   */
  onReasoning?: (text: string) => void
  /**
   * 走目录里倍率最低的模型。**智能体循环必须带它**：一圈一次调用、最多 8 圈，
   * 选错档不是一点点差价，而额度记在**创建者**账号上（AGENT_PLAN §3.4）。
   * 单次评估/话术不传——那是用户自己在设置页选的档。
   * 目录一个倍率都没下发时回退到默认逻辑，不会「因为没有倍率而调不到模型」。
   */
  cheap?: boolean
}

/**
 * 本次浏览器会话累计的模型消耗（sessionStorage，随标签页关闭归零）。
 *
 * 为什么要有它：应用**不需要用户自备 API Key**，调用走本应用的云服务额度，
 * 用户因此完全看不见消耗。把 token 数摆在设置页，让「花的是谁的额度」这件事可见。
 */
export interface TokenStats {
  calls: number
  prompt: number
  completion: number
  total: number
}

const STATS_KEY = 'wb_token_stats'

function readStats(): TokenStats {
  try {
    const raw = sessionStorage.getItem(STATS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return {
      calls: Number(parsed?.calls ?? 0),
      prompt: Number(parsed?.prompt ?? 0),
      completion: Number(parsed?.completion ?? 0),
      total: Number(parsed?.total ?? 0),
    }
  } catch {
    return { calls: 0, prompt: 0, completion: 0, total: 0 }
  }
}

export function getTokenStats(): TokenStats {
  return readStats()
}

function recordUsage(u: any): void {
  try {
    const prev = readStats()
    const next: TokenStats = {
      calls: prev.calls + 1,
      prompt: prev.prompt + Number(u?.prompt_tokens ?? 0),
      completion: prev.completion + Number(u?.completion_tokens ?? 0),
      total: prev.total + Number(u?.total_tokens ?? 0),
    }
    sessionStorage.setItem(STATS_KEY, JSON.stringify(next))
  } catch {
    // 隐私模式等：统计不可用不影响调用
  }
}

/**
 * 把云服务的模型调用错误翻成用户能行动的中文。
 *
 * 依据官方云服务的错误契约：LLM 错误一律是 CloudOpenAIError，只按稳定的 `error.code`
 * 前缀分支（request_ / auth_ / quota_ / gateway_ / model_ / internal_），不要读私有字段。
 *
 * `quota_` 的语义是 **Creator quota**（创建者额度）——本应用的 AI 额度记在**应用创建者**
 * 账号上，不是终端用户自己的。所以文案必须说清「不是你的额度问题」，否则每个用户都会
 * 以为自己欠费，然后去问一个跟他对不上的客服。
 */
export function aiErrorText(error: unknown): string {
  const e = error as any
  const code = String(e?.error?.code ?? e?.code ?? '').trim()
  const raw = String(e?.error?.message ?? (typeof error === 'string' ? error : e?.message ?? '')).trim()
  const tail = code ? `（${code}）` : ''

  if (code === 'gateway_stream_interrupted') {
    return `连接中断，上面已生成的内容保留着，可以重新分析${tail}`
  }
  if (code.startsWith('request_')) return `请求参数或所选模型不被支持，换一个模型再试${tail}`
  if (code.startsWith('auth_')) return `AI 通道校验失败：应用标识或访问域名不匹配，与你的账号无关${tail}`
  if (code.startsWith('quota_')) {
    const wait = Number(e?.retryAfterMs)
    if (code === 'quota_rate_limited' && Number.isFinite(wait) && wait > 0) {
      return `调用太频繁，请 ${Math.ceil(wait / 1000)} 秒后重试${tail}`
    }
    return `本应用的 AI 额度已用尽（额度记在应用创建者账号上，不是你的账号）${tail}`
  }
  if (code.startsWith('gateway_') || code.startsWith('model_')) return `模型服务暂时不可用，稍后重试${tail}`
  if (code.startsWith('internal_')) {
    return `服务内部错误，请把这条报给应用创建者${e?.requestId ? `（requestId: ${e.requestId}）` : ''}`
  }
  if (e?.status === 429) return `调用过于频繁，或本应用的 AI 额度已用尽，稍后重试${tail}`
  if (e?.status === 401 || e?.status === 403) return `AI 通道校验失败，与你的账号无关${tail}`
  return raw || '模型调用失败，请重试'
}

/**
 * localStorage 不可用时的占位实现：让额度存储直接进**降级态**（fail-open 但 degraded 可见），
 * 而不是在调用链上抛一个跟 AI 无关的错。
 */
const missingStorage: QuotaStorage = {
  getItem: () => {
    throw new Error('localStorage 不可用')
  },
  setItem: () => {
    throw new Error('localStorage 不可用')
  },
}

/**
 * 每次调用现取一个 store，不在模块级缓存：
 * localStorage 可能跑到一半才坏（隐私模式、配额爆了），
 * 缓存就会把「降级」冻在第一次读到的状态上，护栏坏掉反而看不见了。
 */
function quotaStore() {
  return createQuotaStore(typeof localStorage === 'undefined' ? missingStorage : localStorage, DEFAULT_QUOTA)
}

/** 今天的额度快照（设置页 / 巡检面板显示「还能干几件事」用） */
export function getQuotaSnapshot(focusTask?: string): QuotaStatus {
  return quotaStore().status(todayISO(), focusTask)
}

/**
 * 任务身份 = **能力 + 对象**，不是只有能力。
 *
 * 批量评估 20 个岗位时，每个岗位各是用户眼里的一件「事」；如果它们共用「JD 评估」
 * 这一个标签，第 9 个岗位就会被每任务 8 步上限当成「失控循环」误杀。
 * 反过来，agent 循环自己会用**固定**标签（同一件事转很多圈），那正是这道闸要挡的。
 *
 * 对象取正文开头 60 字 + 总长：同一段文本重复评估仍算同一件事，不同岗位几乎不会撞。
 */
export function taskSubject(prefix: string, text: string): string {
  const key = String(text ?? '').trim()
  return key ? `${prefix}：${key.slice(0, 60)}(${key.length})` : prefix
}

/** 唯一的模型调用入口：只支持流式，逐帧累积文本。计费门与额度护栏都挡在这里。 */
export async function streamChat(opts: StreamOptions): Promise<string> {
  // 计费门在额度门之前：没付钱资格时连「今天还剩几次」都不该被消耗掉
  const access = currentAccess()
  if (!access.allowed) throw new Error(access.reason)

  const store = quotaStore()
  const day = todayISO()
  // 先查额度再挑模型：被挡住时连目录请求都不该发出去
  const gate = store.status(day, opts.task)
  if (!gate.allowed) throw new Error(gate.reasons.join('；'))

  /**
   * 走到 byo 就**只**走 byo。这里绝不允许"先发不出去就改用平台额度顶着"：
   * 那种临时回落正是本次改动要消灭的东西，而且它一旦发生没人会察觉——
   * 用户以为花的是自己的钱，实际记在创建者账上。发送器失败时同样直接抛出去。
   */
  const byo = access.access === 'byo'
  let model = ''
  if (!byo) {
    const picked = await pickModel(opts.cheap === true)
    if (!picked) throw new Error('当前没有可用模型，请稍后重试')
    model = picked
  }

  let text = ''
  // 末帧才带 usage；逐帧记「最后一次」，循环结束后统一入账，避免重复计数
  let lastUsage: any = null
  let started = false
  let aborted = false
  let failure: unknown = null
  try {
    // 置在真正发请求之前：预检失败（没 Key、白名单不认）会多记一格额度。
    // 宁可多记不可少记——这一档烧的是使用者自己的钱。
    started = true
    if (byo) {
      text = await streamByoChat({
        preset: currentPreset(),
        key: readUserKey(),
        model: getByoModel(),
        system: opts.system,
        user: opts.user,
        json: opts.json,
        signal: opts.signal,
        onDelta: opts.onDelta,
        onReasoning: opts.onReasoning,
        onUsage: (u) => {
          lastUsage = u
        },
      })
    } else {
      const stream = await cloud.llm.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        stream: true,
        stream_options: { include_usage: true },
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      } as any)

      for await (const chunk of stream as any) {
        const delta = chunk?.choices?.[0]?.delta
        if (delta?.reasoning_content) opts.onReasoning?.(delta.reasoning_content)
        if (delta?.content) {
          text += delta.content
          opts.onDelta?.(delta.content)
        }
        if (chunk?.usage) lastUsage = chunk.usage
      }
    }
  } catch (error) {
    aborted = (error as any)?.name === 'AbortError'
    failure = error
  }

  /**
   * 额度记账：请求发出去过就算一次（含随后失败），主动取消不算。
   * 取消不算的代价是「反复手动取消」能少记额度——可以接受：每次取消都要人亲手点一下，
   * 不是会自动放大的那种失控。
   */
  if (started && !aborted) store.record(opts.task, day)

  // 主动取消不算故障，原样抛出，让调用方自己判断
  if (aborted) throw failure
  if (failure) throw new Error(aiErrorText(failure))

  // 即使网关没回 usage 也要计入调用次数——「调了几次/花了多少」里次数是确定的事实
  recordUsage(lastUsage)
  return text
}

export function profileBrief(profile: Profile | null): string {
  if (!profile) return '（发起人尚未填写画像，仅依据 JD 本身评估）'
  return [
    `姓名：${profile.full_name ?? '—'}`,
    `年级：${profile.grade ?? '—'} / ${profile.grad_year ?? '—'}`,
    `专业：${profile.major ?? '—'}`,
    `期望城市：${(profile.expect_city ?? []).join('、') || '—'}`,
    `期望岗位类型：${(profile.expect_type ?? []).join('、') || '—'}`,
    `期望日薪：${profile.expect_daily ?? '—'}`,
    `技能：${(profile.skills ?? []).join('、') || '—'}`,
    `目标方向：${(profile.directions ?? []).join('、') || '—'}`,
    `项目与事实：${profile.resume_summary ?? '—'}`,
  ].join('\n')
}

/**
 * 语气样本：用户自己写的「一句话自我介绍」原文。
 *
 * 设计来源：career-ops 的 `voice-dna.template.md` + `writing-samples/` —— 不靠"请写得自然点"
 * 这种空指令，而是喂**本人真实写过的原文**去限制句长与用词，这是治「一眼像 AI 写的」唯一有效的手段。
 *
 * 为什么不重新开一个数据库字段：`self_intro` 本身就是他手写的原文，语义上正好就是语气样本，
 * 而新增字段要做迁移 + 让用户多填一遍同一类东西。字段不够长时（<30 字）返回 null，
 * 宁可完全不注入，也不要拿半句话当风格锚点。
 */
export function voiceSample(profile: Profile | null): string | null {
  const text = String(profile?.self_intro ?? '').trim()
  return text.length >= 30 ? text : null
}

/**
 * 语气样本块。刻意**不**套 `wrapUntrusted`：这段文字来自用户本人在应用里填写的字段，
 * 不是抓来的外部文本。给它套上「外部来源数据」的声明会让声明本身失真——
 * 包装器的价值在于语义准确，不是为了到处盖章。
 */
export function voiceBlock(profile: Profile | null): string {
  const sample = voiceSample(profile)
  if (!sample) return ''
  return [
    '【我的语气样本（我本人写的原文，只用来模仿句长与用词习惯，里面的事实不必复述）】',
    '"""',
    sample,
    '"""',
    '模仿它的口吻与句长，不要写得更正式、更工整、更套路化。',
  ].join('\n')
}

// ------------------------------------------------------------ prompt 组装
//
// 这一层被单独抽出来，是因为「外部文本有没有被隔离」这件事必须可断言。
// 直接在调用点拼字符串的话，验证只能靠读代码；拆成纯函数后，测试可以断言
// **实际发出去的 user message** 里带着边界标记和不可信声明。

/** AI 评估：JD 是抓来的外部文本，必须走隔离包装 */
export function buildEvalUserMessage(jd: string, profile: Profile | null): string {
  return `【候选人画像】\n${profileBrief(profile)}\n\n${wrapUntrusted('目标岗位 JD', jd.slice(0, 8000))}`
}

/** 打招呼：JD 走隔离包装，语气样本走可信块 */
export function buildGreetingUserMessage(company: string, title: string, jd: string, profile: Profile | null): string {
  const voice = voiceBlock(profile)
  return [
    `【候选人画像】\n${profileBrief(profile)}`,
    voice,
    `【公司与岗位】${company} · ${title}`,
    wrapUntrusted('JD 原文', jd.slice(0, 6000)),
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildApplyUserMessage(company: string, title: string, jd: string, profile: Profile | null): string {
  const voice = voiceBlock(profile)
  const jdBlock = jd.trim() ? wrapUntrusted('JD', jd.slice(0, 6000)) : '（未提供 JD）'
  return [
    `【候选人画像】\n${profileBrief(profile)}`,
    voice,
    `【公司岗位】${company || '（未填）'} · ${title || '（未填）'}`,
    jdBlock,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** 简历全文来自上传的附件文件，同样是外部输入 */
export function buildResumeAnalysisUserMessage(text: string, targetRole?: string | null): string {
  const role = targetRole?.trim() || '（未指定，按通用软件研发实习评估）'
  return `【目标岗位】${role}\n\n${wrapUntrusted('简历全文', text.slice(0, 12000))}`
}

export function buildFieldDraftUserMessage(text: string): string {
  return wrapUntrusted('简历全文', text.slice(0, 12000))
}

/** 面试复盘：用户自己打的零散记录，同样是外部文本 */
export function buildReflectionUserMessage(text: string): string {
  return wrapUntrusted('我的面试记录', text.slice(0, 6000))
}

const EVAL_SYSTEM = `你是中国大学生实习/校招求职的 JD 评估助手，输出必须诚实、可执行、不虚构。
只输出一个 JSON 对象，不要输出任何解释文字或 Markdown 代码块，结构如下：
{
  "score": 0-100 的整数匹配度,
  "verdict": "一句话结论（值不值得投，20 字内）",
  "dims": { ${DIMS.map((d) => `"${d}": 1-10 的整数`).join(', ')} },
  "highlights": ["与候选人真实经历对得上的亮点，2-4 条"],
  "gaps": ["JD 要求但候选人明显缺失或存疑的点，1-4 条；没有就写空数组"],
  "greeting": "给 HR 的一句打招呼（可复制直接发送）"
}
规则：
- highlights 只能来自候选人画像里真实存在的事实，不得虚构经历或技能。
- gaps 要直说，但语气中性，不做人身评价。
- greeting 必须遵守下面的打招呼纪律。
${GREETING_RULES}`

export interface Evaluated {
  score: number
  verdict: string
  dims: Record<string, number>
  highlights: string[]
  gaps: string[]
  greeting: string
}

export async function evaluateJD(jd: string, profile: Profile | null, onDelta?: (t: string) => void): Promise<Evaluated> {
  const raw = await streamChat({
    task: taskSubject('JD 评估', jd),
    system: EVAL_SYSTEM,
    user: buildEvalUserMessage(jd, profile),
    json: true,
    onDelta,
  })
  const parsed = JSON.parse(raw) as Evaluated
  const dims: Record<string, number> = {}
  for (const d of DIMS) {
    const v = Number(parsed?.dims?.[d])
    dims[d] = Number.isFinite(v) ? Math.max(1, Math.min(10, Math.round(v))) : 5
  }
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(parsed?.score ?? 60)))),
    verdict: String(parsed?.verdict ?? '评估完成'),
    dims,
    highlights: Array.isArray(parsed?.highlights) ? parsed.highlights.map(String) : [],
    gaps: Array.isArray(parsed?.gaps) ? parsed.gaps.map(String) : [],
    greeting: String(parsed?.greeting ?? ''),
  }
}

export async function generateGreeting(company: string, title: string, jd: string, profile: Profile | null, onDelta?: (t: string) => void): Promise<string> {
  return streamChat({
    task: `打招呼：${company || '未填'} · ${title || '未填'}`,
    system: `你在帮一名中国大学生写发给 HR / 技术负责人 的第一条打招呼消息。输出只有消息正文本身，不要标题、不要解释、不要引号包裹。
${GREETING_RULES}`,
    user: buildGreetingUserMessage(company, title, jd, profile),
    onDelta,
  })
}

// ---------------------------------------------------------------- 面试准备包

/**
 * 面试准备包的三路输入。触发场景：投递后 HR 约面 → 用户要准备这一场。
 * JD 与简历决定「他会问什么」，历史复盘决定「这场要重点补什么」——
 * 同一家二面/三面时，上一场登记的薄弱点会被带进来（复盘喂出题的闭环）。
 */
export interface InterviewPrepParts {
  company: string
  title: string
  jd: string
  /** 我投的那份简历全文（resumes.content_text），缺席时整块省略 */
  resumeText?: string | null
  /** 同一投递的往轮记录（questions / reflection 非空才收） */
  pastRounds?: { round: string; questions: string; reflection: string }[]
}

/**
 * 三路外部文本各自包成独立数据区，而不是合并成一块：
 * JD 是陌生人写的、简历是附件文件、复盘是自己敲的零散记录——来源不同，
 * 边界混在一个区里，模型就分不清「哪段是谁说的、哪段能当事实」。
 */
export function buildInterviewPrepUserMessage(parts: InterviewPrepParts, profile: Profile | null): string {
  const jd = String(parts.jd ?? '').trim()
  const blocks = [
    `【候选人画像】\n${profileBrief(profile)}`,
    `【公司岗位】${parts.company || '（未填）'} · ${parts.title || '（未填）'}`,
    jd ? wrapUntrusted('JD 原文', jd.slice(0, 6000)) : '（未提供 JD：按简历与通用面试题准备）',
  ]
  const resume = String(parts.resumeText ?? '').trim()
  if (resume) blocks.push(wrapUntrusted('我投的简历全文', resume.slice(0, 12000)))
  const rounds = (parts.pastRounds ?? [])
    .filter((r) => String(r.questions ?? '').trim() || String(r.reflection ?? '').trim())
    .map((r) => {
      const q = String(r.questions ?? '').trim()
      const f = String(r.reflection ?? '').trim()
      return `【${r.round || '上一轮'}】\n被问到的问题：${q || '（未登记）'}\n我的复盘：${f || '（未登记）'}`
    })
  if (rounds.length) blocks.push(wrapUntrusted('同一家公司历史面试记录', rounds.join('\n\n').slice(0, 6000)))
  return blocks.filter(Boolean).join('\n\n')
}

const INTERVIEW_PREP_SYSTEM = `你是技术面试教练，为一场即将到来的校招/实习面试生成准备材料。候选人会给你三样东西：岗位 JD、他投出去的那份简历、同一家公司往轮的面试记录（可能缺一两样）。
输出 Markdown，固定三节，不要客套开头：

## 一、项目深挖（面试官拿着我的简历最可能追问）
针对简历上出现的每个项目，列出 2-4 个最可能被追问的问题，每题下面给「答题框架」：必须引用简历或 JD 里真实出现的设计、数字与技术词，教他怎么组织回答，不替他编造新事实。

## 二、高频八股（按 JD 技术栈 × 简历技术词的交集排优先级）
每个知识点一行：「考点 —— 一句话答题要点」。只有 JD 或简历里真实出现的才列，没有交集就直说「两边重合度低，按简历技术栈列」。

## 三、缺口与补救（JD 提到但我简历没覆盖的）
每条给「用哪段已有能力顶上」的答法。措辞纪律：
- 不虚构经历，数字必须来自简历原文；
- 不写「我不会/没学过」这类自我设限，一律改成「短期可迁移 + 用哪段经验顶上」的积极框架；
- 简历与 JD 重合度太低时如实说，不要硬凑。`

export async function generateInterviewPrep(parts: InterviewPrepParts, profile: Profile | null, onDelta?: (t: string) => void): Promise<string> {
  return streamChat({
    task: `面试准备包：${parts.company || '未填'} · ${parts.title || '未填'}`,
    system: INTERVIEW_PREP_SYSTEM,
    user: buildInterviewPrepUserMessage(parts, profile),
    onDelta,
  })
}

export async function summarizeReflection(text: string): Promise<string> {
  return streamChat({
    task: taskSubject('面试复盘整理', text),
    system: '你是面试复盘助手。把用户零散的面试记录整理成「问到的问题 / 我的回答漏洞 / 下一步补齐动作」三段，输出 Markdown，语言精简，不要客套话。',
    user: buildReflectionUserMessage(text),
  })
}

/** 网申系统常见问答：期望薪资、可实习时长、为什么选择我们 */
export async function generateApplyAnswers(company: string, title: string, jd: string, profile: Profile | null): Promise<string> {
  return streamChat({
    task: taskSubject(`网申答案：${company || '未填'} · ${title || '未填'}`, jd),
    system: `你在帮一名中国大学生填写网申系统的开放题。输出 Markdown，按「期望薪资 / 可到岗与实习时长 / 为什么选择我们 / 自我介绍（200 字内）」四节给出可直接粘贴的答案。
要求：只使用候选人画像中真实存在的事实，不虚构经历；语气平实、口语化，不要排比堆砌；不主动提及任何短板；不出现学校名称以外的无关信息。
${GREETING_RULES}`,
    user: buildApplyUserMessage(company, title, jd, profile),
  })
}

// ---------------------------------------------------------------- 简历分析

export interface ResumeAnalysis {
  summary: string
  education: string[]
  skills: string[]
  projects: string[]
  defense: string[]
  risks: string[]
  suggestions: string[]
}

const RESUME_ANALYSIS_SYSTEM = `你是中国互联网公司的资深技术面试官，正在审阅一份大学生实习/校招简历的纯文本。输出必须诚实、具体、可执行，不夸奖套话，不虚构简历里没有的内容。
只输出一个 JSON 对象，不要输出任何解释文字或 Markdown 代码块，结构如下：
{
  "summary": "综合印象，2-3 句：这份简历过初筛的概率与最强的一张牌",
  "education": ["学历与教育背景逐条点评：学校/专业/届数/排名呈现得怎么样，1-3 条"],
  "skills": ["工程与横向技能逐条点评：技术栈深度、测试/工程化意识、协作工具、表达方式，2-5 条"],
  "projects": ["项目逐个拆解：这个项目证明了什么能力、数字是否经得起追问、写法哪里可以更硬，1-5 条"],
  "defense": ["面试防守关键词：面试官看到这份简历最可能追问什么，每条给出「关键词 + 他会怎么问 + 你要准备的证据」"],
  "risks": ["可能被质疑或扣分的点：表述含糊、口径对不上、常识性错误等，没有就空数组"],
  "suggestions": ["具体优化建议：改哪句话、补哪个数字、删哪段，按优先级排，2-5 条"]
}
规则：
- 所有条目必须引用简历原文里的具体事实（项目名、数字、技术词），不要泛泛而谈。
- 语气中性直接，像给朋友改简历，不做人身评价。
- 简历信息太少时如实说「信息量不足，无法判断 X」，不要硬编。`

function asStringArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .slice(0, max)
}

/** 解析模型输出的简历分析 JSON；字段缺失一律回退为空数组/空串，不让脏输出炸页面 */
export function parseResumeAnalysis(raw: string): ResumeAnalysis {
  let parsed: any = {}
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 模型偶尔会包一层 ```json 代码块或前后缀话，截取第一个 { 到最后一个 } 再试一次
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(raw.slice(start, end + 1))
      } catch {
        parsed = {}
      }
    }
  }
  return {
    summary: String(parsed?.summary ?? '').trim(),
    education: asStringArray(parsed?.education),
    skills: asStringArray(parsed?.skills),
    projects: asStringArray(parsed?.projects),
    defense: asStringArray(parsed?.defense, 10),
    risks: asStringArray(parsed?.risks),
    suggestions: asStringArray(parsed?.suggestions),
  }
}

/**
 * AI 简历分析：输入简历纯文本（附件提取或手动粘贴），产出结构化诊断。
 * 目标岗位可选——给了就把分析往那个方向收紧（如「后端实习」会重点关注服务端深度）。
 * onReasoning 只在思考型模型上有意义：让调用方知道「它在推理、没卡住」。
 */
export async function analyzeResume(
  text: string,
  targetRole?: string | null,
  onDelta?: (t: string) => void,
  onReasoning?: (t: string) => void,
): Promise<ResumeAnalysis> {
  const raw = await streamChat({
    task: taskSubject('简历分析', text),
    system: RESUME_ANALYSIS_SYSTEM,
    user: buildResumeAnalysisUserMessage(text, targetRole),
    json: true,
    onDelta,
    onReasoning,
  })
  return parseResumeAnalysis(raw)
}

export interface ResumeFieldDraft {
  highlights: string
  projects: string
  notes: string
}

/**
 * 上传附件后自动提炼「亮点摘要 / 项目与数字 / 备注」三个表单字段。
 * 与 analyzeResume（面试官诊断）不同：这里只做**简历自身的字段草稿**，让用户保存前改。
 * 只引用原文事实，原文信息不足就给空串——宁可留白也不编。
 */
export async function draftResumeFields(text: string): Promise<ResumeFieldDraft> {
  const raw = await streamChat({
    task: taskSubject('简历字段草稿', text),
    system: `你在把一份简历全文提炼成求职管理系统的三个字段草稿。只输出一个 JSON 对象，不要解释文字或代码块：
{"highlights":"这一版主打的 3 条能力，每条一行，必须引用简历里真实的项目名与数字","projects":"项目与数字：每行一个「项目名：一句话说明 + 关键数字」，全部来自简历原文","notes":"备注：目标方向 / 可实习时间 / 其他值得记住的信息；简历里没有就给空字符串"}
规则：
- 只使用简历原文里真实存在的事实，一个字都不虚构。
- 语言精炼口语，不排比堆砌，不写「精通/熟练掌握」这类空词。
- 原文信息不足的字段就给空字符串，不要硬编。`,
    user: buildFieldDraftUserMessage(text),
    json: true,
  })
  let parsed: any = {}
  try {
    parsed = JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(raw.slice(start, end + 1))
      } catch {
        parsed = {}
      }
    }
  }
  return {
    highlights: String(parsed?.highlights ?? '').trim(),
    projects: String(parsed?.projects ?? '').trim(),
    notes: String(parsed?.notes ?? '').trim(),
  }
}
