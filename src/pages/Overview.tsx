import { useCallback, useEffect, useRef, useState } from 'react'
import { errText } from '../cloud'
import { Icon } from '../components/Icon'
import { Empty, Stat } from '../components/ui'
import AgentSteps from '../components/AgentSteps'
import { getQuotaSnapshot } from '../lib/ai'
import { listRows, updateRow } from '../lib/api'
import { BYO_SETUP_STEPS, currentAccess } from '../lib/billing'
import { STAGES } from '../lib/constants'
import { daysLeft, fmtDate, fmtDateTime, leftText, recentDays, todayISO } from '../lib/format'
import { todayPicks } from '../lib/daily'
import { DEFAULT_PACE, paceStatus } from '../lib/pace'
import { calibration, funnelStats } from '../lib/funnel'
import { followupDue } from '../lib/followup'
import { AGENT_TOOLS } from '../lib/agentTools'
import { DAILY_TASK_LABEL, runDailyInspection } from '../lib/agentRun'
import type { ActionStep, StopReason } from '../lib/agentLoop'
import { DEFAULT_QUOTA } from '../lib/quota'
import { notifyErr, notifyOk } from '../lib/toast'
import type { Profile, Row } from '../types'

export interface PageProps {
  profile: Profile | null
  onChanged: () => void | Promise<void>
  go: (page: string) => void
}

/** 循环为什么停：每种停止原因给用户不同的下一步（护栏生效不是故障，得说清） */
const STOP_LABEL: Record<StopReason, string> = {
  final_answer: '已完成',
  max_steps: '转满一件事的最大步数，被额度护栏熔断（不是卡住）',
  tool_retries_exhausted: '某个工具连续失败，已停止重试',
  // 原来写的是「多半是今天的 AI 额度用完了」——这是把一种可能当成了默认原因。实际上
  // model_error 的触发面很宽：没接上 AI 通道、Key 失效、余额不足、厂商侧故障都会落到这里，
  // 而在「AI 只走使用者自备 Key」的口径下，本应用根本没有"额度"给使用者用。指一条确定的
  // 排查路径（自检能区分是断在哪一环），比替用户猜原因有用。
  model_error: '模型没跑起来。去「目标条件」页的「AI 通道」点「自检一下」',
  aborted: '已手动停止',
}

