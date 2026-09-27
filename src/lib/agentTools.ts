/**
 * 智能体的工具注册表（AGENT_PLAN 第二步 §3.2）。
 *
 * 这里**不重写任何算法**：每个 `fn` 都是 `src/lib/` 里那个已带单测的纯函数的一次调用。
 * 理由很实际——巡检给出的结论必须和页面上显示的数字一致，两边各算一遍迟早会对不上，
 * 而对不上的症状是「智能体说还有 3 条待跟进，页面上是 5 条」，用户无从判断哪个是真的。
 *
 * 三条刻意的约束：
 * 1. `description` 是给**模型**看的选择器（模型靠它决定调哪个工具），必须写清「什么时候该用我」。
 * 2. `implementedIn` 把工具钉回真实源文件，`agentTools.test.mjs` 会读那个文件确认同名导出还在——
 *    注册表指向一个已被改名的函数时，症状是工具永远返回空气，只有这种检查能发现。
 * 3. 返回值一律**裁剪**：observation 要拼进下一圈的 prompt，不裁就是每圈多烧几千 token，
 *    而额度记在创建者账号上。裁掉多少必须如实标出来（`truncated` / `hidden`），
 *    不能让智能体把「前 20 条」当成全部去下结论。
 */
import type { Profile, Row } from '../types'
import { todayPicks } from './daily'
import { calibration, funnelStats } from './funnel'
import { followupDue } from './followup'
import { keywordCoverage } from './keywordCoverage'
import { interviewFactGate } from './factGate'
import { DEFAULT_PACE, paceStatus, staleApplications } from './pace'

/** 智能体可见的数据面。由调用处（Overview 页）把已加载的行喂进来，工具自己**不查库**。 */
export interface AgentContext {
  jobs: Row[]
  applications: Row[]
  messages: Row[]
  interviews: Row[]
  offers: Row[]
  resumes: Row[]
  profile: Profile | null
  /** 日历日 YYYY-MM-DD，与 todayISO() 同口径 */
  today: string
  /** pace 类判断需要「现在几点」 */
  now: Date
}

export function emptyContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    jobs: [],
    applications: [],
    messages: [],
    interviews: [],
    offers: [],
    resumes: [],
    profile: null,
    today: '2026-01-01',
    now: new Date('2026-01-01T12:00:00'),
    ...overrides,
  }
}

export interface AgentTool {
  name: string
  /** 给模型看的用途说明，包含「什么时候该用我」 */
  description: string
  /** 给模型看的参数说明（v1 用文本而不是 JSON Schema：模型只需知道参数名与含义） */
  schema: string
  /** 算法真正住在哪个模块（不带 .ts），断言据此确认同名导出仍存在 */
  implementedIn: string
  fn: (ctx: AgentContext, args: Record<string, unknown>) => unknown
}

/** 单条 observation 的条目上限：20 条足够模型看出趋势，再多就是 token 与注意力浪费 */
const LIST_CAP = 20

interface Capped<T> {
  items: T[]
  total: number
  hidden: number
  truncated: boolean
}

function capped<T>(list: T[], cap = LIST_CAP): Capped<T> {
  return {
    items: list.slice(0, cap),
    total: list.length,
    hidden: Math.max(0, list.length - cap),
    truncated: list.length > cap,
  }
}

/** 岗位/投递行里塞着 jd_text 全文，直接回给模型等于把几万字喂进 prompt */
function slimApp(row: Row): Record<string, unknown> {
  return {
    id: row.id,
    company: row.company ?? '',
    title: row.title ?? '',
    stage: row.stage ?? '',
    applied_at: String(row.applied_at ?? row.created_at ?? '').slice(0, 10),
  }
}

function argString(args: Record<string, unknown>, key: string): string {
  const v = args?.[key]
  return typeof v === 'string' ? v.trim() : ''
}

function argNumber(args: Record<string, unknown>, key: string): number | null {
  const v = args?.[key]
  const n = Number(v)
  return v === undefined || v === null || v === '' ? null : Number.isFinite(n) ? n : null
}

