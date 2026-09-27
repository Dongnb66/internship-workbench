/**
 * 一家公司在「我的池子 + 投递历史 + 沟通流水」里的全貌（AGENT_PLAN 第三步的对照面）。
 *
 * 单个 JD 永远判断不出值不值得投：同一家公司已挂 6 个岗位、投过 3 条全被拒、
 * 平均匹配分 41，那第 7 个岗位的建议必须带着这些事实。模型自己查不到这种横向对照，
 * 所以做成纯函数，由工具注册表暴露给它。
 *
 * 两条口径容易出错，都在单测里钉着：
 * - **投递记录可能没有 job_id**（早期手工登记的就没有）。只按 job_id 归集会漏掉整段历史，
 *   所以公司名匹配也要算，两个条件取并集。
 * - **没评分的岗位不能当 0 分**。`Number(null)` 是 0，直接平均会把均值拉低到骗人。
 */
import type { Row } from '../types'
import { todayISO } from './format'

export interface CompanyJobBrief {
  id: unknown
  title: string
  status: string
  match_score: number | null
  deadline: string | null
}

export interface CompanyHistory {
  company: string
  poolJobs: CompanyJobBrief[]
  poolTotal: number
  hidden: number
  truncated: boolean
  applied: number
  stages: string[]
  rejected: number
  reachedInterview: number
  scoredCount: number
  unscored: number
  avgScore: number | null
  lastContactAt: string | null
  daysSinceLastContact: number | null
}

/** 结果直接拼进 prompt，条目必须裁 */
const CAP = 20

function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
}

/** 只有真正填了分数才算数：null / 空串 / NaN 都是「没评过」，不是 0 分 */
function scoreOf(row: Row): number | null {
  const raw = row.match_score
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function latestContact(messages: Row[]): string | null {
  const times = messages
    .map((m) => String(m.replied_at ?? m.sent_at ?? m.created_at ?? '').slice(0, 10))
    .filter(Boolean)
    .sort()
  return times.length ? times[times.length - 1] : null
}

export function companyHistory(
  jobs: Row[],
  applications: Row[],
  company: string,
  messages: Row[] = [],
  today: string = todayISO(),
): CompanyHistory {
  const key = norm(company)
  const pool = key ? jobs.filter((j) => norm(j.company) === key) : []
  const poolIds = new Set(pool.map((j) => String(j.id)))
  const apps = key
    ? applications.filter((a) => norm(a.company) === key || poolIds.has(String(a.job_id)))
    : []

  const scores = pool.map(scoreOf)
  const scored = scores.filter((s): s is number => s !== null)

  const appIds = new Set(apps.map((a) => String(a.id)))
  const related = messages.filter((m) => appIds.has(String(m.application_id)))
  const lastContactAt = related.length ? latestContact(related) : null
  const daysSinceLastContact = lastContactAt
    ? Math.floor((new Date(today).getTime() - new Date(lastContactAt).getTime()) / 86400000)
    : null

  // 裁掉的那些按「分数高的先看」，留下的才是有信息量的 20 条
  const ordered = pool
    .map((j, i) => ({
      id: j.id,
      title: String(j.title ?? ''),
      status: String(j.status ?? ''),
      match_score: scores[i],
      deadline: j.deadline ? String(j.deadline).slice(0, 10) : null,
    }))
    .sort((a, b) => (b.match_score ?? -1) - (a.match_score ?? -1))

  return {
    company: String(company ?? '').trim(),
    poolJobs: ordered.slice(0, CAP),
    poolTotal: ordered.length,
    hidden: Math.max(0, ordered.length - CAP),
    truncated: ordered.length > CAP,
    applied: apps.length,
    stages: [...new Set(apps.map((a) => String(a.stage ?? '')).filter(Boolean))],
    rejected: apps.filter((a) => a.stage === 'rejected').length,
    reachedInterview: apps.filter((a) => a.stage === 'interview' || a.stage === 'offer').length,
    scoredCount: scored.length,
    unscored: pool.length - scored.length,
    avgScore: scored.length ? Math.round(scored.reduce((s, n) => s + n, 0) / scored.length) : null,
    lastContactAt,
    daysSinceLastContact,
  }
}
