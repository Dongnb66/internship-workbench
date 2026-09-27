/**
 * ReAct 循环（AGENT_PLAN 第二步 §3.1）。
 *
 * 模式蒸馏自 smolagents 的 agents.py：循环 + 工具注册表 + 分型记忆 + max_steps，
 * 用 TypeScript 重写，不引框架。四条硬性规则一条都不能少——
 * 智能体自主性越高，幻觉的杀伤面越大：
 *
 * 1. **Observation 只由应用侧填**。模型的回复里如果出现 observation 字段，一律丢弃：
 *    那是它自己编的。真实结果必须由我们真的执行工具得到。
 * 2. **max_steps 硬上限**，超出走「部分结论」路径并明确说没做完——不假装完成。
 * 3. **每步落审计**（thought/tool/args/observation/error/ms），这是「全程审计日志」的代码依据。
 * 4. **工具失败**把错误文本作为 Observation 回填，让模型自己决定重试还是换路；
 *    同一工具连续失败到上限就停，否则就是一圈一圈烧创建者的额度。
 *
 * 模型调用是**注入**的（`ask`）：本模块因此不打网络、不烧额度，单测可以精确控制每一圈的输出。
 */
import { DEFAULT_QUOTA } from './quota'
import { renderToolCatalog, type AgentContext, type AgentTool } from './agentTools'

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /**
   * 这段内容里含**外部数据**（工具观察结果可能带着从招聘网站抓来的陌生人文本）。
   * 接线层据此决定要不要走 `wrapUntrusted` —— 有比没强：prompt 注入的入口正是这里。
   */
  untrusted?: boolean
}

export interface ActionStep {
  step: number
  thought: string
  tool: string | null
  args: Record<string, unknown> | null
  /** 只由应用侧写入；模型回复里的同名字段会被丢弃 */
  observation: string
  error: string | null
  ms: number
}

export type StopReason = 'final_answer' | 'max_steps' | 'tool_retries_exhausted' | 'model_error' | 'aborted'

export interface AgentResult {
  answer: string
  steps: ActionStep[]
  finished: boolean
  stopReason: StopReason
}

export interface AgentRunOptions {
  task: string
  tools: AgentTool[]
  ctx: AgentContext
  /** 一圈一次模型调用。生产接线传 streamChat 的包装；单测传假模型 */
  ask: (messages: AgentMessage[]) => Promise<string>
  /** 默认与额度护栏的每任务上限相等：循环比闸松等于没有闸 */
  maxSteps?: number
  /** 同一个工具连续失败几次就收手 */
  maxToolRetries?: number
  onStep?: (step: ActionStep) => void
  signal?: AbortSignal
  /** observation 拼进 prompt 的字符上限 */
  observationCap?: number
}

const DEFAULT_OBSERVATION_CAP = 2400

const OUTPUT_CONTRACT = [
  '输出契约：**每轮只输出一个 JSON 对象**，不要解释、不要代码块，二选一：',
  '{"thought":"我现在为什么做这一步","tool":"工具名","args":{参数}}',
  '{"thought":"我已经能回答了","final_answer":"给用户的中文结论"}',
  '规则：',
  '- 想调工具就只给 tool+args；**不要自己写 observation**，观察结果由系统回填给你。',
  '- 只能使用上面列出的工具名；参数按各工具的说明给。',
  '- 结论必须落在工具真的返回过的数据上；数据不足就直说哪里不足，不要编。',
  '- 工具返回里带 truncated/hidden 时，说明清单被裁过，别把「前 N 条」当成全部。',
].join('\n')

/** 系统提示：角色 + 今天 + 工具目录 + 输出契约。目录每圈都带上，所以越短越省钱。 */
export function buildSystemPrompt(tools: AgentTool[], today: string): string {
  return [
    `你是「实习管理工作台」的求职智能体。用户是一名在中国找实习/校招的学生，你要基于工具查到的**真实数据**给他可执行的行动建议。`,
    `今天：${today}`,
    '可用工具：',
    renderToolCatalog(tools),
    OUTPUT_CONTRACT,
  ].join('\n\n')
}

/** 容错解析：模型偶尔会包 ```json 或在前后加话 */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = String(raw ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s)
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  const direct = tryParse(text)
  if (direct) return direct
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) return tryParse(text.slice(start, end + 1))
  return null
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

/** observation 的文本形态：JSON 化 + 截断，并**如实说明截断了**（模型得知道看到的是部分） */
function toObservation(value: unknown, cap: number): string {
  let text: string
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  if (text.length <= cap) return text
  return `${text.slice(0, cap)}…（已截断，原文 ${text.length} 字）`
}

function partialAnswer(steps: ActionStep[], reason: string): string {
  const done = steps.filter((s) => s.tool).map((s) => `${s.tool}：${s.observation.slice(0, 80)}`)
  return [
    `${reason}，以下是已经查到的部分结论，不是完整分析：`,
    ...done.map((d) => `- ${d}`),
  ].join('\n')
}