/** 简历全文：优先取 args 指定的，其次取最新一份带纯文本的简历，最后退到画像摘要 */
function resumeTextFor(ctx: AgentContext, args: Record<string, unknown>): string {
  const direct = argString(args, 'resume_text')
  if (direct) return direct
  const withText = [...ctx.resumes]
    .filter((r) => String(r.content_text ?? '').trim())
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
  if (withText.length) return String(withText[0].content_text)
  return String(ctx.profile?.resume_summary ?? '')
}

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'followupDue',
    description: '查按状态到期的跟进清单。当你想知道「哪些投出去的岗位该跟进了、分别该做什么」时用我。',
    schema: '无参数。返回到期项：公司/岗位/最后状态/到期日/逾期天数/建议动作。',
    implementedIn: 'followup',
    fn: (ctx) => {
      const list = followupDue(ctx.applications, ctx.messages, ctx.today).map((i) => ({
        ...slimApp(i.application),
        last_status: i.lastStatus,
        due_at: i.dueAt,
        overdue_days: i.overdueDays,
        suggestion: i.suggestion,
      }))
      return { ...capped(list), today: ctx.today }
    },
  },
  {
    name: 'staleApplications',
    description: '查「投出去但已经很多天没动静」的投递。当你怀疑有投递被晾着、需要定一个天数线时用我。',
    schema: 'days: 整数，可选，默认 7。返回每项的最后动静日期与距今天数。',
    implementedIn: 'pace',
    fn: (ctx, args) => {
      const days = argNumber(args, 'days') ?? 7
      const list = staleApplications(ctx.applications, ctx.messages, days, ctx.today).map((i) => ({
        ...slimApp(i.application),
        last_at: i.lastAt,
        stale_days: i.days,
      }))
      return { days_threshold: days, ...capped(list) }
    },
  },
  {
    name: 'funnelStats',
    description: '查投递漏斗四层（投递→回复→面试→Offer）的转化率。当用户想看整体进展、或判断哪一层掉得最多时用我。',
    schema: '无参数。返回各层数量与相邻层转化率。',
    implementedIn: 'funnel',
    fn: (ctx) => funnelStats(ctx.applications, ctx.messages, ctx.interviews, ctx.offers),
  },
  {
    name: 'calibration',
    description: '查 AI 评分准不准：被拒岗位的当时均分 vs 一路推进岗位的均分。当用户质疑「评分是不是虚高」时用我。',
    schema: '无参数。返回两组均分、样本数与差值。',
    implementedIn: 'funnel',
    fn: (ctx) => calibration(ctx.applications, ctx.jobs),
  },
  {
    name: 'todayPicks',
    description: '查今天最该投的岗位Top N（按匹配分、截止日期、优先级综合排）。当用户问「今天投什么」时用我。',
    schema: 'limit: 整数，可选，默认 3。返回岗位摘要与入选理由。',
    implementedIn: 'daily',
    fn: (ctx, args) => {
      const limit = argNumber(args, 'limit') ?? 3
      const picks = todayPicks(ctx.jobs, ctx.applications, ctx.profile, limit, ctx.today)
      return {
        items: picks.map((p) => ({
          id: p.job?.id,
          company: p.job?.company ?? '',
          title: p.job?.title ?? '',
          score: p.job?.match_score ?? null,
          deadline: String(p.job?.deadline ?? '').slice(0, 10),
          reason: p.reason,
        })),
        total: picks.length,
      }
    },
  },
  {
    name: 'paceStatus',
    description: '查今天的投递节奏：已发多少条招呼、还剩多少额度、是否在发送时间窗、距上次发送多久。当用户想继续发招呼时用我。',
    schema: '无参数。返回 sentToday/limit/remaining/inWindowNow/minutesSinceLast/allowed/reasons。',
    implementedIn: 'pace',
    fn: (ctx) => {
      const status = paceStatus(ctx.messages, DEFAULT_PACE, ctx.now)
      return { ...status, window: DEFAULT_PACE.window, min_interval_min: DEFAULT_PACE.minIntervalMin }
    },
  },
  {
    name: 'keywordCoverage',
    description: '比对一段 JD 的技术词与简历覆盖情况，给出缺失项。当用户粘了一段 JD 并问「我够格投吗」时用我。',
    schema: 'jd: 字符串，必填，JD 原文。resume_text: 可选，指定用哪份简历文本。',
    implementedIn: 'keywordCoverage',
    fn: (ctx, args) => {
      const jd = argString(args, 'jd')
      if (!jd) return { error: '缺少参数 jd（JD 原文）。请把要评估的那段 JD 放进 args.jd 再调一次。' }
      const resumeText = resumeTextFor(ctx, args)
      if (!resumeText) return { error: '没有可用的简历文本：resumes 表里没有正文，画像里也没有项目与事实摘要。' }
      const r = keywordCoverage(jd, resumeText)
      return {
        ...r,
        matched: (r.matched ?? []).slice(0, LIST_CAP),
        missing: (r.missing ?? []).slice(0, LIST_CAP),
        resume_chars: resumeText.length,
      }
    },
  },
  {
    name: 'interviewFactGate',
    description: '体检面试记录里的数字口径是否与简历一致（测试数/项目数这类）。当用户即将面试、或你担心说出来的数字会对不上时用我。',
    schema: '无参数。返回命中的口径问题清单（含严重级别与原句）。',
    implementedIn: 'factGate',
    fn: (ctx) => {
      // interviewFactGate 本身只返回违规项（空数组 = 全部对得上），所以这里不用再过滤
      const items = interviewFactGate(ctx.interviews, ctx.profile).map((i) => ({
        label: i.label,
        fix: i.fix ?? '',
        quote: i.quote,
        interview_id: i.interviewId,
      }))
      return { ...capped(items), checked: items.length }
    },
  },
]

/** 拼成给模型的工具说明段（每一圈都要带上，所以越短越省钱） */
export function renderToolCatalog(tools: AgentTool[] = AGENT_TOOLS): string {
  return tools.map((t) => `- ${t.name}：${t.description}\n  参数：${t.schema}`).join('\n')
}
