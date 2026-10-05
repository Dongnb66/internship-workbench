export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 解析后端日期 —— **与小程序端 `format.js` 的 `parseDate` 同一条规则**（契约测试钉住）。
 *
 * 纯日期串（`YYYY-MM-DD`）按**本地零点**构造：`new Date('2026-09-25')` 按 ISO 规则会被当成
 * UTC 零点，于是「取本地日历日」的调用方在西半球会整体退回前一天（UTC+8 恰好看不出来）。
 * 其余情况（带 `Z` 或偏移的时间戳）交给 `new Date` 走标准解析，保留时区语义。
 */
export function parseDate(value: string): Date {
  const s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(s)
}

export function fmtDate(value?: string | null): string {
  if (!value) return '—'
  const d = parseDate(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fmtDateTime(value?: string | null): string {
  if (!value) return '—'
  const d = parseDate(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return `${fmtDate(value)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 距今天数：正数=还有几天，0=今天，负数=已过。**按本地日历日**比。
 *
 * 原先拿原始瞬时相减再 `Math.round`：`2026-09-25T16:00:00.000Z` 在 UTC+8 已是 09-26 的 0 点，
 * 却在列表页算成「已过 2 天」、小程序算成「已过 3 天」（UTC 下契约测试直接红）。
 * 而 UTC+8 本地跑又是绿的 —— 8 小时偏移正好把两侧的偏差抵消掉，所以这条只有多时区跑才看得见，
 * CI 因此额外在 `America/New_York` / `Asia/Shanghai` 各跑一遍。
 */
export function daysLeft(value?: string | null): number | null {
  if (!value) return null
  const d = parseDate(value)
  if (Number.isNaN(d.getTime())) return null
  const thatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const today = parseDate(todayISO())
  return Math.round((thatDay.getTime() - today.getTime()) / 86400000)
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
  const d = parseDate(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function textToArray(value: string): string[] {
  return value
    .split(/[,，、;；|]+|\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * 近 n 天的日期序列（含今天）。
 *
 * 用**日历日**加减，不用毫秒加减：`new Date(todayISO())` 是 UTC 零点，配上
 * `- i * 86400000` 在整个西半球会整段偏移一天；跨夏令时还会让某一天重复或跳号
 * （UTC+8 无夏令时，本地测不出来）。
 */
export function recentDays(n: number): string[] {
  const out: string[] = []
  const [y, m, d] = todayISO().split('-').map(Number)
  for (let i = n - 1; i >= 0; i -= 1) {
    const cur = new Date(y, m - 1, d - i)
    out.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`)
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
