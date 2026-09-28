import { parseDate } from './format'
import { localScore } from './score'
import type { Profile, Row } from '../types'

/**
 * 「今日优先投递清单」的纯逻辑层（学牛客求职 Skill 的设计）。
 *
 * 回答的问题不是「有哪些岗位」，而是「**今天先投哪几个，为什么是它们**」。
 * 每条推荐必须带一句匹配依据（可解释）和待确认标记（诚实告诉用户哪里还没核实），
 * 不假装 AI 全知 —— 这两点是这套设计里最值得抄的东西。
 *
 * 刻意只放纯函数：排序一旦写错，症状是「每天推同一个」或「把已投的再推一遍」，
 * 都不会报错，只能靠单测钉住。
 */

export type Urgency = 'overdue' | 'today' | 'soon' | 'none'

export interface DailyPick {
  job: Row
  /** 库里存的匹配分（可能为 null —— 没评过） */
  score: number | null
  /** 本次实时算的本地分（可解释：命中了哪些关键词） */
  local: ReturnType<typeof localScore>
  urgency: Urgency
  days: number | null
  /** 一句匹配依据：来自本地分命中的关键词，不编造 */
  reason: string
  /** 待确认标记：数据缺失或需要人工核实的地方 */
  confirm: string[]
}

const PRIORITY_RANK: Record<string, number> = { 高: 2, 中: 1, 低: 0 }

function urgencyRank(u: Urgency): number {
  return u === 'overdue' ? 0 : u === 'today' ? 1 : u === 'soon' ? 2 : 3
}

/**
 * 截止日距今几天（按本地日历日）。**解析规则取自 `format.ts#parseDate`**，
 * 也就是与列表页、小程序端同一条 —— 独立实现是为了能注入 today 做确定性测试，
 * 但规则不能有第二份：原先这里 `slice(0, 10)` 取的是时间戳的 **UTC** 日期部分，
 * 于是 `2026-09-25T16:00:00.000Z`（UTC+8 已是 09-26）在「今日优先」页算 2 天、
 * 在岗位池列表算 3 天，同一份数据两处紧急度不一样，谁都不报错。
 */
export function daysFrom(today: string, value: unknown): number | null {
  const s = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null
  const d = parseDate(s)
  if (Number.isNaN(d.getTime())) return null
  const [y2, m2, d2] = today.slice(0, 10).split('-').map(Number)
  if ([y2, m2, d2].some((n) => !Number.isFinite(n))) return null
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const b = new Date(y2, m2 - 1, d2).getTime()
  return Math.round((a - b) / 86400000)
}

/** 汇总一条岗位的待确认项：只列事实缺失，不做主观判断 */
function confirmMarks(job: Row): string[] {
  const marks: string[] = []
  if (!job.deadline) marks.push('未填截止日')
  if (!String(job.jd_text ?? '').trim()) marks.push('无 JD 原文，分数仅供参考')
  if (!String(job.url ?? '').trim()) marks.push('未录投递链接')
  return marks
}

/**
 * 今日优先投递清单。
 *
 * 入选条件：岗位池中、还没投（applications 里没有这个 job_id）。
 * 排序：截止紧急度 → 优先级 → 匹配分。同分内 id 小的在前（先录先投，结果稳定可测）。
 */
export function todayPicks(jobs: Row[], apps: Row[], profile: Profile | null, limit = 3, today = todayISO2()): DailyPick[] {
  const appliedJobIds = new Set(apps.map((a) => a.job_id).filter((v) => v !== null && v !== undefined))
  const pool = jobs.filter((j) => (j.status ?? 'pool') === 'pool' && !appliedJobIds.has(j.id))

  const picks = pool.map((job) => {
    const local = localScore(String(job.jd_text ?? ''), String(job.title ?? ''), profile)
    const d = daysFrom(today, job.deadline)
    const urgency: Urgency = d === null ? 'none' : d < 0 ? 'overdue' : d === 0 ? 'today' : d <= 3 ? 'soon' : 'none'
    return { job, local, urgency, days: d }
  })

  picks.sort((a, b) => {
    const u = urgencyRank(a.urgency) - urgencyRank(b.urgency)
    if (u !== 0) return u
    // rank 大 = 优先级高，要排前面，所以是降序
    const p = (PRIORITY_RANK[String(b.job.priority ?? '')] ?? 1) - (PRIORITY_RANK[String(a.job.priority ?? '')] ?? 1)
    if (p !== 0) return p
    const sa = a.job.match_score === null || a.job.match_score === undefined ? a.local.score : Number(a.job.match_score)
    const sb = b.job.match_score === null || b.job.match_score === undefined ? b.local.score : Number(b.job.match_score)
    if (sb !== sa) return sb - sa
    return Number(a.job.id) - Number(b.job.id)
  })

  return picks.slice(0, limit).map(({ job, local, urgency, days }) => {
    const hits = local.hits.filter((h) => h !== '工作城市符合期望')
    const cityHit = local.hits.includes('工作城市符合期望')
    const parts: string[] = []
    if (local.score > 40 && hits.length) parts.push(`命中：${hits.slice(0, 3).join('、')}`)
    if (cityHit) parts.push('城市符合期望')
    if (days !== null && days <= 3) parts.push(days < 0 ? `已过截止日 ${Math.abs(days)} 天` : days === 0 ? '今天截止' : `剩 ${days} 天`)
    return {
      job,
      score: job.match_score === null || job.match_score === undefined ? null : Number(job.match_score),
      local,
      urgency,
      days,
      reason: parts.length ? parts.join(' · ') : 'JD 关键词与画像重合少，投前先核 JD',
      confirm: confirmMarks(job),
    }
  })
}

/** 供默认参数用；实现与 format.todayISO 一致（本地日期） */
function todayISO2(): string {
  const d = new Date()
  const pad = (n: number) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
