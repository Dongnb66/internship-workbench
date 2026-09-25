import { dedupeKey } from './import'
import type { Row } from '../types'

/**
 * 僵尸岗位检测 —— BENCHMARK P1（career-ops detect-reposts 思路）。
 *
 * 「僵尸岗位」：同一家公司同一岗位你挂过/失效过，它换个渠道又出现了。
 * 再投大概率还是同样的结局，时间应该给新机会。
 *
 * 「同岗位」的判定复用 import.ts 的 dedupeKey——入库查重和僵尸识别必须认同
 * 一个「同岗位」，否则会出现「查重说不重复、僵尸检测说是重发」的精神分裂。
 */

/** 池里这些状态 = 这条岗位对你而言已经死过一次 */
const DEAD_STATUSES = new Set(['rejected', 'archived'])

export const REPOST_REASON = '同岗位此前已挂过/失效过，疑似僵尸重发'

export interface RepostFlag {
  job: Row
  priorStatus: string
  reason: string
}

/** incoming 里凡是命中「池里已死岗位」的，逐条给出标记 */
export function flagReposts(incomingJobs: Row[], poolJobs: Row[]): RepostFlag[] {
  const deadKeys = new Map<string, string>()
  for (const p of poolJobs) {
    if (!DEAD_STATUSES.has(String(p.status))) continue
    deadKeys.set(dedupeKey(String(p.company), String(p.title)), String(p.status))
  }
  const out: RepostFlag[] = []
  for (const job of incomingJobs) {
    const key = dedupeKey(String(job.company), String(job.title))
    const prior = deadKeys.get(key)
    if (prior) out.push({ job, priorStatus: prior, reason: REPOST_REASON })
  }
  return out
}
