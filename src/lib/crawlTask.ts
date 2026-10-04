import type { CrawlSite } from './crawlSites'

/**
 * 抓取命令生成器。
 *
 * 定位：这是「任务生成器」不是「云端爬虫」——工作台是静态站，没有常驻进程，
 * 真正的抓取跑在用户自己的电脑上（crawler/run.mjs，Playwright 开真浏览器，
 * 复用用户自己的登录态，只读页面上看得见的 DOM）。这里负责把「选站点 + 填关键词」
 * 翻译成一条可以直接粘进终端的命令，并给出导入产物的路径提示。
 */

export interface CrawlPlanOptions {
  /** 选中的 --site 站点 id（非 urlOnly） */
  siteIds: string[]
  /** urlOnly 站点的具体地址（siteId → url，url 为空视为未填） */
  urls: Array<{ siteId: string; url: string }>
  keyword: string
  pages: number
  limit: number
  /** all=不筛 / intern=只要实习 / campus=只要校招（按标题筛） */
  mode: 'all' | 'intern' | 'campus'
}

export interface BuiltCrawlPlan {
  /** 每行一条命令；第一行是 cd，第二行是真正的抓取命令 */
  commandLines: string[]
  /** 本次任务涉及的站点（用于展示注意事项） */
  sites: CrawlSite[]
  /** 需要先登录的站点（生成命令前置提示） */
  needLoginSites: CrawlSite[]
  hasContent: boolean
}

