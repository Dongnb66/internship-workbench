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
