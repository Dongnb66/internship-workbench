/**
 * 定时抓取（助手侧）。
 *
 * 为什么要有它：一键抓取虽然只差一次点击，但用户得**记得**去点。抓岗位这件事本质是
 * 「每天看看有没有新岗位」，所以交给常驻的助手每天自动跑一次才对 —— 用户打开网页
 * 直接看到「今天新增 N 条」。
 *
 * 设计取舍：
 *   · **默认关闭**（enabled=false）：抓取会开浏览器（无头，不弹窗），但要不要每天跑得用户自己决定；
 *   · 抓的是**用户自己勾的站点 + 关键词**，不做任何"猜你想抓什么"；
 *   · 只在「到点之后 + 今天还没跑过 + 距到点不超过 6 小时」时补跑 —— 免得深夜突然开爬；
 *   · 并发交给 server 的 running 闸门（同一时刻只跑一个抓取），这里只负责"该不该跑"。
 *
 * 本文件只放**纯函数**（解析/校验/判定），读写与调度循环在 server.mjs 里 —— 这样能被单测钉死。
 */

export const DEFAULT_SCHEDULE = {
  enabled: false,
  at: '09:00',
  sites: [],
  keyword: '',
  pages: 1,
  limit: 20,
  mode: 'all',
}

/** 到点后最多补跑多久（毫秒）：超过就不再补，避免深夜开机突然开爬 */
export const CATCH_UP_MS = 6 * 60 * 60 * 1000

/** 'HH:MM' → 当天零点起的分钟数；不合法返回 null */
export function parseAt(at) {
  if (typeof at !== 'string') return null
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(at.trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** 本地日期串（用来判断"今天跑过没有"）—— 只看本地日历，不碰时区换算 */
export function localDay(d) {
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/** 把网页传来的配置校验/归一化；坏数据一律拒（返回 null），不猜 */
/**
 * 校验并归一化配置。
 *
 * `opts.strict`（网页写入时用）：**时刻不合法就直接拒**（返回 null → 服务端 400）。
 * 敞开写会让用户以为设的是 11:30、实际被静默改成 09:00 —— 这种「猜」比报错危险。
 * 非 strict（从磁盘读配置时用）：坏值退回默认，别让一份坏配置把助手卡死。
 */
export function normalizeSchedule(input, knownSiteIds, opts) {
  if (!input || typeof input !== 'object') return null
  const strict = !!(opts && opts.strict)
  const known = new Set(knownSiteIds ?? [])
  const sites = Array.isArray(input.sites)
    ? input.sites.filter((s) => typeof s === 'string' && known.has(s))
    : []
  const atBad = parseAt(input.at) === null
  if (atBad && strict) return null
  const at = atBad ? DEFAULT_SCHEDULE.at : String(input.at).trim()
  const clamp = (v, min, max, dflt) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt
    return Math.max(min, Math.min(max, n))
  }
  return {
    enabled: input.enabled === true,
    at,
    sites,
    keyword: typeof input.keyword === 'string' ? input.keyword.slice(0, 100) : '',
    pages: clamp(input.pages, 1, 20, DEFAULT_SCHEDULE.pages),
    limit: clamp(input.limit, 1, 300, DEFAULT_SCHEDULE.limit),
    mode: ['all', 'intern', 'campus'].includes(input.mode) ? input.mode : DEFAULT_SCHEDULE.mode,
  }
}

/**
 * 现在该跑吗？
 * 条件全满足才 true：开着 + 勾了站点 + 已过点 + 今天没跑过 + 距到点不超过 CATCH_UP_MS。
 */
export function dueNow(schedule, now = new Date()) {
  if (!schedule || schedule.enabled !== true) return false
  if (!Array.isArray(schedule.sites) || schedule.sites.length === 0) return false
  const minutes = parseAt(schedule.at)
  if (minutes === null) return false
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0)
  if (now.getTime() < target.getTime()) return false
  if (now.getTime() - target.getTime() > CATCH_UP_MS) return false
  const last = schedule.lastRun
  if (last && last.day === localDay(now)) return false
  return true
}

/** 配置是不是"有效可得"（开着但一个站点都没有 = 白开，界面要提示） */
export function scheduleSummary(schedule) {
  if (!schedule || schedule.enabled !== true) return { enabled: false, text: '未开启' }
  if (!schedule.sites || schedule.sites.length === 0) return { enabled: true, text: '开着，但没勾站点 —— 到点不会抓' }
  return { enabled: true, text: '每天 ' + schedule.at + ' 抓 ' + schedule.sites.length + ' 个站点' + (schedule.keyword ? '（关键词：' + schedule.keyword + '）' : '') }
}
