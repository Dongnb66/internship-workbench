/**
 * 抓取器的纯逻辑层：标题筛选、字段清洗、去重、断点合并、参数解析。
 *
 * 这一层刻意不引用任何浏览器 API，所以能脱离 Playwright 单测（和 src/lib 的做法一致）。
 *
 * ⚠️ 口径必须与 src/lib/import.ts 对齐：`dedupeKey` / `normalizeJobType` / `JOB_TYPES`
 * 三处一旦分叉，同一批岗位走「抓取器导入」和「手工粘贴导入」会算出两个去重键，
 * 用户在预览表里就会看到假重复或不重复。crawler/__tests__/contract.test.mjs 专门钉住这一点。
 */

export const JOB_TYPES = ['实习', '日常实习', '暑期实习', '校招', '社招']

export const CITIES = [
  '北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京', '西安', '苏州',
  '长沙', '重庆', '天津', '合肥', '郑州', '青岛', '厦门', '福州', '济南', '大连',
  '沈阳', '东莞', '佛山', '无锡', '宁波', '珠海', '南昌', '昆明', '贵阳', '石家庄',
  '太原', '哈尔滨', '长春', '兰州', '乌鲁木齐', '海口', '南宁', '惠州', '中山',
  '远程', '全国',
]

export const TITLE_WORDS =
  /(实习|工程师|开发|算法|产品|运营|设计|分析|研究|架构|测试|前端|后端|全栈|数据|研发|校招|招聘|专员|助理|经理|顾问|编辑|策划|讲师|医师|教师|销售|客服|法务|财务|人事|科学家|专家|专员|Intern|intern)/

export const SALARY_RE =
  /(\d{1,4}\s*[-~至]\s*\d{1,4}\s*(?:\/天|\/日|\/月|元?\/天|元?\/月|元|K|k)|面议|\d{1,3}\s*[kK]\s*[-~至]\s*\d{1,3}\s*[kK])/

export const COMPANY_HINT =
  /(公司|集团|科技|网络|信息|技术|软件|数据|智能|传媒|教育|文化|电子|通信|银行|证券|保险|研究院|研究所|实验室|中心|工作室|事务所|有限|股份|控股|实业|企业|事业部)/

/** 实习相关标记。参照做法：标题带实习标记的岗位要不要收，是筛选策略，不是提取策略 */
export const INTERN_RE = /(实习|见习|Intern|intern|暑期|日常实习)/

/** 明确的非目标标记（社招 / 年限要求），用于 --mode intern 时反向排除 */
export const SENIOR_RE = /(社招|社会招聘|资深|高级专家|总监|VP|负责人|10年以上)/

export function cleanText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/** 与 extension/collector.js#pickCity 同源：多个城市并列时取文本里最早出现的那个 */
export function pickCity(text) {
  const t = String(text ?? '')
  let best = ''
  let at = -1
  for (const c of CITIES) {
    const i = t.indexOf(c)
    if (i < 0) continue
    if (at < 0 || i < at) {
      at = i
      best = c
    }
  }
  return best
}

/** 与 src/lib/import.ts#normalizeJobType 同源：必须落在 JOB_TYPES 里，否则前端筛选器会失效 */
export function normalizeJobType(value) {
  const v = cleanText(value)
  if (JOB_TYPES.includes(v)) return v
  if (/暑期/.test(v)) return '暑期实习'
  if (/日常/.test(v)) return '日常实习'
  if (/校招|校园招聘|秋招|春招|应届/.test(v)) return '校招'
  // 「社招」和「社会招聘」都要认：只写 /社招/ 会让「社会招聘」掉进 fallback 变成「实习」
  if (/社招|社会招聘/.test(v)) return '社招'
  return '实习'
}

/** 与 src/lib/import.ts#dedupeKey 同源 */
export function dedupeKey(company, title) {
  const norm = (v) =>
    String(v ?? '')
      .toLowerCase()
      .replace(/[\s（）()【】[\]·、,，.。\-_/]/g, '')
      .replace(/(实习|日常实习|暑期实习|校招|社招|岗位|职位|招聘)/g, '')
  return `${norm(company)}||${norm(title)}`
}

/**
 * 标题筛选。抓取器最贵的动作是「打开岗位详情页补 JD」，所以筛选必须发生在补 JD 之前 ——
 * 先把不想要的标题挡掉，能省下大部分请求。
 *
 * @param {string} title
 * @param {{mode?: 'all'|'intern'|'campus', include?: string[], exclude?: string[]}} opts
 */
