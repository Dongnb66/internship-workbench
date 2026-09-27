/**
 * 回工作台做验收：对着任务包核对一个**公开** GitHub 仓库（AGENT_PLAN 第四步的另一半）。
 *
 * 边界写死在这里，三条都来自 AGENTS.md：
 * - **只读公开仓库**：只 GET `api.github.com` 的仓库与 README，一律不带凭据。
 *   用户传进来的 header 会被丢弃——凭据一旦从这条路混进来，「只读公开接口」这句话就变成假的。
 * - **查不到 ≠ 没有**：404 / 403 / 限流一律记 `unreachable`，验收结论落到 `unknown`。
 *   把「我没查到」写成「你做得不好」，是这类工具最容易犯也最伤人的一种错。
 * - 结论只陈述事实与缺口，不替用户断言个人短板（§2.2 口径纪律）。
 */
import type { TaskPack } from './mentor'

const API = 'https://api.github.com'
/** owner / repo 的合法字符集。拼 URL 前必须校验，否则 `a/../evil` 这种会把请求打到别的地址上 */
const NAME_OK = /^[A-Za-z0-9_.-]{1,100}$/

export interface RepoFacts {
  owner: string
  repo: string
  /** false = 没能读到仓库信息（找不到、私有、限流、名字不合法） */
  ok: boolean
  error?: string
  /** 读不到 ≠ 没有：验收据此给「无法确认」而不是给「不合格」 */
  unreachable?: boolean
  defaultBranch?: string
  hasReadme: boolean
  readmeText: string
}

/**
 * 只用到 status 与 text()：GitHub 的返回一律先按文本读再自己 parse。
 * 刻意不用 `typeof fetch`——那会让测试替身必须伪装成完整 Response，
 * 也会让人以为可以传 RequestInit 的全部选项（含 headers）。
 * **没有 headers 这个口子**：只读公开接口不需要凭据，类型上一旦允许传，
 * 「我们从不携带凭据」这句话就变成假的。
 */
export type MinimalFetcher = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{ status: number; text: () => Promise<string> }>

export interface FetchOptions {
  /** 只用来注入测试替身 */
  fetchImpl?: MinimalFetcher
}

const realFetch: MinimalFetcher = (url, init) =>
  fetch(url, init as RequestInit).then((res) => ({ status: res.status, text: () => res.text() }))

/**
 * GitHub 的 README 接口给的是 base64 的 **UTF-8 字节流**：
 * 直接 atob 拿到的是 latin1 字符串，中文会变成长串乱码，所以按字节还原再解码。
 */
