/**
 * 本地抓取助手 · 网页端一侧。
 *
 * 对端是 crawler/agent/server.mjs：跑在用户自己的电脑上，只监听 127.0.0.1（不对外
 * 暴露），只回传岗位 JSON、永远不碰凭据。两边的唯一约定是
 * crawler/agent/本地抓取助手_接口契约.md —— 任何一方改字段必须先改契约；
 * 本文件的接口类型就是契约的 TypeScript 投影，契约测试
 * （__tests__/localAgent.test.ts）按契约示例逐字段钉死结构。
 *
 * 分工边界：入库永远由网页端走既有「批量导入」（JobImportModal）完成，所以这里
 * 只有「探测 / 站点 / 发起 / 轮询」四个动作，外加一个「岗位 JSON → 现有导入文本
 * 格式」的纯函数 —— 不写任何一条入库代码。
 */

/** 助手固定监听地址（契约：只允许 127.0.0.1；端口可由 --port 改，网页端固定用默认值） */
export const AGENT_BASE = 'http://127.0.0.1:8787'

/**
 * 本地助手安装包（zip）的下载地址 —— 由平台侧托管后填这里。
 *
 * 空字符串 = 不显示下载入口（等于旧行为）。**不要放占位符 URL**：dead link 比没有更糟
 *（有单测钉住这一点）。
 *
 * 为什么需要它：2026-10-03 用用户视角实测 —— 用户机器上的助手是单独安装的，而网页里**从来
 * 没有下载入口**（只有一句可复制的 `npm run agent`，那要求用户有仓库和 Node）。装不上、装坏了
 * 的用户在界面里没有任何出路。平台托管后填进来，卡片上的两处提示就会多一条下载链接。
 */
export const AGENT_DOWNLOAD_URL =
  'https://internship-workbench-47024.app.workbuddy.host/downloads/internship-workbench-agent.zip'

/**
 * ⚠️ 运维陷阱（2026-10-03 实测，WorkBuddy 报、DSH 复跑）：这个 zip 放在发布源树的
 * `public/downloads/` 里，但它**不在 git 里**（本机 `.git/info/exclude` 排除）。少带它的那次发布
 * **不会 404**，而是返回 200 + `text/html` 的 SPA 回退页 —— 链接形状仍然合法，界面也不会报错。
 * 所以每次发布前后都要跑：`node scripts/verifyPublish.mjs`（它看 Content-Type，不只看状态码）。
 */

/**
 * 每次调用的兜底时限 —— **必须有**。
 *
 * 从线上 https 页面 fetch http://127.0.0.1 是浏览器眼里的「本地网络访问」（LNA，
 * Chrome/Edge 142+ 起要用户单独授权；Edge 把 127.0.0.1 这一档叫「设备上的应用 /
 * Apps on device」，对应 loopback-network）。没授权时请求会停在权限提示上 —— fetch
 * 既不 resolve 也不 reject。0.8.17 线上实测：探测就卡在这种状态，界面永远停在
 * 「正在探测本地助手…」，连「重新检测」都不给（那个按钮只在 off 状态渲染）。
 */
const CALL_TIMEOUT_MS = 15000
/** 探测要更快落地：卡住时尽早把「重新检测」露出来 */
export const PROBE_TIMEOUT_MS = 8000

/** 超时文案给的是可执行的下一步，不是「失败了」 */
const TIMEOUT_HINT =
  '浏览器可能正在等你允许「本地网络访问 / 设备上的应用」：允许后点「重新检测」；' +
  '若助手没起，在项目根目录执行 npm run agent。'

/** GET /health —— 探测助手是否在跑 */
export interface AgentHealth {
  ok: boolean
  service: string
  /** 助手找到的 crawler 目录，给用户看「它管的是哪一份抓取器」 */
  crawler: string
  /** 正在跑的任务 id；null = 空闲（助手一次只跑一个抓取，浏览器并行会互相踩） */
  busy: string | null
  /** output/ 里最近的产出文件名 */
  outputs: string[]
  /**
   * 助手自检（2026-10-03 起）：ready=false 时 problems 逐条写明「缺什么 + 怎么补」。
   * 可选字段 —— 老版本助手不回这两个字段，界面按「没报问题」处理。
   */
  ready?: boolean
  problems?: Array<{ code: string; message: string; fix: string }>
}

/** GET /sites 的站点项。数据直接来自用户本机的 crawler/sites.mjs（同源，禁止另写） */
export interface AgentSite {
  id: string
  name: string
  needsLogin: boolean
  /** live / '' / offline，同抓取器的实测标记 */
  verified: string
  kwSearch: boolean
}

