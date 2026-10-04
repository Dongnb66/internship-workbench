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
/** 安装包：单文件 .exe，双击即装（内嵌整包；装完写开机自启）—— 2026-10-03 新增，普通用户走这条 */
export const AGENT_DOWNLOAD_URL =
  'https://internship-workbench-47024.app.workbuddy.host/downloads/InternshipWorkbench-Agent-Setup.exe'

/** 手动安装那条路（zip + 双击 start-hidden.vbs）：给不想/不能跑 exe 的人留着，也用于排查 */
export const AGENT_PORTABLE_URL =
  'https://internship-workbench-47024.app.workbuddy.host/downloads/internship-workbench-agent.zip'

/**
 * ⚠️ 运维陷阱（2026-10-03 实测，WorkBuddy 报、DSH 复跑）：这两个文件放在发布源树的
 * `public/downloads/` 里，但**都不在 git 里**（本机 `.git/info/exclude` 排除）。少带它们的那次发布
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
  '也可以在卡片上点「用桥接窗口连上」，绕过这道权限。'

// —— 桥接窗口（绕过浏览器「本地网络访问」权限）——
//
// 背景：从线上 https 页面 fetch http://127.0.0.1 要过 LNA 权限；没授权时请求既不 resolve 也不
// reject，界面只能超时。但**顶层导航到 127.0.0.1 是豁免的** —— 所以工作台开一个小窗到助手的
// `/bridge` 页（与助手同源），由它替工作台调接口，再用 postMessage 把结果送回来。
// 代价：多一个小窗（最小化即可）；好处：用户完全不用去翻浏览器设置。
const BRIDGE_READY = 'iw-bridge-ready'
const BRIDGE_REQUEST = 'iw-bridge-request'
const BRIDGE_RESPONSE = 'iw-bridge-response'
/** 桥接页自己报的错（脚本没注进去、初始化抛异常…）—— 没有它，这类失败只能表现为「12 秒没回话」，查不出来 */
const BRIDGE_ERROR = 'iw-bridge-error'
/** 助手 origin（桥接页回包的 origin 必须正好是它） */
const AGENT_ORIGIN = AGENT_BASE

export type BridgeState = 'closed' | 'connecting' | 'open'

let bridgeWin: Window | null = null
let bridgeNonce = ''
let bridgeState: BridgeState = 'closed'
let bridgeOnReady: (() => void) | null = null
let bridgeListening = false
/** 桥接页最后一次自报的错误（界面可以直接显示，比「超时」有用得多） */
let bridgeLastError: string | null = null
const bridgePending = new Map<string, { resolve: (v: { status: number; text: string }) => void; reject: (e: Error) => void }>()

/** 桥接页地址（纯函数，便于单测）：把工作台 origin 与 nonce 带过去 */
export function bridgeUrl(agentBase: string, origin: string, nonce: string): string {
  return `${agentBase}/bridge?origin=${encodeURIComponent(origin)}&nonce=${encodeURIComponent(nonce)}`
}

/** 校验桥接页回包（纯函数）：形状要对、nonce 要对 —— 别的页面塞进来的消息一律不认 */
export function isBridgeMessage(data: unknown, nonce: string): boolean {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  if (d.nonce !== nonce) return false
  if (d.type === BRIDGE_READY) return true
  if (d.type === BRIDGE_ERROR) return typeof d.message === 'string'
  return d.type === BRIDGE_RESPONSE && typeof d.id === 'string'
}

/** 桥接当前可用吗（小窗被关掉就自动降级为 closed，别让调用方卡在死窗口上） */
function bridgeOpenNow(): boolean {
  if (bridgeState !== 'open') return false
  if (bridgeWin && bridgeWin.closed) { bridgeState = 'closed'; return false }
  return true
}

export function getBridgeState(): BridgeState {
  bridgeOpenNow()
  return bridgeState
}

function attachBridgeListener() {
  if (bridgeListening || typeof window === 'undefined') return
  bridgeListening = true
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.origin !== AGENT_ORIGIN) return // 只认助手，别的一律不理
    if (!isBridgeMessage(ev.data, bridgeNonce)) return
    const d = ev.data as Record<string, unknown>
    if (d.type === BRIDGE_READY) {
      bridgeState = 'open'
      if (bridgeOnReady) { bridgeOnReady(); bridgeOnReady = null }
      return
    }
    if (d.type === BRIDGE_ERROR) {
      // 桥接页自己说它坏了（脚本没跑起来 / 初始化抛异常）：如实把它的话交给用户，别只报「超时」
      const why = new Error(`桥接页报错（${String(d.where ?? '?')}）：${String(d.message)}`)
      bridgeState = 'closed'
      if (bridgeOnReady) { bridgeOnReady = null; }
      for (const [, p] of bridgePending) p.reject(why)
      bridgePending.clear()
      bridgeLastError = why.message
      return
    }
    const p = bridgePending.get(d.id as string)
    if (!p) return
    bridgePending.delete(d.id as string)
    if (typeof d.error === 'string' && d.error) p.reject(new Error(d.error))
    else p.resolve({ status: Number(d.status ?? 0), text: String(d.body ?? '') })
  })
}

/**
 * 开桥接窗口。**必须在用户点击里调用**（否则被弹窗拦截）。
 * 返回的 promise 在桥接页 ready 时兑现；被拦下 / 超时则 reject（界面据此给话）。
 */