function decodeBase64(value: unknown): string {
  const raw = String(value ?? '')
  if (!raw) return ''
  try {
    const bin = atob(raw.replace(/\s/g, ''))
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}

async function getJson(url: string, fetchImpl: MinimalFetcher): Promise<{ status: number; body: any }> {
  const res = await fetchImpl(url, {
    method: 'GET',
    // 只带 Accept（这是能力声明，不是凭据）；不接受任何外部 header 透传
    headers: { Accept: 'application/vnd.github+json' },
  })
  const text = await res.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  return { status: res.status, body }
}

export async function fetchRepoFacts(owner: string, repo: string, opts: FetchOptions = {}): Promise<RepoFacts> {
  const fetchImpl = opts.fetchImpl ?? realFetch
  const base: RepoFacts = { owner, repo, ok: false, hasReadme: false, readmeText: '' }

  if (!NAME_OK.test(owner) || !NAME_OK.test(repo)) {
    return { ...base, error: `仓库地址不合法：owner/repo 只能是字母、数字、点、下划线和短横线（收到 ${owner}/${repo}）` }
  }
  if (typeof fetchImpl !== 'function') {
    return { ...base, unreachable: true, error: '当前环境发不出请求，无法确认（不是仓库的问题）' }
  }

  let repoMeta: any = null
  let repoStatus = 0
  try {
    const r = await getJson(`${API}/repos/${owner}/${repo}`, fetchImpl)
    repoStatus = r.status
    repoMeta = r.body
  } catch {
    return { ...base, unreachable: true, error: '网络请求失败，无法确认这个仓库' }
  }

  if (repoStatus === 404) {
    return { ...base, unreachable: true, error: '找不到这个仓库：地址写错、已改名，或它是**私有仓库**（只读通道读不到私有仓库）' }
  }
  if (repoStatus === 403 || repoStatus === 429) {
    return { ...base, unreachable: true, error: '被 GitHub 限流（匿名 60 次/小时），稍后再试；这不代表仓库有问题' }
  }
  if (repoStatus < 200 || repoStatus >= 300) {
    return { ...base, unreachable: true, error: `GitHub 返回 ${repoStatus}，无法确认` }
  }

  let hasReadme = false
  let readmeText = ''
  try {
    const rd = await getJson(`${API}/repos/${owner}/${repo}/readme`, fetchImpl)
    if (rd.status === 200) {
      hasReadme = true
      readmeText = decodeBase64(rd.body?.content)
    } else if (rd.status === 404) {
      hasReadme = false
    } else {
      // README 读失败而仓库读到了：这仍是「无法确认 README」，不能当成「没有 README」
      return { ...base, ok: true, unreachable: true, defaultBranch: repoMeta?.default_branch, hasReadme: false, readmeText: '', error: `README 读不到（GitHub 返回 ${rd.status}），无法确认` }
    }
  } catch {
    return { ...base, ok: true, unreachable: true, defaultBranch: repoMeta?.default_branch, hasReadme: false, readmeText: '', error: 'README 请求失败，无法确认' }
  }

  return {
    owner,
    repo,
    ok: true,
    defaultBranch: repoMeta?.default_branch,
    hasReadme,
    readmeText,
  }
}

export interface AcceptanceItem {
  field: string
  detail: string
}

export interface AcceptanceResult {
  verdict: 'pass' | 'gaps' | 'unknown'
  passed: AcceptanceItem[]
  gaps: AcceptanceItem[]
  /** 只读接口天生看不见的东西，一律要求用户自己核对，不假装判过了 */
  manual: AcceptanceItem[]
}

const RUN_RE = /(安装|运行|启动|使用|getting started|quick start|install|npm |pnpm |yarn |pip |pytest|make |docker|uvicorn|streamlit)/i
const WHY_RE = /(为什么|取舍|设计|权衡|方案对比|decision|tradeoff|why)/i

/**
 * 对着任务包给结论。
 *
 * `unreachable` 时一律 verdict=unknown：验收工具最常见的错是把「我没查到」输出成「你不合格」，
 * 而用户看到的那句话会直接影响他下一步要不要继续做这个项目。
 */
export function checkPackAcceptance(
  pack: TaskPack,
  facts: { hasReadme: boolean; readmeText: string; unreachable?: boolean },
): AcceptanceResult {
  const passed: AcceptanceItem[] = []
  const gaps: AcceptanceItem[] = []
  const manual: AcceptanceItem[] = []
  const text = String(facts.readmeText ?? '')
  const last = pack.steps[pack.steps.length - 1]
  const minTests = last?.acceptance?.minTests ?? 0

  if (facts.unreachable) {
    return {
      verdict: 'unknown',
      passed,
      gaps: [{ field: '仓库信息', detail: '无法确认：这一轮没读到仓库内容（限流 / 私有 / 地址不对），先别改代码，过一会儿再验一次' }],
      manual: [{ field: '本地核对', detail: '在自己的机器上跑一次测试与启动命令，比任何远端只读检查都可靠' }],
    }
  }

  if (facts.hasReadme) {
    passed.push({ field: 'README', detail: '仓库有 README' })
  } else {
    gaps.push({ field: 'README', detail: '没有 README：任务包第 ' + (last?.index ?? 0) + ' 步要求交付它，没有 README 的项目在面试官那里等于没做完' })
  }

  if (!text) {
    gaps.push({ field: '运行说明', detail: 'README 里读不到内容，无法确认怎么装、怎么跑起来' })
  } else if (RUN_RE.test(text)) {
    passed.push({ field: '运行说明', detail: 'README 里有安装 / 启动 / 运行相关章节' })
  } else {
    gaps.push({ field: '运行说明', detail: 'README 没写怎么跑起来：换一台机器照着装不起来的交付，验收不算过' })
  }

  if (text && WHY_RE.test(text)) {
    passed.push({ field: '设计说明', detail: 'README 里有「为什么这样设计 / 取舍」相关内容' })
  } else {
    gaps.push({ field: '设计说明', detail: 'README 缺「为什么这样设计、被否掉的方案是什么」——面试第二轮问的就是这个' })
  }

  manual.push({
    field: '测试条数',
    detail: `只读接口看不到测试跑起来是多少条（要求至少 ${minTests} 条）。请本地跑一次，把命令与条数原样写进 README，别凭印象报数`,
  })
  manual.push({
    field: '能讲清的部分',
    detail: (last?.acceptance?.mustExplain ?? []).join('；') || '按任务包最后一步的问题逐条自己讲一遍',
  })

  return { verdict: gaps.length ? 'gaps' : 'pass', passed, gaps, manual }
}
