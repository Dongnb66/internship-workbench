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
export const USAGE_EVENTS = ['app_open', 'agent_download', 'agent_connected', 'crawl_ok', 'import_ok', 'diag'] as const

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
/**
 * 显式「这次不上报」开关：URL 带 ?nostat=1（真机 / 自动化验证时用）。
 *
 * 起因（2026-10-04）：我的浏览器验证每次都是新的存储上下文 ⇒ 每次生成一个新 anon_id，
 * 把「有多少人在用」这个要写进简历的数字污染了 5 台（total 17 里 5 台不是真人）。
 * 他也指出清 localStorage 没用（Agent Window 本来就是新上下文）⇒ 只能靠显式开关。
 * 以后我验证一律在 URL 后加 ?nostat=1。
 */
export function isNoStat(search: string): boolean {
  return /[?&]nostat=1(&|$)/.test(search)
}
export function usageEnabled(): boolean {
  if (typeof location !== 'undefined' && isNoStat(location.search)) return false // ?nostat=1：验证时不落库
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

/**
 * 用户表的一行（纯函数，便于测试）。
 *
 * ⚠️ 2026-10-04 的教训：这张表**只 INSERT，不 UPDATE**。
 * 立项时的设计是「首次插入 + 之后 UPDATE last_seen」，但真机上那条 UPDATE 从来没成功过
 * （WorkBuddy 用 pg_stat_user_tables 判的：usage_users n_tup_ins=31 / n_live_tup=10 ⇒ 21 次撞主键，
 *   而 n_tup_upd=1 且那 1 次是管理员手工改的 ⇒ 匿名 UPDATE 一次都没生效，且前端静默吞错、不报错）。
 * 所以活跃与「装过助手」都改成**从 usage_events 推导**（那张表的 INSERT 是通的：n_tup_ins=23 / n_live_tup=11）。
 * 不再依赖任何 UPDATE ⇒ 权限可以收到「只允许 INSERT」，少一条会静默失败的链路。
 */
export function buildUserRow(anon: string, now: string, agentInstalled?: boolean): Record<string, unknown> {
  const row: Record<string, unknown> = {
    anon_id: anon,
    first_seen: now,
    last_seen: now,
    app_version: USAGE_APP_VERSION,
    os: USAGE_OS,
  }
  if (agentInstalled === true) row.agent_installed = true
  return row
}

/** 用户表：**只 INSERT**（一台浏览器一行）。活跃/已装助手一律从 usage_events 推导，理由见 buildUserRow 注释 */
export function touchUser(agentInstalled?: boolean): void {
  if (!usageEnabled()) return
  const anon = anonId()
  const now = new Date().toISOString()
  void (async () => {
    try {
      const mod = await import('../cloud')
      const db = mod.cloud.database as any
      await db.from('usage_users').insert(buildUserRow(anon, now, agentInstalled))
    } catch {
      /* 撞主键 = 这台浏览器已登记过；已经没有 UPDATE，所以这里静默就是正确行为 */
    }
  })()
}
