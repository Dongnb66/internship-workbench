/**
 * OfferBiu 数据源（offerbiu.com）—— 走它的公开 JSON API，不需要浏览器。
 *
 * 为什么值得单独做一条源：本项目既有的 `sites.mjs` 全是 **DOM 翻页**型站点，
 * 靠 `extension/collector.js` 认卡片结构；而 OfferBiu 提供的是**结构化校招库**：
 * 一次请求就能拿到 5860 条（2027 届秋招）的「公司 + 岗位 + 地点 + 截止日 +
 * 官方公告链接 + 投递入口 + 公司性质 + 行业分类」，这是 DOM 抓取拿不到的字段密度。
 * 它同时也是同赛道的商业产品（大学生秋招投递管理），本文件只读它的公开接口。
 *
 * ── 合规边界（写在这里，因为这是最容易越界的一类功能）────────────────
 * 1. **只读公开接口**，不登录、不带任何 cookie、不绕任何限制；对方开放它给前端用。
 * 2. **必须低频**：默认每次请求间隔 1.2 秒（对方前端自己的 page_size 是 9，
 *    我们用 20 也只是为了少发几次请求）。不要改成并发。
 * 3. **只取公开字段**，不做用户态抓取（不碰需要登录的个人投递数据）。
 * 4. **标注来源**：产出物里写清 `site_id: 'offerbiu'`，渠道固定「岗位广场」，
 *    用户能一眼看出这批岗位是从哪来的。绝不伪装成"自有数据"。
 * 5. **本地缓存**：抓一次存本地 JSON，重复使用时不要再打对方接口。
 *    （`--out` 落盘就是为了这个。）
 * 6. robots.txt 当前为空（无声明）——这**不等于**许可。所以上面 1-5 条按更严的标准自我约束；
 *    若对方将来在 robots/ToS 里明确禁止，这条源应当直接删掉而不是改换姿势。
 *
 * 用法：
 *   node crawler/sources/offerbiu.mjs --season 2027 --limit 300 --out output/offerbiu-2027.json
 *   node crawler/sources/offerbiu.mjs --season 2027 --groups internet-tech --limit 100
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

import { makePayload } from '../lib/normalize.mjs'

export const ENDPOINT = 'https://offerbiu.com/api/recruitment/postings'
export const COMPANIES_URL = 'https://offerbiu.com/companies/'

/** 对方前端的 page_size 是 9；我们取 20 只是为了少发几次请求，不是压测 */
export const DEFAULT_PAGE_SIZE = 20
/** 默认请求间隔（毫秒）。调小就等于加压，别动它。 */
export const DEFAULT_DELAY_MS = 1200

/** 本地日期 yyyy-mm-dd */
function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** 取数组第一项并转字符串，空则 '' */
function firstOf(value) {
  if (Array.isArray(value)) return value.length ? String(value[0] ?? '').trim() : ''
  return String(value ?? '').trim()
}

/**
 * 单条 OfferBiu 记录 → 采集器岗位条目。
 *
 * 字段映射的取舍：
 * - `company`/`title`/`city`/`url` 直接对应，不加工；
 * - `deadline` 单独带出来（截止日是这批数据最值钱的部分，工作台的待办靠它）；
 * - `raw` 拼成人类可读的一段，作为 JD 原文的替代 —— OfferBiu 不提供完整 JD 正文，
 *   硬凑一个空 jd_text 会让下游的匹配评分失真，不如如实把"没有 JD 正文"写进原文里。
 */
export function mapOfferbiuItem(item, { now = new Date() } = {}) {
  if (!item || typeof item !== 'object') return null
  const company = String(item.companyName ?? '').trim()
  const title = String(item.positionsText ?? '').trim()
  if (!company && !title) return null

  const city = firstOf(item.locations)
  const applyUrl = firstOf(item.applyUrl)
  const announcement = String(item.announcementUrl ?? '').trim()
  const deadline = String(item.deadlineAt ?? '').trim()
  const nature = String(item.companyNature ?? '').trim()
  const industry = String(item.industry ?? '').trim()
  const years = Array.isArray(item.targetYears) ? item.targetYears.join('/') : String(item.targetYears ?? '')

  const rawLines = [
    `公司性质：${nature || '—'}`,
    `行业：${industry || '—'}`,
    `招聘类型：${String(item.recruitType ?? '').trim() || '—'}`,
    `面向届数：${years || '—'}`,
    `工作地点：${city || '—'}`,
    `岗位：${title || '—'}`,
    deadline ? `投递截止：${String(item.deadlineText ?? deadline).trim()}` : '',
    announcement ? `官方公告：${announcement}` : '',
    '注：本条来自 OfferBiu 校招库，不含完整 JD 正文 —— 需要逐条精评请先补 JD。',
  ].filter(Boolean)

  return {
    company,
    title,
    city,
    salary: '',
    url: applyUrl || announcement,
    // 结构化截止日：工作台的待办/紧急度直接用它，不再靠解析正文
    deadline: deadline ? deadline.slice(0, 10) : '',
    // 溯源：这一条是谁带来的，隔一个月回来也能核对
    offerbiu_id: String(item.id ?? '').trim(),
    raw: rawLines.join('\n'),
    collected_at: now.toISOString(),
  }
}

