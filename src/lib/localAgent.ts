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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${AGENT_BASE}${path}`, init)
  } catch {
    // 连不上时 fetch 抛的是不带业务信息的 TypeError，必须在这里翻译成人话
    throw new Error(`连不上本地助手（${AGENT_BASE}）。在项目根目录执行 npm run agent 启动后重试。`)
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
  return call('/health')
}

/** 站点清单：来自用户本机的 crawler/sites.mjs，可用于确认两端连的是同一份抓取器 */
export async function listSites(): Promise<AgentSite[]> {
  const body = await call<{ sites: AgentSite[] }>('/sites')
  return body.sites
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