export function screenTitle(title, opts = {}) {
  const mode = opts.mode ?? 'all'
  const t = cleanText(title)
  if (!t) return { pass: false, reason: '空标题' }
  if (t.length > 60) return { pass: false, reason: '标题过长（更像正文）' }
  if (!TITLE_WORDS.test(t)) return { pass: false, reason: '标题不含岗位词' }

  for (const w of opts.exclude ?? []) {
    if (w && t.includes(w)) return { pass: false, reason: `命中排除词「${w}」` }
  }
  const include = (opts.include ?? []).filter(Boolean)
  if (include.length && !include.some((w) => t.includes(w))) {
    return { pass: false, reason: '未命中 --include 关键词' }
  }

  const isIntern = INTERN_RE.test(t)
  if (mode === 'intern') {
    // 明确带高级别标记的先挡掉：这类岗位挂「实习」两个字也基本不是给在校生投的
    if (SENIOR_RE.test(t)) return { pass: false, reason: '带高级别标记（--mode intern）' }
    if (!isIntern) return { pass: false, reason: '非实习标题（--mode intern）' }
  }
  if (mode === 'campus' && !isIntern && !/校招|校园|秋招|春招|应届/.test(t)) {
    return { pass: false, reason: '非校招/实习标题（--mode campus）' }
  }
  return { pass: true, reason: '', isIntern }
}

/** 逐条过筛选，返回保留项与被挡原因的计数 */
export function screenJobs(jobs, opts = {}) {
  const kept = []
  const reasons = new Map()
  for (const job of jobs) {
    const verdict = screenTitle(job?.title, opts)
    if (verdict.pass) {
      kept.push({ ...job, is_intern: verdict.isIntern })
      continue
    }
    reasons.set(verdict.reason, (reasons.get(verdict.reason) ?? 0) + 1)
  }
  return { kept, filtered: jobs.length - kept.length, reasons: Array.from(reasons.entries()) }
}

/**
 * 跨轮次去重：同一批岗位每天重新抓一遍，绝大多数是上次已经产出过的。
 * 不比对历史会让产出文件迅速变成几万行噪音。
 */
export function mergeJobs(seenKeys, jobs) {
  const seen = new Set(seenKeys ?? [])
  const fresh = []
  let dup = 0
  for (const job of jobs) {
    const key = dedupeKey(job?.company, job?.title)
    if (key === '||') {
      fresh.push(job)
      continue
    }
    if (seen.has(key)) {
      dup += 1
      continue
    }
    seen.add(key)
    fresh.push(job)
  }
  return { fresh, dup, keys: Array.from(seen) }
}

/**
 * 列表页的短摘要 + 详情页的完整 JD 合成一条。
 * 详情页缺的字段用列表页的补，列表页缺的用详情页的补；JD 正文一律以详情页为准。
 */
export function mergeDetail(listJob, detailJob) {
  if (!detailJob) return { ...listJob }
  const pick = (a, b) => cleanText(a) || cleanText(b)
  return {
    company: pick(listJob?.company, detailJob?.company),
    title: pick(listJob?.title, detailJob?.title),
    city: pick(listJob?.city, detailJob?.city),
    salary: pick(listJob?.salary, detailJob?.salary),
    url: pick(listJob?.url, detailJob?.url),
    raw: cleanText(detailJob?.raw) || cleanText(listJob?.raw),
  }
}

export function hostOf(url) {
  try {
    return new URL(String(url)).hostname
  } catch {
    return ''
  }
}

/** 时间戳，用于文件名：2026-09-23_1707 */
export function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`
}

export function safeFileName(value) {
  return (
    String(value ?? '')
      .replace(/[^\w\u4e00-\u9fa5.-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 60) || 'output'
  )
}

/**
 * 产出物。字段名刻意与浏览器扩展的采集结果**逐字一致**，
 * 因为 src/lib/import.ts#parseCollectorJson 只认这一套键名。
 * 多出来的 `channel` 是抓取器的来源标签（如「腾讯校招」），用来覆盖按域名猜的那套兜底。
 */
export function makePayload({ siteId = '', siteName = '', channel = '', pageUrl = '', pageTitle = '', jobs = [], now = new Date() } = {}) {
  const payload = {
    source: '实习工作台抓取器',
    version: 1,
    channel: channel || siteName || '',
    site_id: siteId,
    collected_at: now.toISOString(),
    page: { url: pageUrl, title: pageTitle, site: hostOf(pageUrl) },
    count: jobs.length,
    jobs: jobs.map((j) => ({
      company: cleanText(j?.company),
      title: cleanText(j?.title),
      city: cleanText(j?.city),
      salary: cleanText(j?.salary),
      url: String(j?.url ?? ''),
      // 截止日：结构化源（如 OfferBiu 校招库）能给到，DOM 抓取一般给不了。
      // 有就带出来，没有就是空串 —— 不在这里猜。
      deadline: dateOnlyOf(j?.deadline),
      raw: cleanText(j?.raw),
    })),
  }
  payload.text = toText(payload)
  return payload
}

/** 把各种日期写法收敛成 yyyy-mm-dd；认不出就返回空串（宁可不带，也不给错日期） */
export function dateOnlyOf(value) {
  const m = /(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/.exec(String(value ?? ''))
  if (!m) return ''
  const p = (n) => String(Number(n)).padStart(2, '0')
  return `${m[1]}-${p(m[2])}-${p(m[3])}`
}

/** 与扩展的 toText 同格式，保证两条通道产出的文本能被同一套正则吃掉 */
export function toText(payload) {
  const head = `# 采集自 ${payload?.page?.title ?? ''} （${payload?.page?.url ?? ''}）\n# 共 ${payload?.count ?? 0} 个岗位 · ${payload?.collected_at ?? ''}`
  const blocks = (payload?.jobs ?? []).map((j) => {
    const rows = [
      j.company ? `公司：${j.company}` : '',
      `岗位：${j.title}`,
      j.city ? `城市：${j.city}` : '',
      j.salary ? `薪资：${j.salary}` : '',
      j.deadline ? `截止：${j.deadline}` : '',
      j.url ? j.url : '',
      '岗位原文：',
      String(j.raw ?? '').replace(/\n{2,}/g, '\n'),
    ]
    return rows.filter(Boolean).join('\n')
  })
  return `${head}\n\n${blocks.join('\n\n---\n\n')}\n`
}

