import { fmtDate } from './format'
import type { Row } from '../types'

/**
 * 面试记录与投递的关联逻辑（Interviews 页表单用）。
 *
 * 「AI 面试准备」的三路自动带入（岗位 JD / 所投简历 / 历史复盘）全部沿
 * application_id 追溯，所以面试表单必须能把记录挂到投递上——这个下拉的
 * 选项文案要让人一眼认出「是哪次投递」，排序让最近投的在前。
 */

export interface ApplicationOption {
  id: number
  label: string
}

/** 投递列表 → 下拉选项：公司 · 岗位（投递日期），按投递时间最新在前；没有 id 的行丢弃 */
export function applicationOptions(applications: Row[]): ApplicationOption[] {
  return applications
    .filter((a) => a && a.id !== undefined && a.id !== null)
    .map((a) => {
      const company = String(a.company ?? '').trim() || '未填公司'
      const title = String(a.title ?? '').trim() || '未填岗位'
      const appliedAt = a.applied_at ? String(a.applied_at) : ''
      const date = appliedAt ? `（${fmtDate(appliedAt)}投）` : ''
      return { id: Number(a.id), label: `${company} · ${title}${date}`, appliedAt }
    })
    .sort((a, b) => String(b.appliedAt ?? '').localeCompare(String(a.appliedAt ?? '')))
    .map(({ id, label }) => ({ id, label }))
}
