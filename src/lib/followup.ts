import { pad, parseDate, todayISO } from './format'
import { FOLLOWUP_WINDOWS } from './timeline'
import type { Row } from '../types'

/**
 * 跟进节奏 —— BENCHMARK P0（career-ops followup-cadence 思路）。
 *
 * 打招呼节奏有（pace.ts 管发送频控），投递之后一直是空白：已读不回几天该催、
 * HR 回复了别晾着，全靠感觉。这里按最后一条沟通的状态给不同跟进窗口——
 * 窗口数值与 timeline.defaultFollowAt 同一份常量（FOLLOWUP_WINDOWS），
 * 算出每条活跃投递的建议跟进日，到期和超期的挑出来给行动建议。
 */

/** rejected 是终态不跟进；offer 同理。 */

const SUGGESTIONS: Record<string, string> = {
  sent: '招呼快 4 天了：补一条带新信息的跟进，或换渠道重投',
  read: '已读不回：补一句新进展再问一次，再没回就先放',
  no_reply: '超时未回：这条先放下，把时间给还热乎的',
  replied: 'HR 回复了别晾着：今天内推进（回答问题 / 约时间）',
  interview: '约面已达成：确认「面试跟进」里登记了时间与轮次',
}

export interface FollowupItem {
  application: Row
  lastStatus: string
  lastAt: string
  dueAt: string
  overdueDays: number
  suggestion: string
}

/**
 * 纯日期串 + n 天（本地日历日）。
 *
 * 踩过的坑（2026-09-28，由 CI 的负偏移时区复跑抓出来）：原先写的是
 * `new Date(iso.slice(0, 10))` —— 纯日期串按 **UTC 零点** 解析，而 `getDate()` /
 * `setDate()` 用的是**本地**口径。在 UTC-4，`'2026-09-20'` 被读成 09-19 20:00，
 * `+4 天` 得到 09-23（应为 09-24），于是每条投递的「该不该催」都提前一天。
 * UTC+8（本机）与 UTC（CI 默认）都恰好正常 —— 这一类只在整个西半球出错。
 */
function plusDays(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const t = new Date(y, m - 1, d + days)
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
}

function diffDays(today: string, due: string): number {
  // 两端都按本地日历日构造（与 format.ts#daysLeft 同一条规则）。
  // 用 round 不用 floor：跨夏令时的那一天是 23 或 25 小时，floor 会把 23 小时算成 0 天。
  const a = parseDate(today.slice(0, 10)).getTime()
  const b = parseDate(due.slice(0, 10)).getTime()
  return Math.round((a - b) / 86400000)
}

export function followupDue(applications: Row[], messages: Row[], today: string = todayISO()): FollowupItem[] {
  const out: FollowupItem[] = []
  for (const app of applications) {
    if (['rejected', 'offer'].includes(String(app.stage))) continue
    const related = messages
      .filter((m) => Number(m.application_id) === Number(app.id))
      .sort((a, b) => String(b.sent_at ?? b.created_at ?? '').localeCompare(String(a.sent_at ?? a.created_at ?? '')))
    const last = related[0]
    let lastStatus: string
    let lastAt: string
    if (last) {
      lastStatus = String(last.reply_status ?? 'sent')
      lastAt = String(last.sent_at ?? last.created_at ?? '').slice(0, 10)
    } else {
      lastStatus = 'none'
      lastAt = String(app.applied_at ?? app.created_at ?? '').slice(0, 10)
    }
    if (!lastAt) continue
    const window = lastStatus === 'none' ? 2 : (FOLLOWUP_WINDOWS[lastStatus] ?? 1)
    const dueAt = plusDays(lastAt, window)
    const overdueDays = diffDays(today, dueAt)
    if (overdueDays < 0) continue
    const suggestion =
      lastStatus === 'none'
        ? '投出去还没打招呼：招呼不发出去，这条投递就是死的'
        : SUGGESTIONS[lastStatus] ?? '查看最后一条沟通，决定跟进还是放下'
    out.push({ application: app, lastStatus, lastAt, dueAt, overdueDays, suggestion })
  }
  return out.sort((a, b) => b.overdueDays - a.overdueDays)
}
