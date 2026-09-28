import { describe, expect, it } from 'vitest'
import { daysLeft, fmtDate, fmtDateTime, leftText, monthMatrix, num, pad, parseDate, recentDays, textToArray, todayISO } from '../format'

/**
 * 「距今 offset 天的日期串」。
 *
 * 必须走**本地**日历日构造：`new Date(todayISO())` 是 UTC 零点，再 `setDate(+offset)`
 * 用的是本地 getter/setter，在整个西半球会整体退回一天 —— 那样 `daysLeft(iso(0))`
 * 就不是 0 而是 -1，下面整组断言会在非 UTC+8 的时区里静默失真。
 */
function iso(offset: number): string {
  const [y, m, d] = todayISO().split('-').map(Number)
  const t = new Date(y, m - 1, d + offset)
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
}

describe('pad / todayISO', () => {
  it('个位数补零', () => {
    expect(pad(3)).toBe('03')
    expect(pad(12)).toBe('12')
  })

  it('todayISO 返回合法日期格式', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('fmtDate / fmtDateTime', () => {
  it('空值统一返回占位符', () => {
    expect(fmtDate(null)).toBe('—')
    expect(fmtDate('')).toBe('—')
    expect(fmtDateTime(undefined)).toBe('—')
  })

  it('无法解析的值回落到原字符串截断，而不是 Invalid Date', () => {
    expect(fmtDate('2026-09-23')).toBe('2026-09-23')
    expect(fmtDate('不是日期')).toBe('不是日期')
    expect(fmtDateTime('不是日期')).toBe('不是日期')
  })

  it('正常时间戳格式化为 日期 + 时分', () => {
    expect(fmtDateTime('2026-09-23T09:05:00')).toBe('2026-09-23 09:05')
  })
})

describe('daysLeft / leftText', () => {
  it('未来为正、今天为 0、过去为负', () => {
    expect(daysLeft(iso(5))).toBe(5)
    expect(daysLeft(iso(0))).toBe(0)
    expect(daysLeft(iso(-3))).toBe(-3)
  })

  it('空值与非法值返回 null', () => {
    expect(daysLeft(null)).toBeNull()
    expect(daysLeft('')).toBeNull()
    expect(daysLeft('不是日期')).toBeNull()
  })

  it('文案覆盖三种状态', () => {
    expect(leftText(iso(2))).toBe('剩 2 天')
    expect(leftText(iso(0))).toBe('今天')
    expect(leftText(iso(-4))).toBe('已过 4 天')
    expect(leftText(null)).toBe('—')
  })
})

describe('parseDate / 本地日历日口径', () => {
  it('纯日期串按本地零点解析，不经过 UTC', () => {
    const d = parseDate('2026-09-25')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8)
    expect(d.getDate()).toBe(25)
    expect(d.getHours()).toBe(0)
  })

  it('带时区的时间戳保留时区语义（不被当成纯日期串）', () => {
    expect(parseDate('2026-09-25T16:00:00.000Z').getTime()).toBe(Date.parse('2026-09-25T16:00:00.000Z'))
  })

  it('同一瞬时的「剩 N 天」＝其本地日历日的「剩 N 天」', () => {
    // 这条钉的是「不许拿原始瞬时相减再四舍五入」：`2026-09-25T16:00:00Z` 在 UTC+8
    // 已经是 09-26 的 0 点，按瞬时算会比按日历日算少一天（老实现正是如此）。
    // 该断言在 UTC 与西半球有牙，UTC+8 无牙 —— 所以 CI 要换时区复跑，见 ciTrigger.test.mjs。
    for (const instant of ['2026-09-25T16:00:00.000Z', '2026-09-25T00:00:00.000Z', '2027-01-01T12:00:00.000Z']) {
      const t = new Date(instant)
      const localDay = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
      expect(daysLeft(instant), `daysLeft(${instant})`).toBe(daysLeft(localDay))
    }
  })
})

describe('textToArray', () => {
  it('支持中英文逗号、顿号与空白分隔', () => {
    expect(textToArray('Python，React、Node TypeScript')).toEqual(['Python', 'React', 'Node', 'TypeScript'])
  })

  it('去掉空项与首尾空白', () => {
    expect(textToArray('  广州 , , 深圳  ')).toEqual(['广州', '深圳'])
  })

  it('空字符串得到空数组', () => {
    expect(textToArray('')).toEqual([])
    expect(textToArray('  、,  ')).toEqual([])
  })
})

describe('num', () => {
  it('非法输入回落到 0，避免 NaN 传播到界面', () => {
    expect(num('12')).toBe(12)
    expect(num(3.5)).toBe(3.5)
    expect(num('abc')).toBe(0)
    expect(num(null)).toBe(0)
    expect(num(undefined)).toBe(0)
    expect(num(NaN)).toBe(0)
    expect(num(Infinity)).toBe(0)
  })
})

describe('recentDays', () => {
  it('返回含今天在内的连续日期，升序', () => {
    const days = recentDays(7)
    expect(days).toHaveLength(7)
    expect(days[days.length - 1]).toBe(todayISO())
    const sorted = [...days].sort()
    expect(days).toEqual(sorted)
  })

  it('长度为 1 时只返回今天', () => {
    expect(recentDays(1)).toEqual([todayISO()])
  })
})

describe('monthMatrix', () => {
  it('固定 6 行 × 7 列，且包含该月首尾日期', () => {
    const m = monthMatrix(new Date(2026, 8, 1))
    expect(m).toHaveLength(6)
    for (const row of m) expect(row).toHaveLength(7)
    const flat = m.flat()
    expect(flat).toContain('2026-09-01')
    expect(flat).toContain('2026-09-30')
    // 首日所在周会向前补齐，所以网格里会带出相邻月份的日期
    expect(new Set(flat).size).toBe(42)
  })

  it('跨年边界：1 月也能完整覆盖', () => {
    const flat = monthMatrix(new Date(2026, 0, 1)).flat()
    expect(flat).toContain('2026-01-01')
    expect(flat).toContain('2026-01-31')
  })
})
