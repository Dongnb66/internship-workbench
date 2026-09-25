import { streamChat } from './ai'
import { JOB_TYPES } from './constants'
import { textToArray } from './format'
import { wrapUntrusted } from './untrusted'
import type { Profile, Row } from '../types'

/**
 * 岗位批量入库：把「从招聘网站复制/采集来的一段文本」变成结构化岗位。
 *
 * 三条入库通道，都由这里兜底：
 * 1) 手工整段粘贴 → 本地切块 →（可选）大模型结构化 → 人工确认入库；
 * 2) 浏览器扩展读取当前页面 → 字段已读好，不用过模型；
 * 3) 本地抓取器（crawler/）批量翻页 + 补 JD 后产出的 JSON → 同样不过模型。
 *
 * 三条通道的数据来源始终是「用户本人看到的那一屏」：抓取跑在用户自己的机器上，
 * 用用户自己的登录态，不调平台接口、不绕验证码。服务端不做抓取 ——
 * 本项目只有云上的静态站点 + 云数据库，没有常驻后端进程，架构上也没有落点。
 */

/** 一次送给模型的文本上限：太长会拖慢响应且容易丢字段 */
export const MAX_BLOCK_CHARS = 5000

export interface JobDraft {
  company: string
  title: string
  city: string
  job_type: string
  salary: string
  education: string
  deadline: string
  url: string
  tags: string[]
  jd_text: string
  /** 本地启发式或模型给的来源标注 */
  source: string
}

