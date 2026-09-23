import { insertRow, updateRow } from './api'
import { stageForStatus } from './pace'
import { defaultFollowAt } from './timeline'
import type { Row } from '../types'

// 纯逻辑（快捷动作定义、跟进节奏、时间线聚合）在 timeline.ts，这里只负责写库与阶段联动
export { QUICK_ACTIONS, defaultFollowAt, timelineFor, lastContactByApplication } from './timeline'
export type { QuickAction } from './timeline'

export interface AddMessageInput {
  application?: Row | null
  company: string
  title?: string | null
  status: string
  direction: 'out' | 'in'
  channel?: string | null
  content?: string | null
  notes?: string | null
  followAt?: string | null
}

/** 写入一条沟通流水；若状态意味着阶段变化，同步推进投递记录的阶段与下一步动作 */
export async function addMessage(input: AddMessageInput): Promise<Row> {
  const row = await insertRow('messages', {
    application_id: input.application?.id ?? null,
    company: input.company,
    title: input.title ?? null,
    direction: input.direction,
    channel: input.channel ?? input.application?.channel ?? null,
    content: input.content ?? null,
    reply_status: input.status,
    replied_at: input.direction === 'in' ? new Date().toISOString() : null,
    next_follow_at: input.followAt ?? defaultFollowAt(input.status),
    notes: input.notes ?? null,
  })

  const app = input.application
  if (app) {
    const nextStage = stageForStatus(input.status, String(app.stage ?? 'applied'))
    const patch: Row = { updated_at: new Date().toISOString() }
    if (nextStage !== app.stage) patch.stage = nextStage
    patch.next_action =
      input.status === 'interview'
        ? '准备面试：复盘项目细节与常见八股'
        : input.status === 'replied'
          ? '回复 HR 并确认下一步安排'
          : input.status === 'rejected'
            ? '归档，复盘这一家挂在哪一步'
            : '按跟进日再联系一次，仍未回就换渠道'
    patch.next_action_at = input.followAt ?? defaultFollowAt(input.status)
    try {
      await updateRow('applications', app.id, patch)
    } catch {
      // 阶段推进失败不阻塞流水记录
    }
  }
  return row
}
