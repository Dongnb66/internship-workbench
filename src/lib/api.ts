import { cloud, errText } from '../cloud'
import type { Profile, Row } from '../types'

const db = () => cloud.database as any

export interface ListOptions {
  order?: string
  ascending?: boolean
  limit?: number
  filters?: Array<[string, unknown]>
}

export async function listRows(table: string, opts: ListOptions = {}): Promise<Row[]> {
  let q = db().from(table).select('*')
  for (const [col, val] of opts.filters ?? []) q = q.eq(col, val)
  q = q.order(opts.order ?? 'created_at', { ascending: opts.ascending ?? false })
  if (opts.limit) q = q.limit(opts.limit)
  const res = await q
  if (res.error) throw new Error(errText(res.error))
  return (res.data ?? []) as Row[]
}

export async function insertRow(table: string, payload: Row): Promise<Row> {
  const res = await db().from(table).insert(payload).select()
  if (res.error) throw new Error(errText(res.error))
  const rows = (res.data ?? []) as Row[]
  // 空数组 = RLS 拒绝写入，不能当成功处理
  if (!rows.length) throw new Error('写入被拒绝：请确认已登录且数据归属当前账号')
  return rows[0]
}

export async function updateRow(table: string, id: number, patch: Row): Promise<Row> {
  const res = await db().from(table).update(patch).eq('id', id).select()
  if (res.error) throw new Error(errText(res.error))
  const rows = (res.data ?? []) as Row[]
  if (!rows.length) throw new Error('没有改动任何数据：该记录不存在或不属于当前账号')
  return rows[0]
}

export async function deleteRow(table: string, id: number): Promise<void> {
  const res = await db().from(table).delete().eq('id', id).select()
  if (res.error) throw new Error(errText(res.error))
  const rows = (res.data ?? []) as Row[]
  if (!rows.length) throw new Error('删除失败：该记录不存在或不属于当前账号')
}

export async function getProfile(): Promise<Profile | null> {
  const res = await db().from('profile').select('*').limit(1)
  if (res.error) throw new Error(errText(res.error))
  const rows = (res.data ?? []) as Profile[]
  return rows[0] ?? null
}

/**
 * 岗位广场：读取公共岗位库（`jobs_public`）。
 *
 * 这张表对所有人只读（RLS 只有一条 SELECT 策略，没有任何写策略），所以这里**只有读**，
 * 没有对应的 insert / update / delete —— 不是因为还没写，是因为不该有。
 * 用户要把岗位放进自己的池子，走的是「复制一份到 `jobs`」，而不是改广场。
 */
export async function listPublicJobs(limit = 500): Promise<Row[]> {
  return listRows('jobs_public', { limit, order: 'posted_at' })
}

export async function saveProfile(payload: Profile): Promise<void> {
  const current = await getProfile()
  if (current?.id) {
    const { id: _omit, ...rest } = payload as Row
    await updateRow('profile', current.id, { ...rest, updated_at: new Date().toISOString() })
    return
  }
  const { id: _omit2, ...rest } = payload as Row
  await insertRow('profile', rest)
}

export { localScore, prefilterJob, WATCH_WORDS, PREFILTER_THRESHOLD } from './score'
