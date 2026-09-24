/**
 * 抓取请求参数校验与 CLI 参数构造（纯函数，可测）。
 *
 * 校验是安全边界：站点 id 必须在抓取器站点清单里（白名单），
 * 数值有上下限，字符串长度受限——这个接口只监听 127.0.0.1，
 * 但浏览器里跑的任意页面都能 fetch 到 localhost，白名单不是多余的。
 */

const MAX_SITES = 10
const MAX_URLS = 10

/**
 * @param {unknown} body 请求体
 * @param {Array<{id: string, urlOnly: boolean}>} sites 抓取器站点清单（白名单来源）
 * @returns {{ok: true, args: string[], outLabel: string} | {ok: false, error: string}}
 */
export function buildCrawlArgs(body, sites) {
  if (!body || typeof body !== 'object') return { ok: false, error: '请求体必须是 JSON 对象' }

  const siteIds = Array.isArray(body.sites) ? body.sites.filter((s) => typeof s === 'string') : []
  const urls = Array.isArray(body.urls)
    ? body.urls
        .filter((u) => u && typeof u.url === 'string' && u.url.trim())
        .map((u) => ({ siteId: typeof u.siteId === 'string' ? u.siteId : '', url: u.url.trim() }))
    : []

  if (!siteIds.length && !urls.length) return { ok: false, error: '至少选择一个站点或填一个地址' }
  if (siteIds.length > MAX_SITES) return { ok: false, error: `站点数量超过上限（${MAX_SITES}）` }
  if (urls.length > MAX_URLS) return { ok: false, error: `地址数量超过上限（${MAX_URLS}）` }

  const known = new Map(sites.map((s) => [s.id, s]))
  for (const id of siteIds) {
    const site = known.get(id)
    if (!site) return { ok: false, error: `未知站点 id：${id}` }
    if (site.urlOnly) return { ok: false, error: `站点 ${id} 只支持地址模式，请放进 urls` }
  }
  for (const u of urls) {
    if (u.siteId && !known.has(u.siteId)) return { ok: false, error: `未知站点 id：${u.siteId}` }
    if (!/^https?:\/\//i.test(u.url)) return { ok: false, error: `地址必须以 http(s) 开头：${u.url.slice(0, 50)}` }
    if (u.url.length > 2000) return { ok: false, error: '地址过长' }
  }

  const keywordRaw = typeof body.keyword === 'string' ? body.keyword.trim() : ''
  if (keywordRaw.length > 40) return { ok: false, error: '关键词过长（≤40 字）' }

  const clampInt = (value, min, max, fallback) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.max(min, Math.min(max, Math.round(n)))
  }
  const pages = clampInt(body.pages, 1, 20, 1)
  const limit = clampInt(body.limit, 1, 100, 60)

  const mode = ['all', 'intern', 'campus'].includes(body.mode) ? body.mode : 'all'

  const args = ['run.mjs']
  for (const u of urls) args.push('--url', u.url)
  if (keywordRaw) args.push('--keyword', keywordRaw)
  if (pages !== 1) args.push('--pages', String(pages))
  if (limit !== 60) args.push('--limit', String(limit))
  if (mode !== 'all') args.push('--mode', mode)
  for (const id of siteIds) args.push('--site', id)

  const outLabel = [siteIds.join('+') || 'url', keywordRaw || 'all'].join('@').replace(/[^\w\u4e00-\u9fa5+@.-]/g, '_').slice(0, 80)
  return { ok: true, args, outLabel }
}

/**
 * 解析抓取产出目录里的 JSON 文件，汇总岗位列表。
 * @param {string} dir 产出目录
 * @param {(dir: string) => Promise<Array<{name: string, content: string}>>} readJsonFiles
 */
export async function collectJobs(dir, readJsonFiles) {
  const files = await readJsonFiles(dir)
  const jobs = []
  const seen = new Set()
  for (const f of files) {
    let parsed
    try {
      parsed = JSON.parse(f.content)
    } catch {
      continue
    }
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.jobs) ? parsed.jobs : []
    for (const j of list) {
      const key = `${j?.company ?? ''}|${j?.title ?? ''}`
      if (!j?.company || !j?.title || seen.has(key)) continue
      seen.add(key)
      jobs.push({
        company: String(j.company),
        title: String(j.title),
        city: String(j.city ?? ''),
        salary: String(j.salary ?? ''),
        url: String(j.url ?? ''),
        jd_text: String(j.raw ?? ''),
      })
    }
  }
  return jobs
}