export default function Overview({ profile, go }: PageProps) {
  const [jobs, setJobs] = useState<Row[]>([])
  const [apps, setApps] = useState<Row[]>([])
  const [ivs, setIvs] = useState<Row[]>([])
  const [offers, setOffers] = useState<Row[]>([])
  const [tasks, setTasks] = useState<Row[]>([])
  const [msgs, setMsgs] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [j, a, i, o, t, m] = await Promise.all([
        listRows('jobs', { limit: 500 }),
        listRows('applications', { limit: 500 }),
        listRows('interviews', { limit: 500, order: 'scheduled_at', ascending: true }),
        listRows('offers', { limit: 200 }),
        listRows('tasks', { limit: 500, order: 'due_at', ascending: true }),
        listRows('messages', { limit: 1000, order: 'sent_at', ascending: false }),
      ])
      setJobs(j)
      setApps(a)
      setIvs(i)
      setOffers(o)
      setTasks(t)
      setMsgs(m)
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const today = todayISO()
  const weekAgo = recentDays(7)[0]
  const appliedThisWeek = apps.filter((a) => String(a.applied_at ?? '').slice(0, 10) >= weekAgo).length
  const interviewing = apps.filter((a) => a.stage === 'interview').length
  const openTasks = tasks.filter((t) => !t.done)

  const dueSoon = [
    ...jobs
      .filter((j) => {
        const d = daysLeft(j.deadline)
        return d !== null && d >= 0 && d <= 7
      })
      .map((j) => ({ kind: '岗位截止', company: j.company, title: j.title, at: j.deadline })),
    ...apps
      .filter((a) => {
        const d = daysLeft(a.next_action_at)
        return d !== null && d >= 0 && d <= 7
      })
      .map((a) => ({ kind: '下一步动作', company: a.company, title: a.title, at: a.next_action_at })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)))

  const upcoming = ivs
    .filter((i) => i.scheduled_at && String(i.scheduled_at).slice(0, 10) >= today && (i.result ?? 'pending') === 'pending')
    .slice(0, 5)

  const days = recentDays(14)
  const trend = days.map((d) => ({ d, n: apps.filter((a) => String(a.applied_at ?? '').slice(0, 10) === d).length }))
  const maxTrend = Math.max(1, ...trend.map((t) => t.n))
  const maxStage = Math.max(1, ...STAGES.map((s) => apps.filter((a) => a.stage === s.key).length))

  const pace = {
    dailyLimit: profile?.daily_greet_limit ?? DEFAULT_PACE.dailyLimit,
    window: profile?.greet_window ?? DEFAULT_PACE.window,
    minIntervalMin: profile?.min_interval_min ?? DEFAULT_PACE.minIntervalMin,
  }
  const paceNow = paceStatus(msgs, pace)
  // 跟进节奏：按最后一条沟通的状态给窗口（招呼 4 天/已读·超时 2 天/回复 1 天），
  // 比原先的「7 天没动静」更细——已读不回第 3 天就该动了
  const followups = followupDue(apps, msgs, today)
  const funnel = funnelStats(apps, msgs, ivs, offers)
  const cal = calibration(apps, jobs)

  // 「今天先投哪几个」：按 截止紧急 → 优先级 → 匹配分 排，每条带依据和待确认标记
  const picks = todayPicks(jobs, apps, profile, 3)

  // ---- 求职智能体 · 每日巡检（AGENT_PLAN 第二步）
  // 每步审计直接摆出来是刻意的：结论后面没有「它查了什么」，用户就只能信或不信。
  const [agent, setAgent] = useState<{ running: boolean; steps: ActionStep[]; answer: string; stop: StopReason | '' }>({
    running: false,
    steps: [],
    answer: '',
    stop: '',
  })
  const agentAbort = useRef<AbortController | null>(null)
  const quotaNow = getQuotaSnapshot(DAILY_TASK_LABEL)

  async function runInspection() {
    if (agent.running) return
    if (!quotaNow.allowed) {
      // 挡住了就当场说清楚，别让按钮转圈两次再报错
      notifyErr(quotaNow.reasons.join('；'))
      return
    }
    const controller = new AbortController()
    agentAbort.current = controller
    setAgent({ running: true, steps: [], answer: '', stop: '' })
    try {
      const r = await runDailyInspection(
        { jobs, applications: apps, messages: msgs, interviews: ivs, offers, resumes: [], profile, today, now: new Date() },
        {
          signal: controller.signal,
          // 逐步回填：用户在它还在转的时候就能看见「现在在查什么」
          onStep: (s) => setAgent((prev) => ({ ...prev, steps: [...prev.steps, s] })),
        },
      )
      setAgent({ running: false, steps: r.steps, answer: r.answer, stop: r.stopReason })
    } catch (error) {
      setAgent((prev) => ({ ...prev, running: false }))
      notifyErr(errText(error))
    }
  }

  async function toggleTask(row: Row) {
    try {
      await updateRow('tasks', row.id, { done: true })
      notifyOk('已标记完成')
      await load()
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/**
       * AI 未接上时先在首屏说清，而不是等用户点了按钮吃一句抛错：
       * 这条产品口径是"AI 只走使用者自备的 Key"，所以拒绝不是故障，是需要一步配置。
       * 文案与拒绝时那句话同源（`billing.ts` 的 BYO_SETUP_STEPS）。
       */}
      {currentAccess().access === 'none' ? (
        <section className="card">
          <div className="card-head">
            <h3>AI 还没接上</h3>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={() => go('settings')}>
              去接 AI 通道
            </button>
          </div>
          <div className="small mb8">本应用的额度记在创建者账号上，不默认替使用者承担，所以 AI 要走你自己的模型通道。三步：</div>
          <ol className="small">
            {BYO_SETUP_STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <div className="small muted mt8">不想用 Key 也可以选「本机 Ollama」档：花的是自己电脑的算力，需要先把它装好并启动。</div>
        </section>
      ) : null}
      <div className="grid grid-5">
        <Stat label="岗位池" value={jobs.length} foot={`本周新增 ${jobs.filter((j) => String(j.created_at ?? '').slice(0, 10) >= weekAgo).length}`} icon={<Icon name="jobs" size={15} />} color="#3b82f6" />
        <Stat label="已投递" value={apps.length} foot={`本周 +${appliedThisWeek}`} icon={<Icon name="send" size={15} />} color="#f2542d" />
        <Stat label="面试中" value={interviewing} foot={`进行中的流程 ${interviewing} 个`} icon={<Icon name="interviews" size={15} />} color="#8b5cf6" />
        <Stat label="Offer" value={offers.length} foot={offers.length ? `待决策 ${offers.filter((o) => (o.decision ?? 'undecided') === 'undecided').length}` : '还没有 Offer'} icon={<Icon name="offers" size={15} />} color="#12a150" />
        <Stat label="待办" value={openTasks.length} foot={`7 天内到期 ${dueSoon.length}`} icon={<Icon name="clock" size={15} />} color="#f59e0b" />
      </div>

      <section className="card">
        <div className="card-head">
          <h3>今日优先投递</h3>
          <span className="spacer" />
          <span className="small muted">按截止紧急 · 优先级 · 匹配分排序</span>
          <button className="btn sm ghost" onClick={() => go('jobs')}>
            去岗位池
          </button>
        </div>
        <div className="card-body">
          {picks.length === 0 ? (
            <Empty text="岗位池里没有待投的岗位。去岗位广场或 AI 评估里加几个。" action={<button className="btn primary sm" onClick={() => go('square')}>去岗位广场</button>} />
          ) : (
            picks.map((p) => (
              <div key={p.job.id} className="row" style={{ alignItems: 'flex-start', marginBottom: 12 }}>
                <span className={p.urgency === 'today' || p.urgency === 'overdue' ? 'badge danger' : p.urgency === 'soon' ? 'badge warn' : 'badge ok'}>
                  {p.score !== null ? `${p.score}分` : p.local.score + '分'}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="cell-main">
                    {p.job.company} · {p.job.title}
                  </div>
                  <div className="cell-sub">{p.reason}</div>
                  {p.confirm.length ? (
                    <div className="small mt4" style={{ color: '#b45309' }}>
                      待确认：{p.confirm.join('；')}
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
          {picks.length ? (
            <div className="small muted mt8">依据来自本地关键词匹配与截止日，不消耗模型额度；「待确认」是只有你自己能核实的事实，投前过一遍。</div>
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>求职智能体 · 每日巡检</h3>
          <span className="spacer" />
          <span className="small muted">
            它自己决定查哪些数据（{AGENT_TOOLS.length} 个工具，一件事最多 {DEFAULT_QUOTA.maxCallsPerTask} 步）· 今日剩 {quotaNow.remainingTasks} 件事
          </span>
          {agent.running ? (
            <button
              className="btn sm"
              onClick={() => {
                agentAbort.current?.abort()
              }}
            >
              停止
            </button>
          ) : (
            <button className="btn primary sm" onClick={() => void runInspection()} disabled={!quotaNow.allowed}>
              开始巡检
            </button>
          )}
        </div>
        <div className="card-body">
          {!quotaNow.allowed && !agent.running && !agent.answer ? (
            <div className="small" style={{ color: '#b45309' }}>
              {quotaNow.reasons.join('；')}
            </div>
          ) : null}
          {quotaNow.degraded ? (
            <div className="small mt4" style={{ color: '#b45309' }}>
              额度台账当前不可用（浏览器隐私模式或存储配额爆了），这一轮的调用没被计数，护栏处于放行状态。
            </div>
          ) : null}

          <AgentSteps steps={agent.steps} />

          {agent.answer ? (
            <div className="hint mt8">
              <div className="cell-main">行动清单</div>
              <div className="small mt4" style={{ whiteSpace: 'pre-wrap' }}>{agent.answer}</div>
            </div>
          ) : null}
          {agent.stop ? (
            <div className="small muted mt4">
              停止原因：{STOP_LABEL[agent.stop]}。巡检只给清单与建议，<strong>不替你发任何东西</strong>，投递与打招呼由你确认。
            </div>
          ) : (
            <div className="small muted mt4">巡检只读数据、只出清单与建议，不自动投递也不自动发消息。</div>
          )}
        </div>
      </section>

      {apps.length ? (
        <section className="card">
          <div className="card-head">
            <h3>漏斗转化</h3>
            <span className="spacer" />
            <span className="small muted">投递 → 回复 → 面试 → Offer，从沟通流水与面试记录推导</span>
          </div>
          <div className="card-body">
            <div className="dim-row">
              <span className="muted">投递</span>
              <div className="bar">
                <i style={{ width: '100%', background: '#3b82f6' }} />
              </div>
              <span className="mono" style={{ textAlign: 'right' }}>{funnel.applied}</span>
            </div>
            <div className="dim-row">
              <span className="muted">有回复</span>
              <div className="bar">
                <i style={{ width: `${funnel.repliedRate}%`, background: '#f59e0b' }} />
              </div>
              <span className="mono" style={{ textAlign: 'right' }}>
                {funnel.replied}（{funnel.repliedRate}%）
              </span>
            </div>
            <div className="dim-row">
              <span className="muted">到面试</span>
              <div className="bar">
                <i style={{ width: `${funnel.interviewRate}%`, background: '#8b5cf6' }} />
              </div>
              <span className="mono" style={{ textAlign: 'right' }}>
                {funnel.interview}（{funnel.interviewRate}%）
              </span>
            </div>
            <div className="dim-row">
              <span className="muted">Offer</span>
              <div className="bar">
                <i style={{ width: `${funnel.offerRate}%`, background: '#12a150' }} />
              </div>
              <span className="mono" style={{ textAlign: 'right' }}>
                {funnel.offer}（{funnel.offerRate}%）
              </span>
            </div>
            <div className="small muted mt8">
              回复后到面率 {funnel.interviewAfterReplyRate}%。
              {cal.gap !== null
                ? ` 评分校准：被拒的当时均分 ${cal.rejectedAvg} 分，走到后面的均分 ${cal.advancedAvg} 分，差 ${cal.gap} 分${cal.gap >= 20 ? '。预筛在起作用，低分确实该拦。' : cal.gap >= 0 ? '。差距不大，预筛阈值可以再收紧一点。' : '。被拒的反而是当时打高分的，校准一下 skill 关键词。'}`
                : ' 评分校准要有「被拒」和「推进到后面」两种结果后才会出现。'}
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <section className="card">
          <div className="card-head">
            <h3>今日投递节奏</h3>
            <span className="spacer" />
            <span className={paceNow.allowed ? 'badge ok' : 'badge warn'}>{paceNow.allowed ? '现在可以发' : '先缓一缓'}</span>
          </div>
          <div className="card-body">
            <div className="row" style={{ alignItems: 'baseline' }}>
              <span className="mono" style={{ fontSize: 30, lineHeight: 1 }}>
                {paceNow.sentToday}
              </span>
              <span className="muted"> / {paceNow.limit} 条</span>
              <span className="spacer" />
              <span className="small muted">剩余 {paceNow.remaining} 条</span>
            </div>
            <div className="bar mt8" style={{ height: 8 }}>
              <i
                style={{
                  width: `${Math.min(100, (paceNow.sentToday / Math.max(1, paceNow.limit)) * 100)}%`,
                  background: paceNow.allowed ? 'var(--ok, #12a150)' : '#f59e0b',
                }}
              />
            </div>
            <div className="grid grid-3 mt16" style={{ gap: 10 }}>
              <div>
                <div className="small muted">时间窗</div>
                <div className="cell-main">
                  {pace.window} · {paceNow.inWindowNow ? '进行中' : '已关闭'}
                </div>
              </div>
              <div>
                <div className="small muted">距上次发送</div>
                <div className="cell-main">{paceNow.minutesSinceLast === null ? '暂无记录' : `${paceNow.minutesSinceLast} 分钟前`}</div>
              </div>
              <div>
                <div className="small muted">最小间隔</div>
                <div className="cell-main">{pace.minIntervalMin} 分钟</div>
              </div>
            </div>
            {paceNow.reasons.length ? (
              <div className="hint mt16">
                {paceNow.reasons.map((r) => (
                  <div key={r}>· {r}</div>
                ))}
              </div>
            ) : (
              <div className="small muted mt16">
                节奏正常。发送前的 6 条自检清单在「配置 → 投递节奏守则」，投递看板里登记招呼时会强制过一遍。
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>待跟进</h3>
            <span className="spacer" />
            <span className="small muted">按沟通状态给节奏，不只是 7 天</span>
            <button className="btn sm ghost" onClick={() => go('pipeline')}>
              去处理
            </button>
          </div>
          <div className="card-body">
            {followups.length === 0 ? (
              <Empty text="没有到期的跟进。HR 那边有动静，节奏会自动顺延。" />
            ) : (
              followups.slice(0, 6).map((f) => (
                <div key={f.application.id} className="row" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
                  <span className={f.overdueDays >= 3 ? 'badge danger' : f.overdueDays >= 1 ? 'badge warn' : 'badge info'}>
                    {f.overdueDays === 0 ? '今天到期' : `超期 ${f.overdueDays} 天`}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="cell-main">{f.application.company}</div>
                    <div className="cell-sub">
                      {f.application.title} · {f.suggestion}
                    </div>
                  </div>
                </div>
              ))
            )}
            {followups.length > 6 ? <div className="small muted">还有 {followups.length - 6} 条，去投递看板看全部。</div> : null}
          </div>
        </section>
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <section className="card">
          <div className="card-head">
            <h3>近 14 天投递节奏</h3>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={() => go('pipeline')}>
              去投递看板
            </button>
          </div>
          <div className="card-body">
            {apps.length === 0 && !loading ? (
              <Empty text="还没有投递记录，先从岗位池转一个进来。" action={<button className="btn primary sm" onClick={() => go('jobs')}>去岗位池</button>} />
            ) : (
              <>
                <div className="trend">
                  {trend.map((t) => (
                    <div className="col" key={t.d} title={`${t.d} 投递 ${t.n}`}>
                      <i style={{ height: `${(t.n / maxTrend) * 100}%` }} />
                      <span>{t.d.slice(5)}</span>
                    </div>
                  ))}
                </div>
                <div className="small muted mt8">合计 {apps.length} 条投递记录，柱高对应当天投递数量。</div>
              </>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>阶段分布</h3>
            <span className="spacer" />
            <span className="small muted">共 {apps.length} 条</span>
          </div>
          <div className="card-body">
            {STAGES.map((s) => {
              const n = apps.filter((a) => a.stage === s.key).length
              return (
                <div className="dim-row" key={s.key}>
                  <span className="muted">{s.label}</span>
                  <div className="bar">
                    <i style={{ width: `${(n / maxStage) * 100}%`, background: s.color }} />
                  </div>
                  <span className="mono" style={{ textAlign: 'right' }}>
                    {n}
                  </span>
                </div>
              )
            })}
            {apps.length ? null : <div className="small muted mt8">投递后这里会按阶段实时统计，用来判断卡在笔试还是面试。</div>}
          </div>
        </section>
      </div>

      <div className="grid grid-3" style={{ alignItems: 'start' }}>
        <section className="card">
          <div className="card-head">
            <h3>7 天内要处理的事</h3>
          </div>
          <div className="card-body">
            {dueSoon.length === 0 ? (
              <Empty text="近 7 天没有截止或待跟进事项。" />
            ) : (
              dueSoon.slice(0, 6).map((item, idx) => (
                <div key={`${item.company}-${idx}`} className="row" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
                  <span className={daysLeft(item.at)! <= 1 ? 'badge danger' : 'badge warn'}>{leftText(item.at)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="cell-main">{item.company}</div>
                    <div className="cell-sub">
                      {item.kind} · {item.title} · {fmtDate(item.at)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>待办清单</h3>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={() => go('calendar')}>
              日程
            </button>
          </div>
          <div className="card-body">
            {openTasks.length === 0 ? (
              <Empty text="暂无未完成待办。" />
            ) : (
              openTasks.slice(0, 6).map((t) => (
                <div key={t.id} className="row" style={{ marginBottom: 9 }}>
                  <input type="checkbox" onChange={() => void toggleTask(t)} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="cell-main" style={{ fontWeight: 500 }}>
                      {t.title}
                    </div>
                    <div className="cell-sub">
                      {t.kind ?? '其它'} {t.due_at ? `· ${fmtDateTime(t.due_at)}` : ''} {t.company ? `· ${t.company}` : ''}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>即将到来的面试</h3>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={() => go('interviews')}>
              面试跟进
            </button>
          </div>
          <div className="card-body">
            {upcoming.length === 0 ? (
              <Empty text="近期没有安排面试。" />
            ) : (
              upcoming.map((i) => (
                <div key={i.id} style={{ marginBottom: 12 }}>
                  <div className="row">
                    <span className="cell-main">{i.company}</span>
                    <span className="badge info">{i.round_name ?? i.kind ?? '面试'}</span>
                  </div>
                  <div className="cell-sub">
                    {fmtDateTime(i.scheduled_at)} · {i.mode ?? '待定'} {i.place ? `· ${i.place}` : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