function shellQuote(value: string): string {
  // Windows PowerShell 与 bash 通吃的最小转义：内容不含空格和引号就不加引号
  return /^[\w\u4e00-\u9fa5.,:/=+-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`
}

export function buildCrawlPlan(sites: CrawlSite[], opts: CrawlPlanOptions): BuiltCrawlPlan {
  const picked = sites.filter((s) => opts.siteIds.includes(s.id))
  const urlSites = opts.urls
    .filter((u) => u.url.trim())
    .map((u) => sites.find((s) => s.id === u.siteId))
    .filter((s): s is CrawlSite => Boolean(s))
  const allSites = [...picked, ...urlSites]

  const parts: string[] = ['node run.mjs']
  for (const u of opts.urls) {
    if (u.url.trim()) parts.push('--url', shellQuote(u.url.trim()))
  }
  if (opts.keyword.trim()) parts.push('--keyword', shellQuote(opts.keyword.trim()))
  if (opts.pages !== 2) parts.push('--pages', String(opts.pages))
  if (opts.limit !== 60) parts.push('--limit', String(opts.limit))
  if (opts.mode !== 'all') parts.push('--mode', opts.mode)
  for (const s of picked) parts.push('--site', s.id)

  const hasContent = picked.length > 0 || opts.urls.some((u) => u.url.trim())
  return {
    commandLines: hasContent ? ['cd internship-workbench/crawler', parts.join(' ')] : [],
    sites: allSites,
    needLoginSites: allSites.filter((s) => s.needsLogin),
    hasContent,
  }
}

/** 产出文件说明：导入入口在「岗位池 → 批量导入」，直接选 output 目录下的 JSON */
export function crawlOutputHint(): string {
  return '抓取结果默认落在 crawler/output/ 目录（每站点一个带时间戳的 JSON）。回到工作台「岗位池 → 批量导入」，点「选择文件」直接选这些 JSON 即可预览并入库。'
}

/**
 * 抓取失败时该说什么。
 *
 * 为什么按日志签名分派而不是一句话：2026-10-03 用用户视角实测踩到过 —— 桌面包缺
 * extension/collector.js 与 playwright-core，用户点一次必然失败，而卡片当时统一说
 * 「常见的是站点改版或需要登录」，把**本地缺件**指成了站点问题，方向完全相反。
 * 日志里其实写得很清楚，这里只把它翻译成一句可执行的话。
 */
/**
 * 抓取页的用户偏好（设备级）。
 *
 * 为什么：2026-10-03 用户视角实测 —— 每次进页面，站点勾选和关键词都被重置，第二次抓取要重新
 * 勾一遍、重新打一遍关键词。项目里「黑名单 / 模型选择」的先例是 localStorage（不进云端表），
 * 这里照同一先例：本文件只放**纯函数**（解析 / 校验 / 序列化），读写留在 UI 层。
 */
export interface CrawlerPrefs {
  sites: string[]
  keyword: string
  pages: number
  limit: number
  mode: 'all' | 'intern' | 'campus'
}

export const CRAWLER_PREFS_KEY = 'wb_crawler_prefs'

export const CRAWLER_PREFS_DEFAULT: CrawlerPrefs = { sites: [], keyword: '', pages: 2, limit: 60, mode: 'all' }

const CRAWLER_MODES = ['all', 'intern', 'campus'] as const

/**
 * 解析存下来的偏好。坏 JSON / 字段缺失 / 类型不对 / 站点 id 已不存在 —— 一律退化成默认值，
 * 绝不让一段历史 localStorage 把抓取页搞炸。
 */
export function parseCrawlerPrefs(raw: string | null | undefined, knownSiteIds: readonly string[]): CrawlerPrefs {
  const d = CRAWLER_PREFS_DEFAULT
  if (!raw) return { ...d }
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return { ...d }
  }
  if (!obj || typeof obj !== 'object') return { ...d }
  const o = obj as Record<string, unknown>
  const known = new Set(knownSiteIds)
  const clamp = (v: unknown, min: number, max: number, dflt: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt
    return Math.max(min, Math.min(max, n))
  }
  const sites = Array.isArray(o.sites) ? o.sites.filter((s): s is string => typeof s === 'string' && known.has(s)) : [...d.sites]
  const keyword = typeof o.keyword === 'string' ? o.keyword.slice(0, 100) : d.keyword
  const mode =
    typeof o.mode === 'string' && (CRAWLER_MODES as readonly string[]).includes(o.mode)
      ? (o.mode as CrawlerPrefs['mode'])
      : d.mode
  return {
    sites,
    keyword,
    pages: clamp(o.pages, 1, 20, d.pages),
    limit: clamp(o.limit, 1, 300, d.limit),
    mode,
  }
}

/** 只序列化这五个字段（localStorage 里不留别的东西） */
export function serializeCrawlerPrefs(p: CrawlerPrefs): string {
  return JSON.stringify({ sites: p.sites, keyword: p.keyword, pages: p.pages, limit: p.limit, mode: p.mode })
}

export function crawlFailureHint(task: { log?: string[]; error?: string | null }): string {
  const text = [task.error ?? '', ...(task.log ?? [])].join('\n')
  if (/Cannot find package|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/i.test(text)) {
    return '抓取器依赖没装（playwright-core）：到本地助手的 crawler 目录里执行 npm install，再重开一次任务。'
  }
  if (/ENOENT[^\n]*collector\.js/i.test(text)) {
    return '抓取器缺件：extension/collector.js 不存在 —— 本地助手装得不完整，需要重装或更新本地助手（用仓库那份跑，则把 extension/ 一起带上）。'
  }
  if (/档案目录被占用|lockfile/i.test(text)) {
    return '浏览器档案目录被上次抓取占用了：关掉抓取器打开的 Edge / Chrome 窗口后重试（或换个 --profile 目录跑）。'
  }
  if (/需要登录|login\.mjs|--login/.test(text)) {
    return '这站要先登录：默认内核跑 node login.mjs --site <站点id>，声明了引擎的站点跑 node run.mjs --site <id> --login，再重试。'
  }
  return '失败原因看日志最后一行，常见的是站点改版或需要登录（🔒 站点先跑 node login.mjs --site <站点id>）。'
}

/** 用户当前系统（只看 UA，粒度到 win/mac/linux）：界面据此换引导 —— 本地助手只有 Windows 版 */
export function hostOs(ua?: string): 'win' | 'mac' | 'linux' | 'other' {
  const s = ua ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent)
  if (!s) return 'other'
  if (/Win/i.test(s)) return 'win'
  if (/Mac/i.test(s)) return 'mac'
  if (/Linux|Android/i.test(s)) return 'linux'
  return 'other'
}

export interface NonWindowsGuide {
  osLabel: string
  /** 非 Windows 用户在当前系统上仍然能做的事 —— 别让人对着装不了的安装包干等 */
  lanes: { name: string; detail: string }[]
}

/** 非 Windows 的替代路径；Windows 返回 null（不做多余提示） */
export function nonWindowsGuide(os: 'win' | 'mac' | 'linux' | 'other'): NonWindowsGuide | null {
  if (os === 'win') return null
  const osLabel = os === 'mac' ? 'macOS' : os === 'linux' ? 'Linux' : '你的系统'
  return {
    osLabel,
    lanes: [
      { name: '岗位广场', detail: '直接浏览公共岗位库，把想要的岗位加进自己的岗位池' },
      { name: 'AI 评估', detail: '给岗位池里的岗位算匹配分、分析 JD（不依赖本地助手）' },
      { name: '批量导入', detail: '在「岗位池 → 批量导入」粘文本或选 JSON，把岗位导进来' },
      { name: '从仓库源码跑抓取器（进阶）', detail: '需要 Node 与仓库；非登录型站点可用，适合能自己开终端的人' },
    ],
  }
}
