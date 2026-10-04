import { useEffect, useMemo, useRef, useState } from 'react'
import JobImportModal from '../components/JobImportModal'
import { Field } from '../components/ui'
import { errText } from '../cloud'
import { listRows } from '../lib/api'
import { crawlFailureHint, crawlOutputHint, buildCrawlPlan, CRAWLER_PREFS_KEY, parseCrawlerPrefs, serializeCrawlerPrefs } from '../lib/crawlTask'
import { crawlSitesForPicker, type CrawlSite } from '../lib/crawlSites'
import { AGENT_DOWNLOAD_URL, AGENT_PORTABLE_URL, AgentTimeoutError, freshOutputs, getTask, jobsToImportText, listOutputs, listSites, lnaHelpFor, lnaPermissionState, openBridge, probe, startCrawl, type AgentHealth, type CrawlTask, type CrawlTaskOutput } from '../lib/localAgent'
import { notifyErr, notifyOk } from '../lib/toast'
import type { PageProps } from './Overview'
import type { Row } from '../types'

const CHANNEL_GROUPS = ['官网投递', 'BOSS直聘', '实习僧', '牛客']

/** 助手没在跑时自动重试探测：每 5 秒一次、最多 24 次（约 2 分钟）—— 装好即自动变绿 */
const AUTO_PROBE_MS = 5000
const AUTO_PROBE_MAX = 24

const VERDICT_BADGE: Record<CrawlSite['verified'], { label: string; cls: string }> = {
  live: { label: '实测可用', cls: 'badge ok' },
  '': { label: '未验证', cls: 'badge' },
  offline: { label: '实测抓不到', cls: 'badge warn' },
}

const PRE_STYLE = { background: 'var(--bg-soft, #f5f5f5)', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 13 } as const

/**
 * 抓取任务页：两条等价的路，终点都是既有的「批量导入」。
 *
 * 一键（本地助手）：网页调用户本机的 crawler/agent/server.mjs（只监听 127.0.0.1，
 * 不对外暴露、不碰凭据）—— 勾站点点按钮 → 助手在本机唤起 run.mjs → 日志每秒轮询
 * 回显 → 跑完把产出拼成导入文本送进 JobImportModal，入库链路零新代码。
 * 这条路把「开终端 / cd / npm install / 记参数 / 看不到进度 / 找文件」六个卡点全消掉。
 *
 * 手动（命令生成器）：兜底路径。抓取要用真浏览器 + 用户自己的登录态（BOSS 直聘
 * 那类站点风控很重，任何绕风控的方案都不稳也不该做），工作台是静态站、没有能跑
 * 浏览器的服务端，所以形态是生成一条命令，用户在自己电脑的终端里粘一下。
 * 抓取器本体在 crawler/。
 */
