import { pad } from './format'
import type { Row } from '../types'

/**
 * 沟通台账的纯逻辑部分：不碰网络、不碰 SDK，便于单测。
 * 真正的写库与阶段联动在 conversation.ts。
 */

export interface QuickAction {
  status: string
  label: string
  direction: 'out' | 'in'
  hint: string
}

/** 会话抽屉里的快捷记录：一次点击 = 一条流水 + 可能的阶段推进 */
export const QUICK_ACTIONS: QuickAction[] = [
  { status: 'sent', label: '已发打招呼', direction: 'out', hint: '复制话术发出去后登记，用于节奏统计' },
  { status: 'read', label: '对方已读', direction: 'out', hint: '平台显示已读但没有回复' },
  { status: 'replied', label: 'HR 回复了', direction: 'in', hint: '对方回了消息，进入沟通阶段' },
  { status: 'interview', label: '约到面试/笔试', direction: 'in', hint: '阶段自动推进为「面试」' },
  { status: 'rejected', label: '被婉拒', direction: 'in', hint: '阶段自动推进为「已挂」' },
  { status: 'no_reply', label: '超时未回', direction: 'in', hint: '过了跟进窗口仍无动静，考虑换渠道' },
]

function plusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 各状态的跟进窗口（天）：与 followup.ts 共用这一份，两处口径永不漂移 */
export const FOLLOWUP_WINDOWS: Record<string, number> = {
  sent: 4,
  read: 2,
  no_reply: 2,
  replied: 1,
  interview: 1,
}

/** 不同状态给不同跟进节奏：招呼后 4 天、已读/超时未回 2 天、其余 1 天 */
export function defaultFollowAt(status: string): string {
  return plusDays(FOLLOWUP_WINDOWS[status] ?? 1)
}

/** 某个投递的全部沟通，按时间升序 */
export function timelineFor(messages: Row[], applicationId: number): Row[] {
  return messages
    .filter((m) => Number(m.application_id) === Number(applicationId))
    .sort((a, b) => String(a.sent_at ?? a.created_at ?? '').localeCompare(String(b.sent_at ?? b.created_at ?? '')))
}

/** 每个投递的最后一次沟通，用于看板卡片上显示「最近沟通」 */
export function lastContactByApplication(messages: Row[]): Record<string, Row> {
  const out: Record<string, Row> = {}
  for (const m of messages) {
    const key = String(m.application_id ?? '')
    if (!key || key === 'null') continue
    const prev = out[key]
    const cur = String(m.sent_at ?? m.created_at ?? '')
    if (!prev || cur >= String(prev.sent_at ?? prev.created_at ?? '')) out[key] = m
  }
  return out
}

/**
 * 投递 → 原岗位链接：沿 job_id 到岗位池取 url。
 * 没挂 job_id、岗位不在池里、url 没存的投递都不出现在映射里——
 * UI 据此显示「去岗位池补链接」的提示，而不是渲染一个空链接。
 */
export function jobUrlByApplication(applications: Row[], jobs: Row[]): Map<number, string> {
  const urlByJob = new Map<number, string>()
  for (const j of jobs) {
    const url = String(j.url ?? '').trim()
    if (j.id !== undefined && j.id !== null && url) urlByJob.set(Number(j.id), url)
  }
  const out = new Map<number, string>()
  for (const a of applications) {
    if (a.job_id === undefined || a.job_id === null) continue
    const url = urlByJob.get(Number(a.job_id))
    if (url) out.set(Number(a.id), url)
  }
  return out
}