/** 压缩空白，避免整页复制带进来的一堆空行撑爆 prompt */
export function cleanBlock(raw: string): string {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** 一段分隔线之间至少要有点内容才算一个块，避免把 `---\n---` 拆成一堆空块 */
const MIN_BLOCK_CHARS = 5

/**
 * 把粘贴内容切成若干个「一次模型调用能处理完」的块。
 * 优先尊重用户自己写的分隔线；没有分隔线时按长度切，切点尽量落在空行上。
 */
export function splitJobBlocks(raw: string, maxChars: number = MAX_BLOCK_CHARS): string[] {
  const text = cleanBlock(raw)
  if (!text) return []

  const explicit = text
    .split(/\n[ \t]*(?:-{3,}|={3,}|\*{3,}|#{3,})[ \t]*\n/)
    .map((b) => cleanBlock(b))
    .filter((b) => b.length >= MIN_BLOCK_CHARS)
  if (explicit.length > 1) return explicit

  if (text.length <= maxChars) return [text]

  // 超长且没有分隔线：按段落累积，尽量在空行处断开
  const paragraphs = text.split(/\n{2,}/)
  const blocks: string[] = []
  let buffer = ''
  for (const p of paragraphs) {
    if (buffer && buffer.length + p.length + 2 > maxChars) {
      blocks.push(buffer.trim())
      buffer = ''
    }
    // 单段自身就超长：硬切
    if (p.length > maxChars) {
      if (buffer) {
        blocks.push(buffer.trim())
        buffer = ''
      }
      for (let i = 0; i < p.length; i += maxChars) {
        blocks.push(p.slice(i, i + maxChars).trim())
      }
      continue
    }
    buffer = buffer ? `${buffer}\n\n${p}` : p
  }
  if (buffer.trim()) blocks.push(buffer.trim())
  return blocks.filter(Boolean)
}

const LABEL_PATTERNS: Record<string, RegExp> = {
  company: /^(?:公司|公司名称|企业|企业名称|招聘方)\s*[：:]\s*(.+)$/m,
  title: /^(?:岗位|岗位名称|职位|职位名称|招聘岗位)\s*[：:]\s*(.+)$/m,
  city: /^(?:城市|工作城市|工作地点|地点|base|Base|BASE)\s*[：:]\s*(.+)$/m,
  salary: /^(?:薪资|薪水|待遇|日薪|月薪|薪资范围)\s*[：:]\s*(.+)$/m,
  education: /^(?:学历|学历要求)\s*[：:]\s*(.+)$/m,
  deadline: /^(?:截止|截止日期|投递截止|截止时间)\s*[：:]\s*(.+)$/m,
}

function normalizeDate(value: string): string {
  const m = /(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/.exec(String(value ?? ''))
  if (!m) return ''
  const y = m[1]
  const mo = String(Number(m[2])).padStart(2, '0')
  const d = String(Number(m[3])).padStart(2, '0')
  return `${y}-${mo}-${d}`
}

/** job_type 必须落在 JOB_TYPES 里，否则筛选器会失效 */
export function normalizeJobType(value: string): string {
  const v = String(value ?? '').trim()
  const hit = JOB_TYPES.find((t) => t === v)
  if (hit) return hit
  if (/暑期/.test(v)) return '暑期实习'
  if (/日常/.test(v)) return '日常实习'
  if (/校招|校园招聘|秋招|春招|应届/.test(v)) return '校招'
  // 「社招」和「社会招聘」都要认：只写 /社招/ 会让「社会招聘」掉进 fallback 变成「实习」
  if (/社招|社会招聘/.test(v)) return '社招'
  return '实习'
}

const URL_RE = /https?:\/\/[^\s，。；、）)"'<>]+/g

/** 搜索/列表页链接：带 query 的筛选参数，或明确的 search/list 路径 */
const LOOKS_LIKE_LIST = /[?&](query|keyword|search|page|city|salary|experience)=|\/(search|list)(\/|\?|$)/i

/** 详情页链接：报名、投递、岗位详情这些路径特征 */
const LOOKS_LIKE_DETAIL = /\/(job_detail|jobdetail|position|positions|jobs?\/\d|detail|campus|apply|requisition)/i

/**
 * 从一段文本里挑出「最可能是这个岗位」的链接。
 *
 * 一段粘贴文本里往往有好几个 URL：页面自己的地址、导航、推荐位、社交分享。直接取第一个
 * 一定会错（采集器写进头部的来源页地址就会被当成岗位链接）。所以按可信度排序：
 * 详情页特征 > 普通链接 > 列表页链接，并且跳过以 # 开头的采集器元信息行。
 */
export function pickJobUrl(text: string): string {
  const urls: string[] = []
  for (const line of String(text ?? '').split('\n')) {
    if (line.trim().startsWith('#')) continue
    const found = line.match(URL_RE)
    if (found) urls.push(...found)
  }
  if (!urls.length) return ''

  const scored = urls.map((u) => ({
    url: u,
    detail: LOOKS_LIKE_DETAIL.test(u) && !LOOKS_LIKE_LIST.test(u),
    list: LOOKS_LIKE_LIST.test(u),
  }))
  return (scored.find((s) => s.detail) ?? scored.find((s) => !s.list) ?? scored[0]).url
}

/**
 * 本地启发式预填：模型没跑之前（或没跑成功时）也要有一份能看的草稿。
 * 只认「标签：值」这种明确写法，认不出来就留空 —— 宁可留空也不猜。
 */
export function guessFromBlock(block: string): JobDraft {
  const text = cleanBlock(block)
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

  const pick = (key: string): string => {
    const m = LABEL_PATTERNS[key].exec(text)
    return m ? m[1].trim() : ''
  }

  const salaryInline = /(\d{2,4}\s*[-~至]\s*\d{2,4}\s*(?:\/天|元\/天|\/日|K|k|元))/i.exec(text)
  const deadlineInline = /(?:截止|投递截止)[^\d]{0,6}(\d{4}\s*[-/年.]\s*\d{1,2}\s*[-/月.]\s*\d{1,2})/.exec(text)

  // 标题行：优先显式标签，其次第一行（整页复制时首行通常是岗位标题）
  const title = pick('title') || lines[0] || ''
  const company = pick('company')
  const city = pick('city') || (/远程/.test(text) ? '远程' : '')

  return {
    company: company.slice(0, 60),
    title: title.slice(0, 60),
    city: city.slice(0, 30),
    job_type: normalizeJobType(title + ' ' + text.slice(0, 200)),
    salary: (pick('salary') || (salaryInline ? salaryInline[1] : '')).slice(0, 40),
    education: pick('education').slice(0, 20),
    deadline: normalizeDate(pick('deadline') || (deadlineInline ? deadlineInline[1] : '')) || '',
    url: pickJobUrl(text),
    tags: [],
    jd_text: text.slice(0, 8000),
    source: '',
  }
}

const PARSE_JOBS_SYSTEM = `你是招聘信息结构化助手。用户粘贴的是从招聘网站、邮件或聊天记录里复制来的原始文本，格式不规整，可能包含一个岗位，也可能包含多个。
只输出一个 JSON 对象，不要输出任何解释文字，不要用 Markdown 代码块，结构如下：
{
  "jobs": [
    {
      "company": "公司名称，找不到就填空字符串",
      "title": "岗位名称",
      "city": "工作城市，找不到就填空字符串",
      "job_type": "只能在 实习 / 日常实习 / 暑期实习 / 校招 / 社招 中选一个，判断不了填 实习",
      "salary": "薪资原文，如 150-200/天，找不到就填空字符串",
      "education": "学历要求，如 本科，找不到就填空字符串",
      "deadline": "投递截止日期，格式 YYYY-MM-DD，找不到就填空字符串",
      "url": "岗位链接，找不到就填空字符串",
      "tags": ["技术或能力关键词，最多 8 个"],
      "jd_text": "该岗位的职责与要求正文"
    }
  ]
}
规则（必须严格遵守）：
- 不得虚构原文中没有的信息。找不到的字段一律留空字符串或空数组，绝不猜测公司名、薪资、日期、学历。
- jd_text 只能整理原文内容：去掉页面导航、推荐位、报名入口、页脚、"相关推荐"等噪声，但不要自己补充任何要求或职责。
- 如果这段文本里没有岗位职责正文，jd_text 留空字符串。
- 一段文本里有几个岗位就输出几条；不要为了凑数把同一个岗位拆成多条。`

function coerceDraft(raw: any): JobDraft {
  const tags = Array.isArray(raw?.tags)
    ? raw.tags.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 8)
    : textToArray(String(raw?.tags ?? '')).slice(0, 8)
  const title = String(raw?.title ?? '').trim()
  return {
    company: String(raw?.company ?? '').trim().slice(0, 60),
    title: title.slice(0, 60),
    city: String(raw?.city ?? '').trim().slice(0, 30),
    job_type: normalizeJobType(String(raw?.job_type ?? '') + ' ' + title),
    salary: String(raw?.salary ?? '').trim().slice(0, 40),
    education: String(raw?.education ?? '').trim().slice(0, 20),
    deadline: normalizeDate(String(raw?.deadline ?? '')),
    url: String(raw?.url ?? '').trim(),
    tags,
    jd_text: String(raw?.jd_text ?? '').trim().slice(0, 8000),
    source: '',
  }
}

/**
 * 一段文本 → 若干岗位草稿。
 * 模型解析失败时回落到本地启发式结果，保证调用方永远拿得到东西，不会白粘一次。
 */
export async function parseJobsFromBlock(block: string, hintSource: string): Promise<JobDraft[]> {
  const text = cleanBlock(block)
  if (!text) return []

  let drafts: JobDraft[] = []
  try {
    const rawText = await streamChat({
      system: PARSE_JOBS_SYSTEM,
      // 这段文本是从招聘网站／邮件／聊天记录里复制来的陌生人写的原文，属于外部不可信数据，
      // 必须走隔离包装。之前这里是裸拼的 —— 它是本仓第 8 个模型调用点，
      // 而当时的覆盖率断言是手写清单，只列了 7 个，所以一直没被发现。
      // 现在覆盖率断言改成从源码里**推导**调用点，漏一个就红。
      user: wrapUntrusted('待结构化文本', text.slice(0, 9000)),
      json: true,
    })
    const parsed = JSON.parse(rawText) as { jobs?: unknown[] }
    const list = Array.isArray(parsed?.jobs) ? parsed.jobs : []
    drafts = list.map(coerceDraft).filter((d) => d.title || d.jd_text)
  } catch {
    drafts = []
  }

  if (!drafts.length) {
    const fallback = guessFromBlock(text)
    drafts = [fallback]
  }
  return drafts.map((d) => ({ ...d, source: d.source || hintSource }))
}

/** 归一化公司+岗位，用于入库前查重 */
export function dedupeKey(company: string, title: string): string {
  const norm = (v: string) =>
    String(v ?? '')
      .toLowerCase()
      .replace(/[\s（）()【】[\]·、,，.。\-_/]/g, '')
      .replace(/(实习|日常实习|暑期实习|校招|社招|岗位|职位|招聘)/g, '')
  return `${norm(company)}||${norm(title)}`
}

export interface DupeCheck {
  key: string
  duplicate: boolean
  existing?: Row
}

/** 与库中已有岗位比对，返回每条草稿是否重复 */
export function dedupeAgainst(existing: Row[], drafts: JobDraft[]): DupeCheck[] {
  const map = new Map<string, Row>()
  for (const row of existing) {
    const key = dedupeKey(String(row.company ?? ''), String(row.title ?? ''))
    if (key !== '||') map.set(key, row)
  }
  return drafts.map((d) => {
    const key = dedupeKey(d.company, d.title)
    const hit = key === '||' ? undefined : map.get(key)
    return { key, duplicate: Boolean(hit), existing: hit }
  })
}

/** 能在岗位池里落住的最小条件：至少解析出岗位名或一段 JD */
export function isDraftUsable(draft: JobDraft): boolean {
  return Boolean(String(draft.title ?? '').trim() || String(draft.jd_text ?? '').trim())
}

/** 草稿 → 入库 payload。匹配度在入库前按当前画像算一次，省得进去就没分 */
export function draftToRow(draft: JobDraft, score: number, extraNote?: string): Row {
  const notes = [draft.jd_text ? '' : '⚠ 未解析到 JD 正文，建议手动补上', extraNote ?? ''].filter(Boolean).join('\n')
  return {
    company: draft.company || '未填公司',
    title: draft.title || '未填岗位',
    city: draft.city || null,
    job_type: draft.job_type,
    industry: '互联网',
    education: draft.education || null,
    salary: draft.salary || null,
    source: draft.source || '批量导入',
    url: draft.url || null,
    jd_text: draft.jd_text || null,
    tags: draft.tags,
    priority: score >= 75 ? '高' : score >= 55 ? '中' : '低',
    status: 'pool',
    deadline: draft.deadline || null,
    notes: notes || null,
    match_score: score,
  }
}

/** 给导入流程用的提示：画像没填时会明显影响解析与打分 */
export function importReadiness(profile: Profile | null): { ok: boolean; hint: string } {
  const skills = profile?.skills ?? []
  const directions = profile?.directions ?? []
  if (!skills.length && !directions.length) {
    return { ok: false, hint: '画像里还没有技能与目标方向：导入后匹配度会一律偏低。建议先去「目标条件」点一次「填入模板」。' }
  }
  return { ok: true, hint: `已按 ${skills.length} 项技能、${directions.length} 个目标方向计算匹配度。` }
}

/* ------------------------------------------------------------------ *
 * 浏览器扩展采集结果 → 岗位草稿
 *
 * 扩展已经把字段读出来了（它跑在用户自己的页面上，能拿到 DOM 里的原文），
 * 所以这条路径**不需要模型**：直接映射，省一次调用，也避免模型把已经准确
 * 的字段改歪。识别失败时返回 null，调用方回落到通用的文本解析。
 * ------------------------------------------------------------------ */

export interface CollectorPayload {
  source?: string
  /** 来源标签。扩展不写这个字段（靠域名兜底），本地抓取器会写具体渠道 */
  channel?: string
  site_id?: string
  page?: { url?: string; title?: string; site?: string }
  count?: number
  jobs?: Array<Record<string, unknown>>
}

/** 判断粘贴内容是不是「采集器 JSON」。只有结构对得上才认，避免误判普通文本 */
export function looksLikeCollectorJson(text: string): boolean {
  const t = String(text ?? '').trim()
  if (!t.startsWith('{')) return false
  try {
    const parsed = JSON.parse(t) as CollectorPayload
    return Array.isArray(parsed?.jobs) || typeof parsed?.source === 'string'
  } catch {
    return false
  }
}

/** 采集器 JSON → 岗位草稿；结构不认识时返回 null */
export function parseCollectorJson(text: string): JobDraft[] | null {
  let parsed: CollectorPayload
  try {
    parsed = JSON.parse(String(text ?? '').trim()) as CollectorPayload
  } catch {
    return null
  }
  if (!parsed || !Array.isArray(parsed.jobs)) return null

  // 来源优先用产出方明确写的 channel（本地抓取器会写「官网投递」「牛客」这类），
  // 没写才按域名猜 —— 猜出来的值只能是「浏览器采集」，不该覆盖更准确的信息。
  const site = String(parsed.page?.site ?? '').toLowerCase()
  const explicit = String(parsed.channel ?? '').trim()
  const guessed = site.includes('zhipin')
    ? 'BOSS直聘'
    : site.includes('shixiseng')
      ? '实习僧'
      : site.includes('nowcoder')
        ? '牛客'
        : '浏览器采集'
  const hint = explicit || guessed

  const drafts = parsed.jobs.map((raw) => {
    const title = String(raw?.title ?? '').trim()
    const jd = String(raw?.raw ?? raw?.jd_text ?? '').trim()
    return {
      company: String(raw?.company ?? '').trim().slice(0, 60),
      title: title.slice(0, 60),
      city: String(raw?.city ?? '').trim().slice(0, 30),
      job_type: normalizeJobType(`${title} ${jd.slice(0, 200)}`),
      salary: String(raw?.salary ?? '').trim().slice(0, 40),
      education: '',
      // 截止日：结构化源（OfferBiu 校招库这类）会带；DOM 抓取一般没有。
      // 这里曾经把它丢掉（固定写 ''），导致「岗位广场」导进来的岗位全部没有截止日，
      // 概览页的临近截止待办因此永远空着。认不出的写法一律留空，不猜日期。
      deadline: normalizeDate(String(raw?.deadline ?? '')),
      url: String(raw?.url ?? '').trim(),
      tags: [],
      jd_text: jd.slice(0, 8000),
      source: hint,
    } as JobDraft
  })

  const usable = drafts.filter(isDraftUsable)
  return usable.length ? usable : null
}

/**
 * 判断「用户选中的这个文件」是什么，并给出一句能直接显示给人的说明。
 *
 * 抽成纯函数是为了能单测：文件读进来之后走哪条路（直读采集数据 / 当纯文本切块），
 * 决定了要不要花模型额度，判错的代价是实实在在的额度。
 */
export function probeJobFile(name: string, text: string): { kind: 'collector' | 'text' | 'empty'; hint: string } {
  const raw = String(text ?? '')
  if (!raw.trim()) return { kind: 'empty', hint: '这个文件是空的' }

  const ext = String(name ?? '').toLowerCase().split('.').pop() ?? ''
  const oddExt = ext !== 'json' && ext !== 'txt'

  const drafts = looksLikeCollectorJson(raw) ? parseCollectorJson(raw) : null
  if (drafts?.length) {
    return { kind: 'collector', hint: `已识别为浏览器采集 / 本地抓取产出的数据，读出声 ${drafts.length} 个岗位，不需要消耗模型额度。` }
  }

  return {
    kind: 'text',
    hint: `已作为纯文本读入（${raw.length} 字）。${oddExt ? `文件后缀是 .${ext}，不是 .json/.txt —— 如果读出来是乱码，直接把内容复制粘贴进来。` : '接着选「仅本地拆分」或「AI 结构化解析」。'}`,
  }
}
