import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PACE,
  GREET_CHECKLIST,
  inWindow,
  isToday,
  outgoing,
  paceStatus,
  parseWindow,
  stageForStatus,
  staleApplications,
} from '../pace'
import { pad, todayISO } from '../format'
import type { Row } from '../../types'

/** 相对今天偏移 n 天的 YYYY-MM-DD，避免测试依赖某个固定日期 */
function iso(offset: number): string {
  const d = new Date(todayISO())
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const today = todayISO()

function msg(patch: Row): Row {
  return { direction: 'out', reply_status: 'sent', sent_at: `${today}T09:10:00`, ...patch }
}

describe('parseWindow', () => {
  it('解析标准时间窗', () => {
    expect(parseWindow('09:00-21:00')).toEqual([540, 1260])
  })

  it('支持波浪号与破折号等多种分隔符、单位数小时', () => {
    expect(parseWindow('8:00~9:30')).toEqual([480, 570])
    expect(parseWindow('08:00—18:30')).toEqual([480, 1110])
  })

  it('格式非法时回落到默认 09:00-21:00，不抛错', () => {
    expect(parseWindow('')).toEqual([540, 1260])
    expect(parseWindow('随便写的')).toEqual([540, 1260])
    expect(parseWindow('9点-21点')).toEqual([540, 1260])
  })
})

describe('inWindow', () => {
  it('窗口内为真，窗口外为假', () => {
    expect(inWindow(new Date(`${today}T10:00:00`), '09:00-21:00')).toBe(true)
    expect(inWindow(new Date(`${today}T08:59:00`), '09:00-21:00')).toBe(false)
    expect(inWindow(new Date(`${today}T22:00:00`), '09:00-21:00')).toBe(false)
  })

  it('边界值算在窗口内', () => {
    expect(inWindow(new Date(`${today}T09:00:00`), '09:00-21:00')).toBe(true)
    expect(inWindow(new Date(`${today}T21:00:00`), '09:00-21:00')).toBe(true)
  })
})

describe('isToday / outgoing', () => {
  it('只认当天日期部分', () => {
    expect(isToday(`${today}T23:59:00`, today)).toBe(true)
    expect(isToday(iso(-1), today)).toBe(false)
    expect(isToday(null, today)).toBe(false)
    expect(isToday(undefined, today)).toBe(false)
  })

  it('direction 缺省视为我发出的', () => {
    const list = [msg({ id: 1, direction: undefined }), msg({ id: 2, direction: 'in' }), msg({ id: 3, direction: 'out' })]
    expect(outgoing(list).map((m) => m.id)).toEqual([1, 3])
  })
})

describe('paceStatus', () => {
  const config = { dailyLimit: 8, window: '09:00-21:00', minIntervalMin: 30 }

  it('无记录时可发，剩余等于上限', () => {
    const s = paceStatus([], config, new Date(`${today}T10:00:00`))
    expect(s.sentToday).toBe(0)
    expect(s.remaining).toBe(8)
    expect(s.minutesSinceLast).toBeNull()
    expect(s.allowed).toBe(true)
    expect(s.reasons).toEqual([])
  })

  it('冷却期内不可发，并给出剩余分钟提示', () => {
    const s = paceStatus([msg({ id: 1 })], config, new Date(`${today}T09:20:00`))
    expect(s.sentToday).toBe(1)
    expect(s.minutesSinceLast).toBe(10)
    expect(s.allowed).toBe(false)
    expect(s.reasons.join()).toContain('冷却 30 分钟')
  })

  it('超过冷却期后恢复可发', () => {
    const s = paceStatus([msg({ id: 1 })], config, new Date(`${today}T10:00:00`))
    expect(s.minutesSinceLast).toBe(50)
    expect(s.allowed).toBe(true)
  })

  it('达到每日上限后不可发', () => {
    const list = [msg({ id: 1, sent_at: `${today}T08:00:00` }), msg({ id: 2, sent_at: `${today}T08:30:00` })]
    const s = paceStatus(list, { ...config, dailyLimit: 2 }, new Date(`${today}T12:00:00`))
    expect(s.sentToday).toBe(2)
    expect(s.remaining).toBe(0)
    expect(s.allowed).toBe(false)
    expect(s.reasons.join()).toContain('已达上限 2 条')
  })

  it('不在时间窗内不可发', () => {
    const s = paceStatus([], config, new Date(`${today}T23:00:00`))
    expect(s.inWindowNow).toBe(false)
    expect(s.allowed).toBe(false)
    expect(s.reasons.join()).toContain('不在发送时间窗')
  })

  it('多条不满足原因会全部列出，而不是只报第一条', () => {
    const list: Row[] = Array.from({ length: 8 }, (_, i) => msg({ id: i + 1, sent_at: `${today}T09:05:00` }))
    const s = paceStatus(list, config, new Date(`${today}T09:10:00`))
    expect(s.allowed).toBe(false)
    expect(s.reasons).toHaveLength(2)
  })

  it('对方发来的消息不计入我的发送量', () => {
    const list = [msg({ id: 1, direction: 'in' }), msg({ id: 2, direction: 'in' })]
    const s = paceStatus(list, config, new Date(`${today}T10:00:00`))
    expect(s.sentToday).toBe(0)
    expect(s.allowed).toBe(true)
  })

  it('昨天的发送不计入今天', () => {
    const list = [msg({ id: 1, sent_at: `${iso(-1)}T09:10:00` })]
    const s = paceStatus(list, config, new Date(`${today}T10:00:00`))
    expect(s.sentToday).toBe(0)
  })

  it('默认配置合理：上限为正、时间窗可解析、间隔为正', () => {
    expect(DEFAULT_PACE.dailyLimit).toBeGreaterThan(0)
    expect(DEFAULT_PACE.minIntervalMin).toBeGreaterThan(0)
    const [start, end] = parseWindow(DEFAULT_PACE.window)
    expect(end).toBeGreaterThan(start)
  })

  it('自检清单是 6 条非空文本', () => {
    expect(GREET_CHECKLIST).toHaveLength(6)
    for (const c of GREET_CHECKLIST) expect(c.trim().length).toBeGreaterThan(0)
  })
})

describe('staleApplications', () => {
  it('超过阈值天数没有新进展的投递会被挑出', () => {
    const apps: Row[] = [{ id: 1, stage: 'applied', company: 'A', title: '前端', applied_at: iso(-10) }]
    const result = staleApplications(apps, [], 7, today)
    expect(result).toHaveLength(1)
    expect(result[0].days).toBe(10)
  })

  it('阈值内的投递不算超期', () => {
    const apps: Row[] = [{ id: 1, stage: 'applied', company: 'A', title: '前端', applied_at: iso(-3) }]
    expect(staleApplications(apps, [], 7, today)).toHaveLength(0)
  })

  it('已拿 Offer 或已挂的不再提醒', () => {
    const apps: Row[] = [
      { id: 1, stage: 'offer', applied_at: iso(-30) },
      { id: 2, stage: 'rejected', applied_at: iso(-30) },
    ]
    expect(staleApplications(apps, [], 7, today)).toHaveLength(0)
  })

  it('最近有过沟通时以沟通时间为准，而不是投递时间', () => {
    const apps: Row[] = [{ id: 1, stage: 'applied', company: 'A', applied_at: iso(-30) }]
    const messages: Row[] = [{ id: 9, application_id: 1, direction: 'in', replied_at: `${iso(-2)}T10:00:00` }]
    expect(staleApplications(apps, messages, 7, today)).toHaveLength(0)
  })

  it('结果按超期天数倒序，最该处理的排最前', () => {
    const apps: Row[] = [
      { id: 1, stage: 'applied', company: 'A', applied_at: iso(-8) },
      { id: 2, stage: 'applied', company: 'B', applied_at: iso(-20) },
      { id: 3, stage: 'written', company: 'C', applied_at: iso(-12) },
    ]
    expect(staleApplications(apps, [], 7, today).map((s) => s.days)).toEqual([20, 12, 8])
  })

  it('没有任何时间信息的记录被跳过，不产生 NaN', () => {
    const apps: Row[] = [{ id: 1, stage: 'applied', company: 'A' }]
    expect(staleApplications(apps, [], 7, today)).toHaveLength(0)
  })
})

describe('stageForStatus', () => {
  it('约面推进到面试阶段', () => {
    expect(stageForStatus('interview', 'applied')).toBe('interview')
  })

  it('被婉拒推进到已挂', () => {
    expect(stageForStatus('rejected', 'interview')).toBe('rejected')
  })

  it('HR 回复只把「已投递」推进到「笔试」，不倒退已推进的阶段', () => {
    expect(stageForStatus('replied', 'applied')).toBe('written')
    expect(stageForStatus('replied', 'interview')).toBe('interview')
  })

  it('普通状态不改变阶段', () => {
    expect(stageForStatus('sent', 'applied')).toBe('applied')
    expect(stageForStatus('read', 'applied')).toBe('applied')
    expect(stageForStatus('no_reply', 'written')).toBe('written')
  })
})
