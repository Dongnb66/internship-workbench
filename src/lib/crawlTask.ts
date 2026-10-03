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
