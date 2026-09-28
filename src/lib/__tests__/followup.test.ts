import { describe, expect, it } from 'vitest'
import type { Row } from '../../types'

/**
 * 跟进节奏 —— BENCHMARK P0（career-ops followup-cadence 思路）。
 *
 * 现状缺口：打招呼节奏有（pace.ts 管发送频控），投递之后没有跟进提醒——
 * 「已读不回几天该催」「HR 回复了别晾着」全靠感觉。这里按状态给不同跟进窗口
 * （招呼 4 天 / 已读·超时 2 天 / 回复·约面 1 天，与 timeline.defaultFollowAt 同源），
 * 算出每条活跃投递的建议跟进日，到期的挑出来给行动建议。
 */

const { followupDue } = await import('../followup')

const TODAY = '2026-09-25'

function app(id: number, stage = 'applied', appliedAt = '2026-09-01'): Row {
  return { id, company: `公司${id}`, title: '岗位', stage, applied_at: appliedAt }
}

function msg(applicationId: number, status: string, sentAt: string): Row {
  return { id: applicationId * 100 + 1, application_id: applicationId, reply_status: status, direction: 'in', sent_at: sentAt }
}

describe('followupDue（按状态的跟进窗口）', () => {
  it('招呼 4 天窗口：发出第 5 天算超期 1 天', () => {
    const items = followupDue([app(1)], [msg(1, 'sent', '2026-09-20T09:00:00')], TODAY)
    expect(items).toHaveLength(1)
    expect(items[0].lastStatus).toBe('sent')
    expect(items[0].overdueDays).toBe(1)
    expect(items[0].suggestion).toContain('跟进')
  })

  it('已读不回窗口 2 天：第 3 天到期；带「补一句新进展」建议', () => {
    const items = followupDue([app(2)], [msg(2, 'read', '2026-09-22T09:00:00')], TODAY)
    expect(items[0].overdueDays).toBe(1)
    expect(items[0].suggestion).toContain('新进展')
  })

  it('HR 昨天刚回：窗口 1 天，今天到期（overdue 0），提醒今天内推进', () => {
    const items = followupDue([app(3)], [msg(3, 'replied', '2026-09-24T18:00:00')], TODAY)
    expect(items).toHaveLength(1)
    expect(items[0].overdueDays).toBe(0)
    expect(items[0].suggestion).toContain('推进')
  })

  it('HR 刚回不到窗口：明天才到期 → 不进今天的清单', () => {
    const items = followupDue([app(9)], [msg(9, 'replied', `${TODAY}T09:00:00`)], TODAY)
    expect(items).toHaveLength(0)
  })

  it('投了但从没打过招呼：2 天窗口，提醒先把招呼发出去', () => {
    const items = followupDue([app(4, 'applied', '2026-09-22')], [], TODAY)
    expect(items[0].overdueDays).toBe(1)
    expect(items[0].suggestion).toContain('招呼')
  })

  it('rejected / offer 是终态，不进跟进清单', () => {
    const items = followupDue(
      [app(5, 'rejected'), app(6, 'offer')],
      [msg(5, 'rejected', '2026-09-01T09:00:00')],
      TODAY,
    )
    expect(items).toHaveLength(0)
  })

  it('到期日按本地日历日推进：UTC 解析 + 本地 getDate 会整体差一天', () => {
    // `'2026-09-20'` 若被 `new Date()` 按 UTC 零点解析，在 UTC-4 本地是 09-19 20:00，
    // `getDate() + 4` 落在 23 号，到期日提前一天（正确值 09-24）。
    // 这条在 UTC+8（本机）与 UTC（CI 默认）都不红 —— 牙长在换时区复跑上。
    const items = followupDue([app(11)], [msg(11, 'sent', '2026-09-20T09:00:00')], '2026-09-24')
    expect(items).toHaveLength(1)
    expect(items[0].dueAt).toBe('2026-09-24')
    expect(items[0].overdueDays).toBe(0)
  })

  it('多条沟通取最后一条的状态与日期；按超期天数降序', () => {
    const items = followupDue(
      [app(7), app(8)],
      [msg(7, 'sent', '2026-09-18T09:00:00'), msg(8, 'no_reply', '2026-09-21T09:00:00')],
      TODAY,
    )
    expect(items).toHaveLength(2)
    expect(items[0].application.id).toBe(7) // 招呼 9-18，窗口 4 天 → 超期 3 天
    expect(items[0].overdueDays).toBe(3)
    expect(items[1].overdueDays).toBe(2)
  })
})
