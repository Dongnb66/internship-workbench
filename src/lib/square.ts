import { dedupeKey } from './import'
import type { PublicJob, Row } from '../types'

/**
 * 岗位广场的纯逻辑层。
 *
 * 广场（`jobs_public`）与岗位池（`jobs`）是两张表：广场是只读的公共岗位库，岗位池是
 * 私有数据。用户在广场点「加入」时，我们**复制**一份快照到他的岗位池，而不是引用 ——
 * 这样同一个岗位被多个用户加入后，各自的 status / 备注 / 匹配度互不影响，
 * 广场刷新也不会改动任何人已经在跟踪的记录。
 *
 * 这里刻意只放纯函数（不碰 SDK、不碰 React），以便单测覆盖「重复判定」这类
 * 一旦写错就会静默产生假重复的逻辑。
 */

/** 加入岗位池时使用的来源标签，必须在 `CHANNELS` 里 */
export const SQUARE_SOURCE = '岗位广场'

/**
 * 公共岗位 → 岗位池入库 payload。
 *
 * 私有字段在这里初始化：`status` 一律进 `pool`（还没投），`notes` 留一条来源说明，
 * `match_score` 由调用方按当前画像算好后传入（分池拷贝与画像无关，但分数与画像有关）。
 */
export function publicToPoolRow(job: PublicJob, score: number, extraNote?: string): Row {
  const notes = [`来自岗位广场${job.source ? ` · ${job.source}` : ''}`, extraNote ?? ''].filter(Boolean).join('\n')
  return {
    company: job.company || '未填公司',
    title: job.title || '未填岗位',
    city: job.city || null,
    job_type: job.job_type || '实习',
    industry: job.industry || '互联网',
    education: job.education || null,
    salary: job.salary || null,
    source: SQUARE_SOURCE,
    url: job.url || null,
    jd_text: job.jd_text || null,
    tags: job.tags ?? [],
    priority: score >= 75 ? '高' : score >= 55 ? '中' : '低',
    status: 'pool',
    deadline: job.deadline || null,
    notes,
    match_score: score,
  }
}

/**
 * 岗位池里已有的去重键集合。
 *
 * 「已在池中」的判定必须与导入查重同源（`dedupeKey` → `dedupeAgainst`），否则会出现
 * 「广场说已加入、实际又建了一条」这种最难查的重复。这里只读不写。
 */
export function poolKeySet(poolRows: Row[]): Set<string> {
  const keys = new Set<string>()
  for (const row of poolRows) {
    const key = dedupeKey(row.company, row.title)
    if (key !== '||') keys.add(key)
  }
  return keys
}

/** 某条公共岗位是否已经在用户自己的岗位池里 */
export function inPool(job: PublicJob, keys: Set<string>): boolean {
  // 兜底口径必须与 publicToPoolRow 一致：入库时空公司/空岗位被写成
  // 「未填公司/未填岗位」，这里若仍按原始空串算 key，加入后刷新会显示
  // 「未加入」，用户再点一次就静默产生重复行
  const key = dedupeKey(job.company || '未填公司', job.title || '未填岗位')
  if (key === '||') return false
  return keys.has(key)
}

/**
 * 广场列表筛选。抽成纯函数是因为广场数据量可能上千条，筛选逻辑要能被单测钉住
 * （尤其是「已在池中」这一档，它决定了用户看到的是全部还是只看没加过的）。
 */
export interface SquareFilter {
  keyword?: string
  city?: string
  jobType?: string
  /** '全部' | '未加入' | '已加入' */
  poolState?: string
}

export function filterSquareJobs<T extends PublicJob>(jobs: T[], filter: SquareFilter, keys: Set<string>): T[] {
  const kw = String(filter.keyword ?? '').trim().toLowerCase()
  let list = [...jobs]
  if (kw) {
    list = list.filter((j) => `${j.company} ${j.title} ${j.jd_text ?? ''} ${(j.tags ?? []).join(' ')}`.toLowerCase().includes(kw))
  }
  if (filter.city && filter.city !== '全部') list = list.filter((j) => j.city === filter.city)
  if (filter.jobType && filter.jobType !== '全部') list = list.filter((j) => j.job_type === filter.jobType)
  if (filter.poolState === '未加入') list = list.filter((j) => !inPool(j, keys))
  if (filter.poolState === '已加入') list = list.filter((j) => inPool(j, keys))
  return list
}

/** 广场里出现过的城市，按出现次数排序，用于筛选器与快捷标签 */
export function squareCities(jobs: PublicJob[]): string[] {
  const seen = new Map<string, number>()
  for (const j of jobs) {
    const c = String(j.city ?? '').trim()
    if (!c) continue
    seen.set(c, (seen.get(c) ?? 0) + 1)
  }
  return Array.from(seen.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([c]) => c)
}
