import { describe, expect, it } from 'vitest'

// @ts-ignore —— crawler/ 不在 tsconfig include 里，抓取器是纯 ESM 无类型；契约测试就是要读它的源值
import { SITES } from '../../../crawler/sites.mjs'
import { CRAWL_SITES, crawlSitesForPicker } from '../crawlSites'
import { buildCrawlPlan, crawlOutputHint } from '../crawlTask'

/**
 * 抓取任务生成器与 crawler/sites.mjs 的**同步契约**：
 * 页面上可选的站点必须真实存在于抓取器，漏登记 / 多登记 / 登录标记不一致，
 * 都会导致「页面生成了命令，抓取器却不认」或「站点存在但页面上选不到」。
 * 这里直接 import 抓取器源文件全量比对，漂移即红。
 */
describe('crawlSites ↔ crawler/sites.mjs 同步契约', () => {
  it('站点 id 清单完全一致（含顺序）', () => {
    expect(CRAWL_SITES.map((s) => s.id)).toEqual((SITES as Array<{ id: string }>).map((s) => s.id))
  })

  it('每个站点的 name / needsLogin / kwSearch / urlOnly 与抓取器一致', () => {
    const byId = new Map((SITES as Array<Record<string, any>>).map((s) => [s.id, s]))
    for (const ui of CRAWL_SITES) {
      const src = byId.get(ui.id)!
      expect(src, `抓取器里找不到站点 ${ui.id}`).toBeTruthy()
      expect(ui.name, `${ui.id} name 不一致`).toBe(src.name)
      expect(ui.needsLogin, `${ui.id} needsLogin 不一致`).toBe(src.needsLogin)
      // 判定依据必须与 crawler 行为对齐：
      // kwSearch = listUrl 含 {kw} 模板（--keyword 真正进搜索参数）
      expect(ui.kwSearch, `${ui.id} kwSearch 与 listUrl 模板不一致`).toBe(String(src.listUrl ?? '').includes('{kw}'))
      // urlOnly = listUrl 为空（run.mjs 会报「没有入口地址」）
      expect(ui.urlOnly, `${ui.id} urlOnly 与 listUrl 不一致`).toBe(!src.listUrl)
    }
  })

  it('verified 只允许 live / offline / 空串，且与抓取器实测标记一致', () => {
    const byId = new Map((SITES as Array<Record<string, any>>).map((s) => [s.id, s]))
    for (const ui of CRAWL_SITES) {
      expect(['', 'live', 'offline']).toContain(ui.verified)
      const srcVerified = (byId.get(ui.id)?.verified as string | undefined) ?? ''
      expect(ui.verified, `${ui.id} verified 与抓取器不一致`).toBe(srcVerified)
    }
  })

  it('picker 排序：实测可用在前、未验证居中、抓不到的置后', () => {
    const order = { live: 0, '': 1, offline: 2 } as const
    const list = crawlSitesForPicker()
    for (let i = 1; i < list.length; i += 1) {
      expect(order[list[i].verified], '排序被打乱').toBeGreaterThanOrEqual(order[list[i - 1].verified])
    }
  })
})

describe('buildCrawlPlan 命令生成', () => {
  const sites = CRAWL_SITES

  it('单站点 + 关键词：默认参数不产生 --pages/--limit/--mode 噪音', () => {
    const plan = buildCrawlPlan(sites, { siteIds: ['tencent'], urls: [], keyword: '后端', pages: 2, limit: 60, mode: 'all' })
    expect(plan.hasContent).toBe(true)
    expect(plan.commandLines[1]).toBe('node run.mjs --keyword 后端 --site tencent')
  })

  it('多站点多 --site 重复传参；非默认页数/上限/模式都出现在命令里', () => {
    const plan = buildCrawlPlan(sites, { siteIds: ['tencent', 'boss'], urls: [], keyword: 'Python', pages: 3, limit: 100, mode: 'intern' })
    expect(plan.commandLines[1]).toBe('node run.mjs --keyword Python --pages 3 --limit 100 --mode intern --site tencent --site boss')
  })

  it('需要登录的站点进入 needLoginSites', () => {
    const plan = buildCrawlPlan(sites, { siteIds: ['boss'], urls: [], keyword: '', pages: 2, limit: 60, mode: 'all' })
    expect(plan.needLoginSites.map((s) => s.id)).toEqual(['boss'])
  })

  it('urlOnly 站点走 --url；地址含空格时加引号', () => {
    const plan = buildCrawlPlan(sites, {
      siteIds: [],
      urls: [{ siteId: 'feishu', url: 'https://x.jobs.feishu.cn/index?a=1 b' }],
      keyword: '',
      pages: 2,
      limit: 60,
      mode: 'all',
    })
    expect(plan.commandLines[1]).toBe('node run.mjs --url "https://x.jobs.feishu.cn/index?a=1 b"')
  })

  it('url 为空白的 urlOnly 站点不计入内容判定', () => {
    const plan = buildCrawlPlan(sites, { siteIds: [], urls: [{ siteId: 'generic', url: '   ' }], keyword: '', pages: 2, limit: 60, mode: 'all' })
    expect(plan.hasContent).toBe(false)
    expect(plan.commandLines).toEqual([])
  })

  it('什么都不选：无命令、无报错', () => {
    const plan = buildCrawlPlan(sites, { siteIds: [], urls: [], keyword: '', pages: 2, limit: 60, mode: 'all' })
    expect(plan.hasContent).toBe(false)
    expect(plan.sites).toEqual([])
  })

  it('输出提示包含导入入口', () => {
    expect(crawlOutputHint()).toContain('批量导入')
  })
})