export default function Crawler({ profile, onChanged }: PageProps) {
  const sites = useMemo(() => crawlSitesForPicker(), [])
  /** 上次抓取的站点/关键词/参数（设备级 localStorage；解析失败退化成默认值） */
  const initialPrefs = useMemo(() => {
    let raw: string | null = null
    try {
      raw = localStorage.getItem(CRAWLER_PREFS_KEY)
    } catch {
      raw = null // 隐私模式等禁掉 localStorage：退化成默认值，不影响抓取
    }
    return parseCrawlerPrefs(raw, sites.map((s) => s.id))
  }, [sites])
  const [selected, setSelected] = useState<string[]>(() => initialPrefs.sites)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [keyword, setKeyword] = useState(() => initialPrefs.keyword)
  const [pages, setPages] = useState(() => initialPrefs.pages)
  const [limit, setLimit] = useState(() => initialPrefs.limit)
  const [mode, setMode] = useState<'all' | 'intern' | 'campus'>(() => initialPrefs.mode)

  // —— 本地助手（一键抓取）——
  const [agentState, setAgentState] = useState<'checking' | 'off' | 'on'>('checking')
  /** 探测失败的原因：卡住（浏览器本地网络权限）和「助手没跑」要给不同的话 */
  const [agentError, setAgentError] = useState<string | null>(null)
  /** 助手自检：装得不完整时，缺什么 / 怎么补要显示在点按钮之前 */
  const [agentProblems, setAgentProblems] = useState<AgentHealth['problems']>([])
  /** 助手是否上报自检字段（ready）；老版本助手没有这个字段 → undefined，用来提示「该更新了」 */
  const [agentReady, setAgentReady] = useState<boolean | undefined>(undefined)
  /** 探测是「超时」（多半是浏览器权限闸门）还是真的连不上 —— 两者下一步指引完全不同 */
  const [agentTimeout, setAgentTimeout] = useState(false)
  /** 浏览器「本地网络访问」权限状态；unknown = 查不到，不猜 */
  const [lnaState, setLnaState] = useState<'granted' | 'denied' | 'prompt' | 'unknown'>('unknown')
  /** 抓取前 output/ 的快照（文件名 → mtime）：跑完用它筛出「本次产出」 */
  const outputsBeforeRef = useRef<Map<string, number> | null>(null)
  /** 桥接窗口（绕过浏览器「本地网络访问」权限）：closed / connecting / open */
  const [bridgeUi, setBridgeUi] = useState<'closed' | 'connecting' | 'open'>('closed')
  /** 本次真正新写出的产出（界面显示与导入都用它，别拿旧文件冒充新结果） */
  const [freshResult, setFreshResult] = useState<CrawlTaskOutput[]>([])
  const [agentBusy, setAgentBusy] = useState<string | null>(null)
  const [agentSiteCount, setAgentSiteCount] = useState(0)
  const [task, setTask] = useState<CrawlTask | null>(null)
  const [command, setCommand] = useState('')
  const [starting, setStarting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [existing, setExisting] = useState<Row[]>([])
  const logRef = useRef<HTMLPreElement>(null)

  const urlSites = sites.filter((s) => s.urlOnly)
  /** 「指定地址」类站点走 --url，助手的 /crawl 契约里没有这个参数，一键抓取带不了 */
  const hasUrlFilled = urlSites.some((s) => (urls[s.id] ?? '').trim())
  const plan = useMemo(
    () =>
      buildCrawlPlan(sites, {
        siteIds: selected,
        urls: urlSites.map((s) => ({ siteId: s.id, url: urls[s.id] ?? '' })),
        keyword,
        pages,
        limit,
        mode,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sites, selected, urls, keyword, pages, limit, mode],
  )

  /** output/ 的 文件名 → mtime 快照；取不到返回 null，让调用方退化成旧行为 */
  async function outputSnapshot(): Promise<Map<string, number> | null> {
    try {
      return new Map((await listOutputs()).map((o) => [o.name, o.mtime]))
    } catch {
      return null
    }
  }

  async function probeAgent() {
    setAgentState('checking')
    setAgentError(null)
    try {
      const health = await probe()
      setAgentBusy(health.busy)
      setAgentProblems(health.problems ?? [])
      setAgentReady(health.ready)
      setAgentTimeout(false)
      setAgentState('on')
      // 站点数只是给用户一个「两端连的是同一份抓取器」的确认，读不到不影响主流程
      try {
        setAgentSiteCount((await listSites()).length)
      } catch {
        setAgentSiteCount(0)
      }
    } catch (error) {
      setAgentError(errText(error))
      setAgentReady(undefined)
      setAgentTimeout(error instanceof AgentTimeoutError)
      if (error instanceof AgentTimeoutError) setLnaState(await lnaPermissionState())
      setAgentState('off')
    }
  }

  useEffect(() => {
    void probeAgent()
  }, [])

  /** 跑完的产出 → 现有导入文本格式 → 打开既有「批量导入」弹窗（入库零新代码） */
  async function deliverResult(t: CrawlTask) {
    // 只导本次产出：服务端把 output/ 里最近几个文件都算进来，不过滤的话第二次抓取起会把上一批
    // 一起塞进导入预览（2026-10-03 实测：本次 0 条新增，界面却「共 10 条」）
    const fresh = freshOutputs(t.result?.outputs ?? [], outputsBeforeRef.current, await outputSnapshot())
    setFreshResult(fresh)
    if (!fresh.length) {
      notifyErr(
        outputsBeforeRef.current
          ? '本次没有新增岗位 —— 爬虫会跳过已见过的岗位（output/.seen-*.json）。换个关键词，或删掉那些 .seen 文件再抓。'
          : '抓取结束，但没有读到岗位数据 —— 看看下面的日志里提示了什么',
      )
      return
    }
    const jobs = fresh.flatMap((o) => o.jobs ?? [])
    if (!jobs.length) {
      notifyErr('抓取结束，但没有读到岗位数据 —— 看看下面的日志里提示了什么')
      return
    }
    try {
      setExisting(await listRows('jobs', { limit: 500 }))
    } catch {
      setExisting([]) // 查重名单拿不到就降级为不查重，别挡着入库
    }
    setImportText(jobsToImportText(jobs))
    setImportOpen(true)
  }

  // 任务在跑：每 1 秒轮询一次，把 log 增量刷出来 —— 这是「看不到跑到哪了」卡点的解药。
  // 依赖 task 本身：setTask 触发下一轮 timeout，state 离开 running 后自然停。
  useEffect(() => {
    if (!task || task.state !== 'running') return
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const next = await getTask(task.id)
          if (cancelled) return
          setTask(next)
          if (next.state === 'done') await deliverResult(next)
        } catch (error) {
          if (cancelled) return
          // 轮询断掉 = 助手中途退出了：把任务标成失败，别让界面永远转圈
          setTask((prev) => (prev ? { ...prev, state: 'failed', error: errText(error) } : prev))
        }
      })()
    }, 1000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [task])

  /** 下载/安装助手期间自动重试探测：装好了一起来就自动变绿，不用用户手动点「重新检测」 */
  const [autoProbeTries, setAutoProbeTries] = useState(0)
  useEffect(() => {
    if (agentState !== 'off' || autoProbeTries >= AUTO_PROBE_MAX) return
    const timer = setTimeout(() => {
      setAutoProbeTries((n) => n + 1)
      void probeAgent()
    }, AUTO_PROBE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentState, autoProbeTries])

  // 记住上次的站点/关键词/参数：第二次抓取不用重新勾、重新打（2026-10-03 用户视角实测的卡点）
  useEffect(() => {
    try {
      localStorage.setItem(CRAWLER_PREFS_KEY, serializeCrawlerPrefs({ sites: selected, keyword, pages, limit, mode }))
    } catch {
      /* localStorage 被禁：不影响抓取，只是记不住 */
    }
  }, [selected, keyword, pages, limit, mode])

  // 日志追加时自动滚到底，始终看最新的一行
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [task?.log.length])

  async function startAgentCrawl() {
    if (!selected.length) {
      notifyErr('先在「选站点」里勾选至少一个站点')
      return
    }
    if (hasUrlFilled) {
      notifyErr('「指定地址」类站点一键抓取带不了，请用下方生成的命令方式，或清空地址后重试')
      return
    }
    setStarting(true)
    try {
      // 抓取前记下 output/ 的快照：跑完按「新文件名 / 同名但 mtime 变新」筛出本次产出
      outputsBeforeRef.current = await outputSnapshot()
      setFreshResult([])
      const res = await startCrawl({ sites: selected, keyword: keyword.trim(), pages, limit, mode })
      setCommand(res.command)
      setTask({
        id: res.taskId,
        args: res.command,
        state: 'running',
        startedAt: Date.now(),
        endedAt: null,
        log: [],
        error: null,
        result: null,
      })
    } catch (error) {
      // 409「已有一个抓取在跑」这类错误按契约提示出来，不静默
      notifyErr(errText(error))
    } finally {
      setStarting(false)
    }
  }

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function copyText(text: string, okMsg: string) {
    void navigator.clipboard.writeText(text).then(
      () => notifyOk(okMsg),
      () => notifyErr('复制失败，请手动选择命令文本复制'),
    )
  }

  const taskRunning = task?.state === 'running'
  /**
   * 下载入口的锚点。AGENT_DOWNLOAD_URL 为空（还没托管）时整条不渲染。
   *
   * 2026-10-03 补：它原来只在「助手没在跑」与「装得不完整」两处出现，于是**旧版助手**
   * （没有自检字段、连通性正常）的用户在界面上没有任何入口能拿到新包 —— 发起人刷新页面就撞上了这个洞。
   * 现在改成：卡片底部常驻一条 + 旧版本主动提示 + 上面两处照旧。
   */
  const downloadAnchor = AGENT_DOWNLOAD_URL ? (
    <a href={AGENT_DOWNLOAD_URL} target="_blank" rel="noreferrer">
      下载本地助手安装包（.exe，双击即装）
    </a>
  ) : null
  /** 手动安装那条路（zip + 双击 start-hidden.vbs） */
  const portableAnchor = AGENT_PORTABLE_URL ? (
    <a href={AGENT_PORTABLE_URL} target="_blank" rel="noreferrer">
      手动安装（zip）
    </a>
  ) : null
  /** 装不上 / 装坏了时用的块级版本（带换行） */
  const packageLink = downloadAnchor ? <div className="mt8">{downloadAnchor}</div> : null
  /** 超时指引：按当前浏览器给设置路径（设置页不能点链接跳转 → 给复制按钮） */
  const lnaHelp = lnaHelpFor()
  const lnaStateLabel = { granted: '已允许', denied: '已被拒绝', prompt: '还没决定', unknown: '查不到' }[lnaState]
  const totalJobs = freshResult.reduce((n, o) => n + (o.count || o.jobs.length), 0)

  return (
    <div className="grid" style={{ gap: 14 }}>
      <section className="card">
        <div className="card-head">
          <h3>一键抓取（本地助手）</h3>
          <span className="spacer" />
          {agentState === 'on' ? (
            <span className={agentProblems?.length ? 'badge warn' : 'badge ok'}>
              本地助手已连接{agentSiteCount ? ` · ${agentSiteCount} 个站点` : ''}</span>
          ) : agentState === 'checking' ? (
            <span className="badge">正在探测本地助手…</span>
          ) : (
            <button className="btn sm" onClick={() => { setAutoProbeTries(0); void probeAgent() }}>
              重新检测
            </button>
          )}
        </div>
        <div className="card-body">
          {agentProblems?.length ? (
            <div className="hint warn mb8">
              <strong>本地助手装得不完整，现在抓一定会失败：</strong>
              {agentProblems.map((p) => (
                <div key={p.code} style={{ marginTop: 6 }}>
                  · {p.message}
                  <pre className="mono" style={{ ...PRE_STYLE, marginTop: 4 }}>{p.fix}</pre>
                </div>
              ))}
              按上面的「修」补齐后，点右上角「重新检测」再试。
              {packageLink}
            </div>
          ) : null}

          {agentState === 'on' && !agentProblems?.length && agentReady === undefined ? (
            <div className="hint mb8">
              这台本地助手是<strong>旧版本</strong>（它不上报自检信息）：抓取本身还能用，但缺件时不会提前告诉你。
              建议{downloadAnchor ?? '更新到最新版'}覆盖安装一次。
            </div>
          ) : null}

          {agentState === 'off' ? (
            <div className="hint warn mb8">
              {agentError ?? '本地助手没在跑，「开始抓取」用不了。'}
              {downloadAnchor ? (
                <div className="mt8">
                  <strong>装上它只要一次双击：</strong>
                  <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
                    <li>点上面的「下载本地助手安装包（.exe）」</li>
                    <li>
                      双击那个 exe。首次可能弹「Windows 已保护你的电脑」→ 点「更多信息」→「仍要运行」（没签名，属正常）
                    </li>
                    <li>等它提示「安装完成」（它会自己启动助手、并设为开机自启），回到本页即可 —— 这页会自动变绿</li>
                  </ol>
                  <div className="mt8">
                    不想跑安装包？{portableAnchor ?? '手动装 zip'}：右键 zip → 属性 → 勾「解除锁定」→ 解压 → 双击
                    <span className="mono"> start-hidden.vbs</span>。
                  </div>
                </div>
              ) : (
                packageLink
              )}
              {autoProbeTries > 0 ? (
                <div className="small muted mt8">
                  已自动重试 {autoProbeTries}/{AUTO_PROBE_MAX} 次（每 {AUTO_PROBE_MS / 1000} 秒一次）—— 助手一起来这页会自动变绿。
                </div>
              ) : null}
              {bridgeUi !== 'open' ? (
                <div className="row mt8">
                  <button
                    className="btn sm"
                    disabled={bridgeUi === 'connecting'}
                    onClick={() => {
                      void (async () => {
                        setBridgeUi('connecting')
                        try {
                          await openBridge()
                          setBridgeUi('open')
                          notifyOk('已通过桥接窗口连上（那个小窗留着，最小化即可）')
                          setAutoProbeTries(0)
                          void probeAgent()
                        } catch (error) {
                          setBridgeUi('closed')
                          notifyErr(errText(error))
                        }
                      })()
                    }}
                  >
                    {bridgeUi === 'connecting' ? '正在打开桥接窗口…' : '用桥接窗口连上（不用改浏览器设置）'}
                  </button>
                  <span className="small muted">
                    会弹一个小窗，由它替本页与助手通信 —— 绕开「本地网络访问」那道权限。
                  </span>
                </div>
              ) : null}
              {agentTimeout ? (
                <div className="mt8">
                  <strong>多半是浏览器把「本地网络访问」挡住了</strong>（当前状态：{lnaStateLabel}）。
                  放行方法（{lnaHelp.browser}）：{lnaHelp.path}；放行后点右上角「重新检测」。
                  {lnaHelp.deepLink ? (
                    <div className="row mt8">
                      <button
                        className="btn sm"
                        onClick={() =>
                          copyText(lnaHelp.deepLink, '已复制设置地址 —— 粘到地址栏打开（浏览器设置页不能点链接跳转）')
                        }
                      >
                        复制设置地址
                      </button>
                      <span className="small muted mono">{lnaHelp.deepLink}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <details className="mt8">
                <summary className="small muted">进阶：从仓库源码跑（需要 Node 和仓库，普通用户用上面的 zip）</summary>
                <pre className="mono" style={{ ...PRE_STYLE, marginTop: 8 }}>npm run agent</pre>
                <div className="row mt8">
                  <button className="btn sm" onClick={() => copyText('npm run agent', '已复制，在项目根目录的终端里粘贴运行')}>
                    复制命令
                  </button>
                  <span className="small muted">第一次跑要先装抓取器依赖：crawler/ 目录下 npm install。</span>
                </div>
              </details>
            </div>
          ) : null}

          <div className="row">
            <button
              className="btn primary"
              disabled={agentState !== 'on' || starting || taskRunning || !selected.length || hasUrlFilled}
              onClick={() => void startAgentCrawl()}
            >
              {taskRunning ? '抓取进行中…' : starting ? '启动中…' : `开始抓取（已选 ${selected.length} 个站点）`}
            </button>
            {agentState === 'on' && agentBusy && !task ? (
              <span className="small" style={{ color: '#d97706' }}>本地助手正忙（任务 {agentBusy}），等它结束再开新的。</span>
            ) : null}
          </div>
          {bridgeUi === 'open' ? (
            <div className="small mt8" style={{ color: '#0a7f3f' }}>
              正通过<b>桥接窗口</b>连接（那个小窗留着别关；关掉就要重新点一次「用桥接窗口连上」）。
            </div>
          ) : null}
          {agentState === 'checking' ? (
            <div className="small muted mt8">
              探测中。若浏览器在地址栏弹出「本地网络访问 / 设备上的应用」的授权提示，点「允许」——
              从线上站访问 127.0.0.1 要过这道权限，没给的话请求会一直挂着。
            </div>
          ) : null}
          {!selected.length ? (
            <div className="small muted mt8">
              用下面「选站点 / 任务参数」里勾选的站点和参数；关键词、页数、条数都是同一套。
            </div>
          ) : null}
          {hasUrlFilled ? (
            <div className="small mt8" style={{ color: '#d97706' }}>
              「指定地址」里有没清空的地址，一键抓取带不了它们 —— 要抓这类请用下方手动命令方式。
            </div>
          ) : null}
          {downloadAnchor ? (
            <div className="small muted mt8">
              没装过、或抓取报「装得不完整」？{downloadAnchor}（双击即装）；
              {portableAnchor ? <>或{portableAnchor} —— 解压后双击 start-hidden.vbs。</> : null}
            </div>
          ) : null}

          {task ? (
            <div className="mt16" style={{ borderTop: '1px solid var(--border, #e5e5e5)', paddingTop: 12 }}>
              <div className="row mb8">
                <span className={task.state === 'done' ? 'badge ok' : task.state === 'failed' ? 'badge warn' : 'badge'}>
                  {task.state === 'running' ? '进行中' : task.state === 'done' ? '已完成' : '失败'}
                </span>
                <span className="small muted">任务 {task.id}</span>
                {task.endedAt ? <span className="small muted">耗时 {Math.max(1, Math.round((task.endedAt - task.startedAt) / 1000))} 秒</span> : null}
                <span className="spacer" />
                {task.state === 'done' && importText ? (
                  <button className="btn sm" onClick={() => setImportOpen(true)}>
                    打开导入预览（{totalJobs} 条）
                  </button>
                ) : null}
              </div>
              {command || task.args ? (
                <pre className="mono" style={{ ...PRE_STYLE, marginBottom: 8 }} title="实际执行的抓取命令">
                  {command || task.args}
                </pre>
              ) : null}
              {task.error ? <div className="hint warn mb8">{task.error}</div> : null}
              <pre ref={logRef} className="mono" style={{ ...PRE_STYLE, maxHeight: 260 }}>
                {task.log.length ? task.log.join('\n') : '（等待抓取器输出…）'}
              </pre>
              {task.state === 'done' && freshResult.length ? (
                <div className="small muted mt8">
                  共 {totalJobs} 条：{freshResult.map((o) => `${o.file}（${o.count} 条）`).join('、')}
                </div>
              ) : null}
              {task.state === 'failed' ? (
                <div className="mt8">
                  <div className="small muted">{crawlFailureHint(task)}</div>
                  {agentState === 'on' ? (
                    <div className="row mt8">
                      <button className="btn sm" onClick={() => void startAgentCrawl()}>用上次的参数重试</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>怎么用（两条路）</h3>
        </div>
        <div className="card-body md" style={{ fontSize: 13 }}>
          <strong>一键（推荐）：</strong>本地助手已连接时，在上面点「开始抓取」就行 —— 日志实时滚动，跑完自动弹出入库预览。
          <br />
          <strong>手动（备用）：</strong>
          <br />
          <strong>1.</strong> 下面选站点、填关键词，复制生成的命令；
          <br />
          <strong>2.</strong> 在你自己电脑的终端里粘贴运行（需要 Node 18+，仓库 crawler/ 目录下第一次跑先 `npm install`）；
          <br />
          <strong>3.</strong> 抓完后回到「岗位池 → 批量导入」，选择 crawler/output/ 里的 JSON 文件，预览后入库。
          <div className="small muted mt8">
            为什么抓取必须在你电脑上：要用真浏览器打开招聘页、用你自己的登录态（尤其 BOSS
            直聘），云服务器既没有你的登录态，绕风控的方案也不稳定、不该做。本机跑只读「你在浏览器里能看见的那一屏」，串行慢速不并发。
            本地助手也只是「在你电脑上唤起抓取器」的本地进程：只监听 127.0.0.1，不碰你的账号密码，入库由网页带着你自己的登录态完成。
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>选站点</h3>
          <span className="spacer" />
          <span className="small muted">已选 {selected.length + Object.values(urls).filter((v) => v.trim()).length} 个</span>
          {selected.length ? (
            <button className="btn sm ghost" onClick={() => setSelected([])}>
              清空
            </button>
          ) : null}
        </div>
        <div className="card-body">
          {CHANNEL_GROUPS.map((group) => {
            const groupSites = sites.filter((s) => s.channel === group)
            if (!groupSites.length) return null
            return (
              <div key={group} style={{ marginBottom: 10 }}>
                <div className="small muted mb8">{group}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {groupSites.map((s) => {
                    const active = selected.includes(s.id)
                    const badge = VERDICT_BADGE[s.verified]
                    return (
                      <button
                        key={s.id}
                        className={active ? 'btn sm primary' : 'btn sm'}
                        onClick={() => toggle(s.id)}
                        title={
                          s.needsLogin
                            ? '需要先在本机登录一次'
                            : s.verified === 'offline'
                              ? '实测抓不到有效岗位，仅作参考'
                              : s.kwSearch
                                ? '关键词会进搜索参数'
                                : '固定入口页，整页抓取'
                        }
                        style={s.verified === 'offline' && !active ? { opacity: 0.55 } : undefined}
                      >
                        {s.name}
                        {s.needsLogin ? ' 🔒' : ''}
                        {s.kwSearch ? ' 🔍' : ''}
                        <span className={badge.cls} style={{ marginLeft: 6 }}>{badge.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <div className="small muted">
            🔒 = 需要先在本机跑 `node login.mjs --site &lt;站点id&gt;` 登录一次，抓取器只复用你已登录的会话，不碰账号密码。
            🔍 = 支持关键词搜索；不带 🔍 的站点是固定入口页，整页抓取，关键词对它们无效。
          </div>
        </div>
      </section>

      {urlSites.length ? (
        <section className="card">
          <div className="card-head">
            <h3>指定地址（托管页 / 任意页面）</h3>
          </div>
          <div className="card-body">
            <div className="hint mb16">
              这几类站点没有入口地址（飞书 / 北森是给公司托管校招页的，每家地址都不同）：把目标公司的招聘页地址粘进来，抓取器走同一套结构检测。
            </div>
            {urlSites.map((s) => (
              <div className="row mb8" key={s.id}>
                <span className="small" style={{ width: 130, flexShrink: 0 }}>{s.name}</span>
                <input
                  className="input"
                  placeholder="https:// 招聘页地址"
                  value={urls[s.id] ?? ''}
                  onChange={(e) => setUrls({ ...urls, [s.id]: e.target.value })}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="card-head">
          <h3>任务参数</h3>
        </div>
        <div className="card-body">
          <div className="grid grid-2">
            <Field label="岗位关键词" hint="只对 🔍 站点（腾讯/字节/实习僧/BOSS）生效；其余站点整页抓取，关键词被忽略">
              <input className="input" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="如 后端 / Python / AI Agent" />
            </Field>
            <Field label="岗位类型筛选" hint="按标题筛">
              <select className="select" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="all">全部</option>
                <option value="intern">只要实习</option>
                <option value="campus">只要校招</option>
              </select>
            </Field>
            <Field label="每站最多翻几页">
              <input className="input" type="number" min={1} max={20} value={pages} onChange={(e) => setPages(Math.max(1, Math.min(20, Number(e.target.value) || 2)))} />
            </Field>
            <Field label="每站最多产出条数">
              <input className="input" type="number" min={1} max={300} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(300, Number(e.target.value) || 60)))} />
            </Field>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>生成的命令（手动方式）</h3>
          <span className="spacer" />
          {plan.hasContent ? (
            <button className="btn sm primary" onClick={() => copyText(plan.commandLines.join('\n'), '命令已复制，去终端粘贴运行')}>
              复制命令
            </button>
          ) : null}
        </div>
        <div className="card-body">
          {!plan.hasContent ? (
            <div className="muted">先在上面选至少一个站点或填一个地址。</div>
          ) : (
            <>
              {plan.needLoginSites.length ? (
                <div className="hint mb16" style={{ color: '#d97706' }}>
                  ⚠ 本次任务包含需要登录的站点：{plan.needLoginSites.map((s) => s.name).join('、')}。先跑
                  {plan.needLoginSites.map((s) => ` node login.mjs --site ${s.id};`)}登录一次再执行下面的命令。
                </div>
              ) : null}
              <pre className="mono" style={PRE_STYLE}>
                {plan.commandLines.join('\n')}
              </pre>
              <div className="small muted mt8">{crawlOutputHint()}</div>
            </>
          )}
        </div>
      </section>

      {importOpen ? (
        <JobImportModal
          existing={existing}
          profile={profile}
          initialText={importText}
          onClose={() => setImportOpen(false)}
          onDone={async () => {
            await onChanged()
          }}
        />
      ) : null}
    </div>
  )
}
