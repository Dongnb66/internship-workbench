import { todayISO } from './format'
import type { Row } from '../types'

export interface PaceConfig {
  dailyLimit: number
  window: string
  minIntervalMin: number
}

export const DEFAULT_PACE: PaceConfig = { dailyLimit: 8, window: '09:00-21:00', minIntervalMin: 30 }

/** 发送前 checklist：投递纪律的可执行版本 */
export const GREET_CHECKLIST = [
  '读一遍，改成我平时说话的样子，不像模板',
  '没有出现学校名称',
  '没有提到自己没做过的技术',
  '技术数字与简历口径一致，能经得起 clone 核对',
  '长度与对方问题的强度匹配，问一句就不要回三段',
  '只放大真实可验证的能力，没有自曝短板',
]

/** "09:00-21:00" → [540, 1260]（距零点分钟数） */
export function parseWindow(value: string): [number, number] {
  const match = /^(\d{1,2}):(\d{2})\s*[-~—]\s*(\d{1,2}):(\d{2})$/.exec((value ?? '').trim())
  if (!match) return [9 * 60, 21 * 60]
  const start = Number(match[1]) * 60 + Number(match[2])
  const end = Number(match[3]) * 60 + Number(match[4])
  return [start, end]
}

export function inWindow(now: Date, value: string): boolean {
  const [start, end] = parseWindow(value)
  const minutes = now.getHours() * 60 + now.getMinutes()
  return minutes >= start && minutes <= end
}

export function isToday(iso: string | null | undefined, today: string): boolean {
  return Boolean(iso) && String(iso).slice(0, 10) === today
}

/** 我发出的打招呼（direction=out）按天统计 */
export function outgoing(messages: Row[]): Row[] {
  return messages.filter((m) => (m.direction ?? 'out') === 'out')
}

export interface PaceStatus {
  sentToday: number
  limit: number
  remaining: number
  inWindowNow: boolean
  minutesSinceLast: number | null
  allowed: boolean
  reasons: string[]
}

export function paceStatus(messages: Row[], config: PaceConfig, now: Date = new Date()): PaceStatus {
  const today = todayISO()
  const outs = outgoing(messages)
  const sentToday = outs.filter((m) => isToday(m.sent_at ?? m.created_at, today)).length

  const sorted = [...outs].sort((a, b) => String(b.sent_at ?? b.created_at ?? '').localeCompare(String(a.sent_at ?? a.created_at ?? '')))
  const last = sorted[0]
  const lastAt = last ? new Date(String(last.sent_at ?? last.created_at)) : null
  const minutesSinceLast = lastAt && !Number.isNaN(lastAt.getTime()) ? Math.floor((now.getTime() - lastAt.getTime()) / 60000) : null

  const inWindowNow = inWindow(now, config.window)
  const reasons: string[] = []
  if (sentToday >= config.dailyLimit) reasons.push(`今日已达上限 ${config.dailyLimit} 条`)
  if (!inWindowNow) reasons.push(`不在发送时间窗 ${config.window} 内`)
  if (minutesSinceLast !== null && minutesSinceLast < config.minIntervalMin) {
    reasons.push(`距上次发送仅 ${minutesSinceLast} 分钟，冷却 ${config.minIntervalMin} 分钟`)
  }

  return {
    sentToday,
    limit: config.dailyLimit,
    remaining: Math.max(0, config.dailyLimit - sentToday),
    inWindowNow,
    minutesSinceLast,
    allowed: reasons.length === 0,
    reasons,
  }
}

export interface StaleItem {
  application: Row
  lastAt: string | null
  days: number
}

/** 已投递但超过 days 天没有新沟通的岗位，提醒跟进 */
export function staleApplications(applications: Row[], messages: Row[], days = 7, today: string = todayISO()): StaleItem[] {
  const base = new Date(today).getTime()
  const out: StaleItem[] = []
  for (const app of applications) {
    if (app.stage === 'offer' || app.stage === 'rejected') continue
    const related = messages.filter((m) => Number(m.application_id) === Number(app.id))
    const times = [
      ...related.map((m) => String(m.replied_at ?? m.sent_at ?? m.created_at ?? '')),
      String(app.applied_at ?? app.created_at ?? ''),
    ].filter(Boolean)
    const lastAt = times.sort().at(-1) ?? null
    if (!lastAt) continue
    const diff = Math.floor((base - new Date(String(lastAt).slice(0, 10)).getTime()) / 86400000)
    if (diff >= days) out.push({ application: app, lastAt: String(lastAt).slice(0, 10), days: diff })
  }
  return out.sort((a, b) => b.days - a.days)
}

export const REPLY_STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  sent: { text: '已发送', cls: 'badge info' },
  read: { text: '对方已读', cls: 'badge' },
  replied: { text: '已回复', cls: 'badge warn' },
  interview: { text: '已约面', cls: 'badge ok' },
  rejected: { text: '已婉拒', cls: 'badge danger' },
  no_reply: { text: '未回复', cls: 'badge' },
}

/** 沟通过后建议推进到的投递阶段 */
export function stageForStatus(status: string, current: string): string {
  if (status === 'interview') return 'interview'
  if (status === 'rejected') return 'rejected'
  if (status === 'replied' && current === 'applied') return 'written'
  return current
}