export function bridgeError(): string | null { return bridgeLastError }

export function openBridge(timeoutMs = 12000): Promise<void> {
  bridgeLastError = null
  const origin = typeof location === 'undefined' ? '' : location.origin
  bridgeNonce = Math.random().toString(36).slice(2) + Date.now().toString(36)
  attachBridgeListener()
  bridgeState = 'connecting'
  bridgeWin = window.open(bridgeUrl(AGENT_BASE, origin, bridgeNonce), 'iw-agent-bridge', 'width=430,height=240')
  if (!bridgeWin) {
    bridgeState = 'closed'
    return Promise.reject(new Error('浏览器把这个小窗拦下了 —— 请允许本站弹出窗口后重试'))
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (bridgeState !== 'open') {
        bridgeState = 'closed'
        reject(new Error(bridgeLastError ?? '桥接窗口 12 秒没有回话（助手没在跑？）'))
      }
    }, timeoutMs)
    bridgeOnReady = () => { clearTimeout(timer); resolve() }
  })
}

/** 回包统一在这里判状态码（直连与桥接两条路都走它，别让两边规则漂移） */
function parseBody<T>(status: number, body: unknown): T {
  if (status < 200 || status >= 300) {
    const msg = (body as { error?: string } | null)?.error
    throw new Error(msg || `本地助手返回 HTTP ${status}`)
  }
  return body as T
}

/** 桥接回的是文本（跨窗口只能传字符串），这里解析后再走同一套判定 */
function parseBridgeText<T>(status: number, text: string): T {
  let body: unknown = null
  try { body = JSON.parse(text) } catch { /* 非 JSON 按 null 走状态码分支 */ }
  return parseBody<T>(status, body)
}

/** 走桥接窗口调接口：路径经助手校验后才转发，回包按与直连一致的规则解析 */
function bridgeCall<T>(path: string, init?: RequestInit, timeoutMs = CALL_TIMEOUT_MS): Promise<T> {
  if (bridgeState !== 'open' || !bridgeWin) return Promise.reject(new Error('桥接窗口没开着'))
  const id = Math.random().toString(36).slice(2)
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      bridgePending.delete(id)
      reject(new Error(`桥接 ${timeoutMs / 1000} 秒没有回话（小窗关掉了？）`))
    }, timeoutMs)
    bridgePending.set(id, {
      resolve: (r) => { clearTimeout(timer); try { resolve(parseBridgeText<T>(r.status, r.text)) } catch (e) { reject(e as Error) } },
      reject: (e) => { clearTimeout(timer); reject(e) },
    })
    try {
      bridgeWin!.postMessage(
        { type: BRIDGE_REQUEST, nonce: bridgeNonce, id, path, method: init?.method, headers: init?.headers, body: typeof init?.body === 'string' ? init.body : undefined },
        AGENT_ORIGIN,
      )
    } catch (e) {
      bridgePending.delete(id)
      clearTimeout(timer)
      reject(e as Error)
    }
  })
}

/** 超时文案给的是可执行的下一步，不是「失败了」 */

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
  // 桥接窗口开着就直接走它：用户已经明确选了「绕过权限」这条路，别让他再等一次超时
  if (bridgeOpenNow()) return bridgeCall<T>(path, init, timeoutMs)
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
  // 409「已有一个抓取在跑」这类契约约定要提示而不是静默失败的错误，原样抛给人看
  return parseBody<T>(res.status, body)
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
/** 定时抓取：上次自动跑的结果（网页用它显示「今天新增 N 条」并一键导入） */
export interface AgentScheduleLastRun {
  day: string
  at: string
  ok: boolean
  newJobs: number
  files?: string[]
  taskId?: string
}

/** 定时抓取配置（助手侧持久化在 crawler/.schedule.json；默认关闭） */
export interface AgentSchedule {
  enabled: boolean
  at: string
  sites: string[]
  keyword: string
  pages: number
  limit: number
  mode: string
  lastRun?: AgentScheduleLastRun | null
}

/**
 * 界面上的「有改动未保存」判定。
 *
 * 为什么需要：原来那块文字是按**编辑中的状态**渲染的，保存失败（比如 403）时照样显示
 * 「每天 12:28 抓 2 个站点」—— 看起来像保存成功，实际没有。保存失败必须看得见。
 */
export function scheduleDirty(
  saved: { enabled: boolean; at: string; sites: string[]; keyword: string } | null,
  editing: { enabled: boolean; at: string; sites: string[]; keyword: string } | null,
): boolean {
  if (!saved || !editing) return true
  return (
    saved.enabled !== editing.enabled ||
    saved.at !== editing.at ||
    saved.keyword !== editing.keyword ||
    // 站点是**集合**不是序列：同样的两个站点换个顺序不算改动（2026-10-04 真机验证时发现的假提示）
    [...saved.sites].sort().join('|') !== [...editing.sites].sort().join('|')
  )
}

export interface ScheduleReply {
  schedule: AgentSchedule
  summary: { enabled: boolean; text: string }
}

/** 读定时抓取配置 */
export function getSchedule(): Promise<ScheduleReply> {
  return call('/schedule')
}

/** 写定时抓取配置（服务端校验：at 必须 HH:MM、sites 必须是站点 id） */
export function saveSchedule(input: Omit<AgentSchedule, 'lastRun'>): Promise<ScheduleReply> {
  return call('/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

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
  after?: ReadonlyMap<string, number> | null,
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