/** 把 {kw} {page} 这类占位符填进站点模板；没给关键词时连参数一起摘掉，别留下空 ?query= */
export function expandTemplate(template, vars = {}) {
  let out = String(template ?? '')
  const kw = cleanText(vars.kw)
  if (!kw) out = out.replace(/([?&])[^?&=]*=\{kw\}(&)?/g, (_m, sep, amp) => (amp ? sep : ''))
  out = out.replace(/\{kw\}/g, encodeURIComponent(kw))
  out = out.replace(/\{page\}/g, String(vars.page ?? 1))
  out = out.replace(/\{city\}/g, encodeURIComponent(cleanText(vars.city)))
  out = out.replace(/\?&/g, '?').replace(/[?&](?=$|#)/g, '')
  return out
}

const VALUE_FLAGS = new Set(['site', 'url', 'keyword', 'k', 'exclude', 'include', 'pages', 'limit', 'delay', 'detail', 'wait', 'out', 'mode', 'profile', 'company'])
const BOOL_FLAGS = new Set(['headed', 'dump', 'resume', 'purge', 'quiet', 'list-sites', 'help', 'h'])

/**
 * 参数解析。支持 `--site tencent` 与 `--site=tencent` 两种写法，
 * 未知参数不报错、只记下来（方便以后加旗标时前后兼容），但要能被调用方看到。
 */
export function parseArgs(argv = []) {
  const opts = {
    sites: [],
    urls: [],
    keywords: [],
    exclude: [],
    include: [],
    pages: 2,
    limit: 60,
    delay: 2600,
    detail: 20,
    wait: 0,
    out: '',
    mode: 'all',
    profile: '',
    company: '',
    headed: false,
    dump: false,
    resume: false,
    purge: false,
    quiet: false,
    listSites: false,
    help: false,
    unknown: [],
  }

  const asNumber = (raw, fallback) => {
    // 空串必须回退：`--detail` 漏写值时下一个 token 可能是 '' 或下一个 flag，
    // Number('') === 0 会把「没给参数」静默变成「0 个」——detail=0 跳过补 JD、
    // pages=0 一页都不抓，两种都是无声的空跑
    if (raw === undefined || raw === '' || raw === null) return fallback
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i])
    if (!token.startsWith('-')) continue

    const eq = token.indexOf('=')
    const key = (eq >= 0 ? token.slice(0, eq) : token).replace(/^--?/, '')
    const inlineValue = eq >= 0 ? token.slice(eq + 1) : undefined

    if (BOOL_FLAGS.has(key)) {
      const v = inlineValue === undefined ? true : inlineValue !== 'false'
      if (key === 'list-sites') opts.listSites = v
      else if (key === 'help' || key === 'h') opts.help = v
      else opts[key] = v
      continue
    }

    if (!VALUE_FLAGS.has(key)) {
      opts.unknown.push(token)
      continue
    }

    const value = inlineValue !== undefined ? inlineValue : String(argv[i + 1] ?? '')
    if (inlineValue === undefined) i += 1

    if (key === 'site') opts.sites.push(value)
    else if (key === 'url') opts.urls.push(value)
    else if (key === 'keyword' || key === 'k') opts.keywords.push(value)
    else if (key === 'exclude') opts.exclude.push(value)
    else if (key === 'include') opts.include.push(value)
    else if (key === 'pages') opts.pages = asNumber(value, opts.pages)
    else if (key === 'limit') opts.limit = asNumber(value, opts.limit)
    else if (key === 'delay') opts.delay = asNumber(value, opts.delay)
    else if (key === 'detail') opts.detail = asNumber(value, opts.detail)
    else if (key === 'wait') opts.wait = asNumber(value, opts.wait)
    else if (key === 'out') opts.out = value
    else if (key === 'mode') opts.mode = value
    else if (key === 'profile') opts.profile = value
    else if (key === 'company') opts.company = value
  }

  return opts
}
