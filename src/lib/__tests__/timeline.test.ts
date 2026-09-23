import { describe, expect, it } from 'vitest'
import { defaultFollowAt, lastContactByApplication, QUICK_ACTIONS, timelineFor } from '../timeline'
import type { Row } from '../../types'

const messages: Row[] = [
  { id: 1, application_id: 7, direction: 'out', reply_status: 'sent', sent_at: '2026-09-01T09:10:00' },
  { id: 2, application_id: 7, direction: 'in', reply_status: 'replied', sent_at: '2026-09-03T14:00:00' },
  { id: 3, application_id: 8, direction: 'out', reply_status: 'sent', sent_at: '2026-09-02T09:00:00' },
  { id: 4, application_id: null, direction: 'out', reply_status: 'sent', sent_at: '2026-09-04T09:00:00' },
]

describe('timelineFor', () => {
  it('只返回该投递的沟通，并按时间升序', () => {
    expect(timelineFor(messages, 7).map((m) => m.id)).toEqual([1, 2])
  })

  it('字符串 id 与数字 id 都能匹配', () => {
    const withString: Row[] = [{ id: 1, application_id: '7', sent_at: '2026-09-01T09:00:00' }]
    expect(timelineFor(withString, 7)).toHaveLength(1)
  })

  it('没有沟通记录时返回空数组', () => {
    expect(timelineFor(messages, 999)).toEqual([])
  })
})

describe('lastContactByApplication', () => {
  it('取每个投递的最后一次沟通', () => {
    const map = lastContactByApplication(messages)
    expect(map['7'].id).toBe(2)
    expect(map['8'].id).toBe(3)
  })

  it('忽略没有关联投递的孤立记录', () => {
    expect(Object.keys(lastContactByApplication(messages))).toEqual(['7', '8'])
  })

  it('sent_at 缺失时回落到 created_at', () => {
    const list: Row[] = [
      { id: 1, application_id: 1, created_at: '2026-09-01T09:00:00' },
      { id: 2, application_id: 1, created_at: '2026-09-05T09:00:00' },
    ]
    expect(lastContactByApplication(list)['1'].id).toBe(2)
  })
})

describe('defaultFollowAt', () => {
  const dateRe = /^\d{4}-\d{2}-\d{2}$/

  it('不同状态给出不同跟进节奏，且都是合法日期', () => {
    expect(defaultFollowAt('sent')).toMatch(dateRe)
    expect(defaultFollowAt('read')).toMatch(dateRe)
    expect(defaultFollowAt('no_reply')).toMatch(dateRe)
    expect(defaultFollowAt('interview')).toMatch(dateRe)
  })

  it('招呼后的跟进窗口比约面后更宽松', () => {
    const days = (s: string) => new Date(`${defaultFollowAt(s)}T00:00:00`).getTime()
    expect(days('sent')).toBeGreaterThan(days('read'))
    expect(days('sent')).toBeGreaterThan(days('interview'))
    expect(days('read')).toBeGreaterThan(days('interview'))
  })

  it('跟进日都在未来（不会排到过去）', () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    for (const s of ['sent', 'read', 'no_reply', 'interview', 'rejected']) {
      expect(new Date(`${defaultFollowAt(s)}T00:00:00`).getTime()).toBeGreaterThan(today.getTime())
    }
  })
})

describe('QUICK_ACTIONS', () => {
  it('状态唯一，且方向合法', () => {
    const statuses = QUICK_ACTIONS.map((a) => a.status)
    expect(new Set(statuses).size).toBe(statuses.length)
    for (const a of QUICK_ACTIONS) {
      expect(['out', 'in']).toContain(a.direction)
      expect(a.label.trim().length).toBeGreaterThan(0)
      expect(a.hint.trim().length).toBeGreaterThan(0)
    }
  })

  it('覆盖求职闭环的关键节点', () => {
    const statuses = QUICK_ACTIONS.map((a) => a.status)
    for (const need of ['sent', 'replied', 'interview', 'rejected']) expect(statuses).toContain(need)
  })
})
