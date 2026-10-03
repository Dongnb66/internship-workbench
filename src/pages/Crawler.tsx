import { useEffect, useMemo, useRef, useState } from 'react'
import JobImportModal from '../components/JobImportModal'
import { Field } from '../components/ui'
import { errText } from '../cloud'
import { listRows } from '../lib/api'
import { crawlFailureHint, crawlOutputHint, buildCrawlPlan } from '../lib/crawlTask'
import { crawlSitesForPicker, type CrawlSite } from '../lib/crawlSites'
import { getTask, jobsToImportText, listSites, probe, startCrawl, type AgentHealth, type CrawlTask } from '../lib/localAgent'
import { notifyErr, notifyOk } from '../lib/toast'
import type { PageProps } from './Overview'
import type { Row } from '../types'

const CHANNEL_GROUPS = ['官网投递', 'BOSS直聘', '实习僧', '牛客']

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
  const [selected, setSelected] = useState<string[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [keyword, setKeyword] = useState('')
  const [pages, setPages] = useState(2)
  const [limit, setLimit] = useState(60)
  const [mode, setMode] = useState<'all' | 'intern' | 'campus'>('all')

  // —— 本地助手（一键抓取）——
  const [agentState, setAgentState] = useState<'checking' | 'off' | 'on'>('checking')
  /** 探测失败的原因：卡住（浏览器本地网络权限）和「助手没跑」要给不同的话 */
  const [agentError, setAgentError] = useState<string | null>(null)
  /** 助手自检：装得不完整时，缺什么 / 怎么补要显示在点按钮之前 */
  const [agentProblems, setAgentProblems] = useState<AgentHealth['problems']>([])
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

  async function probeAgent() {
    setAgentState('checking')
    setAgentError(null)
    try {
      const health = await probe()
      setAgentBusy(health.busy)
      setAgentProblems(health.problems ?? [])
      setAgentState('on')
      // 站点数只是给用户一个「两端连的是同一份抓取器」的确认，读不到不影响主流程
      try {
        setAgentSiteCount((await listSites()).length)
      } catch {
        setAgentSiteCount(0)
      }
    } catch (error) {
      setAgentError(errText(error))
      setAgentState('off')
    }
  }

  useEffect(() => {
    void probeAgent()
  }, [])

  /** 跑完的产出 → 现有导入文本格式 → 打开既有「批量导入」弹窗（入库零新代码） */
  async function deliverResult(t: CrawlTask) {
    const jobs = (t.result?.outputs ?? []).flatMap((o) => o.jobs ?? [])
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
  const totalJobs = task?.result?.outputs.reduce((n, o) => n + (o.count || o.jobs.length), 0) ?? 0

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
            <button className="btn sm" onClick={() => void probeAgent()}>
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
            </div>
          ) : null}

          {agentState === 'off' ? (
            <div className="hint warn mb8">
              {agentError ?? '本地助手没在跑，「开始抓取」用不了。'}
              <br />
              在本机项目根目录另开一个终端执行下面的命令，再点「重新检测」：
              <pre className="mono" style={{ ...PRE_STYLE, marginTop: 8 }}>npm run agent</pre>
              <div className="row mt8">
                <button className="btn sm" onClick={() => copyText('npm run agent', '已复制，在项目根目录的终端里粘贴运行')}>
                  复制命令
                </button>
                <span className="small muted">第一次跑要先装抓取器依赖：crawler/ 目录下 npm install。</span>
              </div>
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
              {task.state === 'done' && task.result?.outputs.length ? (
                <div className="small muted mt8">
                  共 {totalJobs} 条：{task.result.outputs.map((o) => `${o.file}（${o.count} 条）`).join('、')}
                </div>
              ) : null}
              {task.state === 'failed' ? <div className="small muted mt8">{crawlFailureHint(task)}</div> : null}
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