export interface CrawlStartOptions {
  sites: string[]
  keyword?: string
  pages?: number
  limit?: number
  mode?: 'all' | 'intern' | 'campus'
  detail?: number
}

/** POST /crawl 的 202 响应。command 必须展示给用户 —— 让人看得见实际跑的是什么 */
export interface CrawlStartResult {
  taskId: string
  command: string
}

/** 抓取产出的一条岗位。前五个字段是契约钉死的；deadline/raw 是抓取器实际会带的 */
export interface AgentJob {
  company: string
  title: string
  city: string
  salary: string
  url: string
  /** 结构化源才给得出的截止日（yyyy-mm-dd），DOM 抓取一般是空串 */
  deadline?: string
  /** 岗位页原文（JD 正文），有就拼进导入文本，别丢 */
  raw?: string
}

export interface CrawlTaskOutput {
  file: string
  site: string
  count: number
  jobs: AgentJob[]
}

export interface CrawlTask {
  id: string
  /** 实际 spawn 的参数串（与 command 同源，排查时两边对得上） */
  args: string
  state: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt: number | null
  /** 给界面实时显示的日志行 */
  log: string[]
  error: string | null
  /** 只在 state === 'done' 时非 null */
  result: { outputs: CrawlTaskOutput[] } | null
}

/**
 * 探测超时（**不是**「连不上」）。
 *
 * 界面靠这个类型给「浏览器本地网络访问权限」的针对性指引 —— 从文案上分不出这两件事，
 * 而它们的下一步完全不同（一个去浏览器里放行，一个去启动助手）。
 */
export class AgentTimeoutError extends Error {
  readonly kind = 'agent-timeout'
}

