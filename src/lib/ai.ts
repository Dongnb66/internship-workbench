import { cloud } from '../cloud'
import { DIMS, GREETING_RULES } from './constants'
import type { Profile } from '../types'

/**
 * 用户自选模型的 localStorage 键。
 *
 * 为什么放 localStorage 而不是 profile 表：这是**设备级偏好**（同一账号在不同
 * 设备上可能想用不同模型），而且模型目录是平台级的、跟账号数据无关。
 */
const MODEL_CHOICE_KEY = 'wb_model_choice'

let cachedModel: string | null = null
let cachedModels: Array<{ id: string; name: string; provider?: string }> | null = null

export interface UsableModel {
  id: string
  name: string
  provider?: string
}

/** 可选模型目录（供设置页下拉框用）。列表进程内缓存，选模型后手动刷新即可。 */
export async function listUsableModels(): Promise<UsableModel[]> {
  if (cachedModels) return cachedModels
  const models = await cloud.llm.models.list()
  cachedModels = (models ?? [])
    .filter((m: any) => m?.disabled !== true && m?.enabled !== false)
    .map((m: any) => ({ id: String(m.id), name: String(m.name || m.id), provider: m.provider ? String(m.provider) : undefined }))
  return cachedModels
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
  cachedModel = null
}

/**
 * 决定本次调用用哪个模型：
 * 1. 用户在设置页选过的模型，且它仍在可用目录里 → 用它；
 * 2. 否则回退到目录第一个可用模型（旧行为，保证永远有模型可调）。
 * 所选模型被平台下架/禁用时不报错，静默回退——评估失败比换模型更糟。
 */
export async function pickModel(): Promise<string | null> {
  if (cachedModel) return cachedModel
  const models = await listUsableModels()
  if (!models.length) return null
  const choice = getModelChoice()
  const chosen = choice ? models.find((m) => m.id === choice) : null
  cachedModel = (chosen ?? models[0]).id
  return cachedModel
}

export interface StreamOptions {
  system: string
  user: string
  json?: boolean
  signal?: AbortSignal
  onDelta?: (text: string) => void
}

/** 唯一的模型调用入口：只支持流式，逐帧累积文本 */
export async function streamChat(opts: StreamOptions): Promise<string> {
  const model = await pickModel()
  if (!model) throw new Error('当前没有可用模型，请稍后重试')

  let text = ''
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
    if (delta?.content) {
      text += delta.content
      opts.onDelta?.(delta.content)
    }
  }
  return text
}

function profileBrief(profile: Profile | null): string {
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
    system: EVAL_SYSTEM,
    user: `【候选人画像】\n${profileBrief(profile)}\n\n【目标岗位 JD】\n${jd.slice(0, 8000)}`,
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
    system: `你在帮一名中国大学生写发给 HR / 技术负责人 的第一条打招呼消息。输出只有消息正文本身，不要标题、不要解释、不要引号包裹。
${GREETING_RULES}`,
    user: `【候选人画像】\n${profileBrief(profile)}\n\n【公司与岗位】${company} · ${title}\n\n【JD 原文】\n${jd.slice(0, 6000)}`,
    onDelta,
  })
}

export async function generateInterviewQuestions(company: string, title: string, jd: string, profile: Profile | null): Promise<string> {
  return streamChat({
    system: `你是技术面试教练。基于 JD 与候选人的真实项目，输出 6-8 个高概率被问到的面试题，每题下面用 2-3 行给出「他怎么答」的框架（必须引用他自己仓库里的真实设计与数字，不得编造）。输出 Markdown。`,
    user: `【候选人】\n${profileBrief(profile)}\n\n【岗位】${company} · ${title}\n\n【JD】\n${jd.slice(0, 6000)}`,
  })
}

export async function summarizeReflection(text: string): Promise<string> {
  return streamChat({
    system: '你是面试复盘助手。把用户零散的面试记录整理成「问到的问题 / 我的回答漏洞 / 下一步补齐动作」三段，输出 Markdown，语言精简，不要客套话。',
    user: text.slice(0, 6000),
  })
}

/** 网申系统常见问答：期望薪资、可实习时长、为什么选择我们 */
export async function generateApplyAnswers(company: string, title: string, jd: string, profile: Profile | null): Promise<string> {
  return streamChat({
    system: `你在帮一名中国大学生填写网申系统的开放题。输出 Markdown，按「期望薪资 / 可到岗与实习时长 / 为什么选择我们 / 自我介绍（200 字内）」四节给出可直接粘贴的答案。
要求：只使用候选人画像中真实存在的事实，不虚构经历；语气平实、口语化，不要排比堆砌；不主动提及任何短板；不出现学校名称以外的无关信息。
${GREETING_RULES}`,
    user: `【候选人画像】\n${profileBrief(profile)}\n\n【公司岗位】${company || '（未填）'} · ${title || '（未填）'}\n\n【JD】\n${jd.slice(0, 6000) || '（未提供 JD）'}`,
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
 */
export async function analyzeResume(text: string, targetRole?: string | null, onDelta?: (t: string) => void): Promise<ResumeAnalysis> {
  const raw = await streamChat({
    system: RESUME_ANALYSIS_SYSTEM,
    user: `【目标岗位】${targetRole?.trim() || '（未指定，按通用软件研发实习评估）'}\n\n【简历全文】\n${text.slice(0, 12000)}`,
    json: true,
    onDelta,
  })
  return parseResumeAnalysis(raw)
}