export async function runAgent(opts: AgentRunOptions): Promise<AgentResult> {
  const maxSteps = opts.maxSteps ?? DEFAULT_QUOTA.maxCallsPerTask
  const maxToolRetries = opts.maxToolRetries ?? 2
  const cap = opts.observationCap ?? DEFAULT_OBSERVATION_CAP
  const system: AgentMessage = { role: 'system', content: buildSystemPrompt(opts.tools, opts.ctx.today) }

  // 分型记忆：任务 + 每步（模型说的话 / 应用回填的观察）。
  // 发给模型时把 action 与 observation 压成 user/assistant 交替，模型才能读懂「我上次要了什么、拿到了什么」。
  const steps: ActionStep[] = []
  const history: AgentMessage[] = [{ role: 'user', content: `任务：${opts.task}` }]

  const messages = (): AgentMessage[] => [system, ...history]

  let consecutiveFailures = 0
  let lastFailedTool = ''

  for (let i = 1; i <= maxSteps; i += 1) {
    if (opts.signal?.aborted) {
      return { answer: partialAnswer(steps, '已按要求停止'), steps, finished: false, stopReason: 'aborted' }
    }

    const t0 = Date.now()
    let raw = ''
    let modelError: string | null = null
    try {
      raw = await opts.ask(messages())
    } catch (e) {
      // 额度用完 / 网络中断都属于这一类：继续转圈只会重复失败并继续烧额度
      modelError = String((e as Error)?.message ?? e)
    }

    const parsed = modelError ? null : extractJsonObject(raw)
    const thought = parsed ? asString(parsed.thought) : ''
    const step: ActionStep = { step: i, thought, tool: null, args: null, observation: '', error: null, ms: Date.now() - t0 }

    if (modelError) {
      step.error = modelError
      step.observation = `模型调用失败：${modelError}`
      steps.push(step)
      opts.onStep?.(step)
      return { answer: `${modelError}\n（分析中断，以上是已查到的部分）\n${partialAnswer(steps, '')}`, steps, finished: false, stopReason: 'model_error' }
    }

    if (!parsed) {
      // 格式错误不炸循环：把它当成一次观察回填，模型下一圈通常能改回来
      step.error = '上一轮输出不是合法 JSON，无法解析'
      step.observation = '格式错误：请按契约只输出一个 JSON 对象（{"thought","tool","args"} 或 {"thought","final_answer"}）。'
      // 这一条只能回灌原文：解析失败时「它说了什么」正是它需要看到并改正的东西
      history.push({ role: 'assistant', content: raw.slice(0, 2000) }, { role: 'user', untrusted: true, content: `Observation: ${step.observation}` })
      steps.push(step)
      opts.onStep?.(step)
      continue
    }

    const toolName = asString(parsed.tool)
    const finalAnswer = asString(parsed.final_answer)
    /**
     * 告诉模型「你上一轮要干什么」时的**结构化复述**，而不是原样回灌 raw：
     * raw 里可能夹着一个它自己编的 observation，回灌就等于让那句编造以对话历史的身份重新进入上下文。
     */
    const selfEcho = `Thought: ${thought}\nAction: ${toolName || '（无）'}\nArgs: ${JSON.stringify(parsed.args ?? {})}`

    // 同时给了 tool 与 final_answer 时以 tool 为准：还在要数据就先拿数据，结论下一轮再说。
    // 反过来自作主张收尾，等于让它用一轮都没验证过的猜测回答用户。
    if (!toolName && finalAnswer) {
      step.observation = '(结束)'
      steps.push(step)
      opts.onStep?.(step)
      return { answer: finalAnswer, steps, finished: true, stopReason: 'final_answer' }
    }

    if (!toolName) {
      step.error = '回复里既没有 tool 也没有 final_answer'
      step.observation = '无法执行：请给出 tool+args，或给出 final_answer。'
      history.push({ role: 'assistant', content: selfEcho }, { role: 'user', untrusted: true, content: `Observation: ${step.observation}` })
      steps.push(step)
      opts.onStep?.(step)
      continue
    }

    step.tool = toolName
    step.args = parsed.args && typeof parsed.args === 'object' ? (parsed.args as Record<string, unknown>) : {}

    const found = opts.tools.find((t) => t.name === toolName)
    if (!found) {
      const names = opts.tools.map((t) => t.name).join('、') || '（本轮没有可用工具）'
      step.error = `不存在的工具「${toolName}」`
      step.observation = `没有这个工具。可用工具只有：${names}`
      history.push({ role: 'assistant', content: selfEcho }, { role: 'user', untrusted: true, content: `Observation: ${step.observation}` })
      steps.push(step)
      opts.onStep?.(step)
      continue
    }

    let observation: string
    try {
      // Observation 只在这里由**应用侧**写入：parsed.observation（模型编的）从一开始就被忽略，
      // 上面构造 step 时也没有把任何模型字段塞进去。
      observation = toObservation(await found.fn(opts.ctx, step.args ?? {}), cap)
      consecutiveFailures = toolName === lastFailedTool ? consecutiveFailures : 0
      lastFailedTool = ''
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      step.error = msg
      observation = `工具执行失败：${msg}`
      consecutiveFailures = toolName === lastFailedTool ? consecutiveFailures + 1 : 1
      lastFailedTool = toolName
    }

    step.observation = observation
    history.push({ role: 'assistant', content: selfEcho }, { role: 'user', untrusted: true, content: `Observation: ${observation}` })
    steps.push(step)
    opts.onStep?.(step)

    if (consecutiveFailures >= maxToolRetries) {
      return { answer: partialAnswer(steps, `工具「${lastFailedTool}」连续失败 ${consecutiveFailures} 次，已停止重试`), steps, finished: false, stopReason: 'tool_retries_exhausted' }
    }
  }

  return { answer: partialAnswer(steps, `已达单次任务的最大步数（${maxSteps} 步）`), steps, finished: false, stopReason: 'max_steps' }
}