async function call<T>(path: string, init?: RequestInit, timeoutMs = CALL_TIMEOUT_MS): Promise<T> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${AGENT_BASE}${path}`, { ...init, signal: ac.signal })
  } catch {
    // 超时（多半是浏览器权限闸门挡住）与「真的连不上」要分开说
    if (ac.signal.aborted) {
      throw new AgentTimeoutError(`本地助手 ${timeoutMs / 1000} 秒没有响应（${AGENT_BASE}）。${TIMEOUT_HINT}`)
    }
    // 连不上时 fetch 抛的是不带业务信息的 TypeError，必须在这里翻译成人话
    throw new Error(`连不上本地助手（${AGENT_BASE}）。在项目根目录执行 npm run agent 启动后重试。`)
  } finally {
    clearTimeout(timer)
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* 非 JSON 响应（代理错误页等）按 null 走下面的状态码分支 */
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error
    // 409「已有一个抓取在跑」这类契约约定要提示而不是静默失败的错误，原样抛给人看
    throw new Error(msg || `本地助手返回 HTTP ${res.status}`)
  }
  return body as T
}

/** 探测：页面加载时调一次，决定「一键抓取」通不通 */
export function probe(): Promise<AgentHealth> {
  // 探测用更短的 deadline：卡住时一秒内就能点「重新检测」重来
  return call('/health', undefined, PROBE_TIMEOUT_MS)
}

/** 站点清单：来自用户本机的 crawler/sites.mjs，可用于确认两端连的是同一份抓取器 */
export async function listSites(): Promise<AgentSite[]> {
  const body = await call<{ sites: AgentSite[] }>('/sites')
  return body.sites
}

/** output/ 里最近产出的文件（服务端 `/outputs` → { files: [{ name, size, mtime }] }） */
export interface AgentOutputFile {
  name: string
  size: number
  mtime: number
}

/**
 * 列出 output/ 里的文件 —— 抓取**前**取一次，跑完做差集，只把本次产出送进导入预览。
 *
 * 为什么必须做差集：助手的 `result.outputs` 是「output/ 里最近的几个文件」，**不是本次产出**。
 * 2026-10-03 用户视角实测：只抓到 5 条，界面却按 2 个文件 / 10 条弹导入预览。
 * 这条修法只用**已有**接口，所以不用用户更新助手包。
 */
export async function listOutputs(): Promise<AgentOutputFile[]> {
  const body = await call<{ files: AgentOutputFile[] }>('/outputs')
  return body.files ?? []
}

/**
 * 只留本次抓取**真正新写出**的产出。
 *
 * 为什么要它：助手的 `result.outputs` 是「output/ 里最近的几个文件」，**不是本次产出**。
 * 2026-10-03 用户视角实测：第二次抓取（爬虫去重后 0 条新增、根本不写文件）界面却按 10 条弹导入预览。
 *
 * 判据必须用 **mtime**（`/outputs` 提供了），不能只比文件名 —— 同名重写是真实存在的：
 *   · 文件名不在快照里      → 本次新建 ✓
 *   · 同名但 mtime 变新     → 本次重写 ✓
 *   · 同名且 mtime 没变      → 本次没写它 ✗（去重跳过时不写文件）
 * before 为 null（快照没取到）→ 原样返回，退化成旧行为，绝不把结果吞掉。
 * **返回空数组 = 本次没有新岗位**，界面要如实这么说，不许拿旧文件冒充新结果。
 */
export function freshOutputs<T extends { file: string }>(
  all: T[],
  before: ReadonlyMap<string, number> | null,
  after?: ReadonlyMap<string, number>,
): T[] {
  if (!before) return all
  return all.filter((o) => {
    const was = before.get(o.file)
    if (was === undefined) return true
    const now = after?.get(o.file)
    return now !== undefined && now > was
  })
}

/** 浏览器「本地网络访问」权限状态；查不到就 unknown（不猜） */
export async function lnaPermissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const api = (navigator as unknown as { permissions?: { query?: (d: { name: string }) => Promise<{ state: string }> } }).permissions
    const st = await api?.query?.({ name: 'local-network-access' })
    const s = st?.state
    return s === 'granted' || s === 'denied' || s === 'prompt' ? s : 'unknown'
  } catch {
    return 'unknown'
  }
}

export interface LnaHelp {
  browser: string
  /** 设置页地址（浏览器设置页不能点链接跳转，界面给「复制」按钮） */
  deepLink: string
  /** 手动路径：不依赖深链接是否有效 */
  path: string
}

/**
 * 按浏览器给「怎么放行本地网络访问」的指引。
 *
 * 为什么需要：2026-10-03 实测 —— Edge 142 起，从线上 https 页面访问 127.0.0.1 要单独授权
 *（Edge 叫「设备上的应用」/ loopback-network）。**没授权时请求会停在权限提示上，fetch 既不
 * resolve 也不 reject**，界面只能超时；而很多浏览器根本不弹提示，用户无从下手。
 */
export function lnaHelpFor(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): LnaHelp {
  if (/Edg\//.test(ua)) {
    return {
      browser: 'Edge',
      deepLink: 'edge://settings/privacy/sitePermissions/allPermissions/loopbackNetwork',
      path: '设置 → Cookie 和网站权限 → 所有权限 → 「设备上的应用」→ 允许',
    }
  }
  if (/Chrome\//.test(ua)) {
    return {
      browser: 'Chrome',
      deepLink: 'chrome://settings/content/localNetworkAccess',
      path: '设置 → 隐私和安全 → 网站设置 → 更多权限 → 「本地网络访问」→ 允许',
    }
  }
  return {
    browser: '这个浏览器',
    deepLink: '',
    path: '站点权限里找到「本地网络访问 / 设备上的应用 / Local network access」并允许',
  }
}

/** 发起抓取。400/409 等按契约把 error 文案原样抛出，由界面提示 */
export function startCrawl(opts: CrawlStartOptions): Promise<CrawlStartResult> {
  return call('/crawl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sites: opts.sites,
      keyword: opts.keyword ?? '',
      pages: opts.pages ?? 1,
      limit: opts.limit ?? 20,
      mode: opts.mode ?? 'all',
      detail: opts.detail ?? 0,
    }),
  })
}

/** 轮询用：每秒一次，log 增量回显；state 到 done/failed 后由调用方停止轮询 */
export function getTask(taskId: string): Promise<CrawlTask> {
  return call(`/crawl/${encodeURIComponent(taskId)}`)
}

/**
 * 岗位 JSON → 现有的批量导入文本格式（契约钉死，别另造）：
 *
 *   公司：…
 *   岗位：…
 *   工作地点：…
 *   薪资：…
 *   截止日期：…
 *   https://岗位链接
 *
 *   （JD 原文，抓取器给了才拼）
 *
 *   ---
 *
 *   （第二个岗位……）
 *
 * 块间用单独一行的 --- 分隔 —— 既有的 splitJobBlocks 认这个分隔线，
 * 拼出来的文本能被 guessFromBlock 无损读回（契约测试验证这一点），
 * 于是可以直接送进 JobImportModal 走既有入库链路。
 */
export function jobsToImportText(jobs: AgentJob[]): string {
  const blocks = jobs.map((j) => {
    const lines = [
      j.company ? `公司：${j.company}` : '',
      j.title ? `岗位：${j.title}` : '',
      j.city ? `工作地点：${j.city}` : '',
      j.salary ? `薪资：${j.salary}` : '',
      j.deadline ? `截止日期：${j.deadline}` : '',
      j.url || '',
    ].filter(Boolean)
    const raw = String(j.raw ?? '').trim()
    return raw ? `${lines.join('\n')}\n\n${raw}` : lines.join('\n')
  })
  return blocks.filter(Boolean).join('\n\n---\n\n')
}
