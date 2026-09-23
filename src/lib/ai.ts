import { cloud } from '../cloud'
import { DIMS, GREETING_RULES } from './constants'
import type { Profile } from '../types'

let cachedModel: string | null = null

export async function pickModel(): Promise<string | null> {
  if (cachedModel) return cachedModel
  const models = await cloud.llm.models.list()
  const usable = (models ?? []).filter((m: any) => m?.disabled !== true && m?.enabled !== false)
  if (!usable.length) return null
  cachedModel = usable[0].id as string
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
