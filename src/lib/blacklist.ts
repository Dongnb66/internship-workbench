import { dedupeKey } from './import'
import type { Row } from '../types'

/**
 * 黑名单 —— 三类维度（company / recruiter / job）借鉴 get_jobs 的实体设计
 * （PolyForm 许可，只借鉴维度不搬代码）。
 *
 * 存储用 localStorage：黑名单是设备级用户偏好，与「模型选择」同一先例
 * （不进数据库表，避免为它做一次云端迁移）；这一层只提供纯匹配函数，
 * 存取在 UI 层做。
 */

export type BlacklistType = 'company' | 'recruiter' | 'job'

export interface BlacklistEntry {
  type: BlacklistType
  value: string
  addedAt: string
}

export const BLACKLIST_STORAGE_KEY = 'wb_blacklist'

/** 岗位命中黑名单的判定：公司维度精确匹配 + 岗位维度按 dedupeKey 匹配；recruiter 在岗位数据上不可判定 */
export function matchBlacklist(job: Partial<Row>, list: BlacklistEntry[]): BlacklistEntry[] {
  const hits: BlacklistEntry[] = []
  const company = String(job.company ?? '').trim()
  const jobKey = company && job.title ? dedupeKey(company, String(job.title)) : null
  for (const entry of list ?? []) {
    if (!entry?.value) continue
    if (entry.type === 'company' && company && entry.value.trim().toLowerCase() === company.toLowerCase()) hits.push(entry)
    if (entry.type === 'job' && jobKey && entry.value.trim() === jobKey) hits.push(entry)
  }
  return hits
}
