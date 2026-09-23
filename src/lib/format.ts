export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fmtDate(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fmtDateTime(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return `${fmtDate(value)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 距今天数：正数=还有几天，0=今天，负数=已过 */
export function daysLeft(value?: string | null): number | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date(todayISO())
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

export function leftText(value?: string | null): string {
  const n = daysLeft(value)
  if (n === null) return '—'
  if (n < 0) return `已过 ${Math.abs(n)} 天`
  if (n === 0) return '今天'
  return `剩 ${n} 天`
}

/**
 * 去掉时间部分，供 <input type="date"> 回填。
 *
 * 不能用 `slice(0, 10)`：那截的是 UTC 日期，`2026-10-01T16:00:00.000Z` 在 UTC+8
 * 实际已是 10-02 的 00:00，回填成 10-01 后用户一保存截止日就悄悄提前了一天。
 * 取**本地日历日**，与小程序端 `format.js` 的 dateOnly 同口径（契约测试钉住）。
 */
export function dateOnly(value?: string | null): string {
  if (!value) return todayISO()
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function textToArray(value: string): string[] {
  return value
    .split(/[,，、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 近 n 天的日期序列（含今天） */
export function recentDays(n: number): string[] {
  const out: string[] = []
  const base = new Date(todayISO())
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(base.getTime() - i * 86400000)
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
  }
  return out
}

export function monthLabel(d: Date): string {
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
}

export function monthMatrix(d: Date): string[][] {
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  const start = new Date(first)
  start.setDate(1 - first.getDay())
  const rows: string[][] = []
  for (let w = 0; w < 6; w += 1) {
    const row: string[] = []
    for (let i = 0; i < 7; i += 1) {
      const cur = new Date(start)
      cur.setDate(start.getDate() + w * 7 + i)
      row.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`)
    }
    rows.push(row)
  }
  return rows
}
