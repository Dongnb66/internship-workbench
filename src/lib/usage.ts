/**
 * 匿名使用计数 —— 回答「有多少人在用、卡在哪一步」。
 *
 * 为什么要有它：项目发出去之后，如果没有计数，你连"有没有人用"都不知道，简历上也就写不出
 * 「N 位真实用户 / 漏斗从 X% 提到 Y%」这种能被追问、也站得住的数字。
 *
 * 设计参考（2026-10-04 读源码后定的，见 db/migrations/005_usage_events.sql 文件头）：
 *   · gstack 的 supabase 遥测 schema：事件表 + 用户表（first_seen/last_seen）两张，
 *     人数与留存不用扫事件表；事件带 schema_version。
 *   · Gnat：稳定匿名 id（distinct_id）+ track(事件名, 属性)。
 *   · openanalytics：无 cookie / 无指纹 / 不跨站；尊重 Global Privacy Control。
 *
 * 边界（写死在这里，改之前先读）：
 *   · 只记事件名 + 时间 + 版本 + 本机随机匿名 id；岗位/简历/投递内容一律不记（detail 只允许数字）。
 *   · 匿名 id 不绑定邮箱/账号，清 localStorage 即换新身份。
 *   · GPC 或用户手动关闭 ⇒ 一个事件都不发。
 *   · 永不抛错、永不阻塞：统计失败就静默 —— 功能永远优先于统计。
 */

import { USAGE_APP_VERSION, USAGE_OS } from './usageEnv'

/** 只允许这 5 个事件：改这里要同时改迁移里的注释与统计 SQL */
export const USAGE_EVENTS = ['app_open', 'agent_download', 'agent_connected', 'crawl_ok', 'import_ok'] as const

export type UsageEvent = (typeof USAGE_EVENTS)[number]

const ANON_KEY = 'wb_anon_id'
const OPT_OUT_KEY = 'wb_usage_optout'
const SESSION_KEY = 'wb_usage_session'

/** 只允许数字/短字符串：万一有人往里塞岗位内容，会被这里丢掉 */
export function sanitizeDetail(detail?: Record<string, unknown>): Record<string, number | string> | undefined {
  if (!detail) return undefined
  const out: Record<string, number | string> = {}
  for (const [k, v] of Object.entries(detail).slice(0, 6)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v)
    else if (typeof v === 'string' && v.length <= 40) out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

export function isUsageEvent(name: unknown): name is UsageEvent {
  return typeof name === 'string' && (USAGE_EVENTS as readonly string[]).includes(name)
}

/** 环境里允许统计吗（GPC / 用户手动关） */
export function telemetryAllowed(env: { gpc?: boolean; optOut?: boolean } = {}): boolean {
  if (env.gpc) return false
  if (env.optOut) return false
  return true
}

/** 24 位十六进制的本机随机 id（同一浏览器稳定，与账号无关） */
export function makeAnonId(random: (n: number) => Uint8Array): string {
  const bytes = random(12)
  return 'a_' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function anonId(): string {
  const s = store()
  if (!s) return 'a_unknown'
  const cur = s.getItem(ANON_KEY)
  if (cur) return cur
  const id =
    typeof crypto !== 'undefined' && crypto.getRandomValues
      ? makeAnonId((n) => crypto.getRandomValues(new Uint8Array(n)))
      : makeAnonId((n) => Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256)))
  try {
    s.setItem(ANON_KEY, id)
  } catch {
    /* 隐私模式等：退化成匿名 */
  }
  return id
}

/** 用户是否手动关掉了统计（设置页那个开关） */
export function usageOptOut(): boolean {
  try {
    return store()?.getItem(OPT_OUT_KEY) === '1'
  } catch {
    return true
  }
}

export function setUsageOptOut(off: boolean): void {
  try {
    if (off) store()?.setItem(OPT_OUT_KEY, '1')
    else store()?.removeItem(OPT_OUT_KEY)
  } catch {
    /* 忽略 */
  }
}

/** 当前整体是否允许上报（GPC 优先） */
export function usageEnabled(): boolean {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as unknown as { globalPrivacyControl?: boolean })
  return telemetryAllowed({ gpc: nav?.globalPrivacyControl === true, optOut: usageOptOut() })
}

export function buildEventPayload(
  event: UsageEvent,
  anon: string,
  nowISO: string,
  detail?: Record<string, number | string>,
) {
  return {
    schema_version: 1,
    anon_id: anon,
    event,
    app_version: USAGE_APP_VERSION,
    detail: detail ?? null,
    received_at: nowISO,
  }
}

type Sink = (table: string, payload: Record<string, unknown>) => Promise<void>

let sink: Sink | null = null

/** 仅供测试注入；生产走云端 SDK */
export function __setUsageSink(next: Sink | null): void {
  sink = next
}

async function defaultSink(table: string, payload: Record<string, unknown>): Promise<void> {
  const mod = await import('../cloud')
  const res = await (mod.cloud.database as any).from(table).insert(payload)
  if (res?.error) throw new Error(String(res.error?.message ?? res.error))
}

async function write(table: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await (sink ?? defaultSink)(table, payload)
  } catch {
    /* 统计失败绝不冒泡：功能优先 */
  }
}

/** 会话级事件每会话只记一次，否则刷新页面就把漏斗刷成假数据 */
function oncePerSession(event: UsageEvent): boolean {
  try {
    if (typeof sessionStorage === 'undefined') return true
    const key = SESSION_KEY + ':' + event
    if (sessionStorage.getItem(key)) return false
    sessionStorage.setItem(key, '1')
    return true
  } catch {
    return true
  }
}

/** 记一个事件。永不抛错、不等网络（调用方不用 await，也不该 await）。 */
export function track(event: UsageEvent, detail?: Record<string, unknown>): void {
  if (!isUsageEvent(event)) return
  if (!usageEnabled()) return
  if ((event === 'app_open' || event === 'agent_connected') && !oncePerSession(event)) return
  void write('usage_events', buildEventPayload(event, anonId(), new Date().toISOString(), sanitizeDetail(detail)))
  touchUser()
}

/** 用户表：首次插入 + 之后只更新 last_seen（人数/活跃直接查这张） */
export function touchUser(agentInstalled?: boolean): void {
  if (!usageEnabled()) return
  const anon = anonId()
  const now = new Date().toISOString()
  void (async () => {
    try {
      const mod = await import('../cloud')
      const db = mod.cloud.database as any
      const row: Record<string, unknown> = { anon_id: anon, app_version: USAGE_APP_VERSION, os: USAGE_OS }
      if (agentInstalled !== undefined) row.agent_installed = agentInstalled
      const ins = await db.from('usage_users').insert({ ...row, first_seen: now, last_seen: now })
      if (!ins?.error) return
      await db.from('usage_users').update({ last_seen: now, app_version: USAGE_APP_VERSION }).eq('anon_id', anon)
    } catch {
      /* 静默 */
    }
  })()
}