/** 抓一页；失败抛错，由调用方决定是否继续 */
export async function fetchOfferbiuPage({
  seasonYear,
  recruitType = '秋招',
  industryGroups = [],
  page = 0,
  pageSize = DEFAULT_PAGE_SIZE,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
} = {}) {
  const params = new URLSearchParams({
    seasonYear: String(seasonYear),
    recruitType,
    size: String(pageSize),
    page: String(page),
  })
  for (const g of industryGroups) params.append('industryGroup', g)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`${ENDPOINT}?${params.toString()}`, {
      headers: { 'User-Agent': 'internship-workbench/1.0 (+local personal job search tool)' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`OfferBiu ${res.status}`)
    const body = await res.json()
    if (body?.success !== true || !body?.data) throw new Error('OfferBiu 返回结构不符合预期')
    const data = body.data
    return {
      items: Array.isArray(data.items) ? data.items : [],
      totalItems: Number(data.totalItems ?? 0),
      totalPages: Number(data.totalPages ?? 0),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 抓足 limit 条（或抓完为止），串行 + 固定间隔。
 * 刻意不做并发：这是个"礼貌抓取"，慢一点没关系，把对方打疼了这条源就没了。
 */
export async function collectOfferbiu({
  seasonYear,
  recruitType = '秋招',
  industryGroups = [],
  limit = 200,
  pageSize = DEFAULT_PAGE_SIZE,
  delayMs = DEFAULT_DELAY_MS,
  fetchImpl = globalThis.fetch,
  sleeper = (ms) => new Promise((r) => setTimeout(r, ms)),
  onProgress,
  now = new Date(),
} = {}) {
  const raw = []
  let page = 0
  let totalItems = 0
  let totalPages = 0

  while (raw.length < limit) {
    const res = await fetchOfferbiuPage({ seasonYear, recruitType, industryGroups, page, pageSize, fetchImpl })
    totalItems = res.totalItems
    totalPages = res.totalPages
    if (!res.items.length) break
    raw.push(...res.items)
    onProgress?.({ page, got: raw.length, totalItems })
    page += 1
    if (totalPages && page >= totalPages) break
    if (raw.length < limit) await sleeper(delayMs)
  }

  const jobs = raw
    .slice(0, limit)
    .map((it) => mapOfferbiuItem(it, { now }))
    .filter(Boolean)

  return {
    jobs,
    meta: {
      seasonYear,
      recruitType,
      industryGroups,
      totalItems,
      totalPages,
      fetchedRecords: raw.length,
      dropped: raw.length - jobs.length,
    },
  }
}

/** 组装成工作台能直接吃的采集器 payload（复用既有 makePayload，不发明新格式） */
export function toOfferbiuPayload(jobs, { seasonYear, now = new Date() } = {}) {
  return makePayload({
    siteId: 'offerbiu',
    siteName: `OfferBiu 校招库 ${seasonYear} 届`,
    // 渠道必须落在 src/lib/constants.ts 的 CHANNELS 里，否则按渠道筛选会漏掉它们
    channel: '岗位广场',
    pageUrl: COMPANIES_URL,
    pageTitle: `OfferBiu ${seasonYear} 届秋招公司库`,
    jobs,
    now,
  })
}

/** 简易参数解析：--key value / --flag */
export function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        out[key] = next
        i += 1
      } else {
        out[key] = true
      }
    } else {
      out._.push(a)
    }
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const seasonYear = Number(args.season ?? 2027)
  const limit = Number(args.limit ?? 200)
  const groups = args.groups ? String(args.groups).split(',').filter(Boolean) : []
  const outPath = args.out ? String(args.out) : ''

  if (!Number.isFinite(seasonYear) || seasonYear < 2020 || seasonYear > 2100) {
    console.error('--season 需要是 4 位年份，例如 --season 2027')
    process.exit(2)
  }

  const { jobs, meta } = await collectOfferbiu({
    seasonYear,
    industryGroups: groups,
    limit,
    onProgress: ({ got, totalItems }) => console.error(`  已取 ${got} / ${totalItems}`),
  })
  const payload = toOfferbiuPayload(jobs, { seasonYear })

  const text = JSON.stringify(payload, null, 2)
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, text, 'utf8')
    console.error(`✅ 写入 ${outPath}`)
  } else {
    process.stdout.write(text)
  }
  console.error(
    `共 ${jobs.length} 条（库内 ${meta.totalItems} 条 / ${meta.totalPages} 页，取回 ${meta.fetchedRecords} 条，丢弃 ${meta.dropped} 条）`,
  )
  console.error('接着：工作台 →「岗位池」→「批量导入」→ 选中这个 JSON（不消耗模型额度）')
}

/**
 * 只有被当作脚本直接执行时才跑 main()。
 * 用 pathToFileURL 而不是手拼 `file://${argv[1]}` —— Windows 上 argv[1] 是
 * `C:\...`，手拼出来是 `file://C:/...`（少一道斜杠）与 import.meta.url 的
 * `file:///C:/...` 不相等，结果是**脚本静默什么都不做**，排查起来很费时间。
 */
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  await main()
}
