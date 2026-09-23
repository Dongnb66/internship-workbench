import { useCallback, useEffect, useState } from 'react'
import { errText } from '../cloud'
import { Empty, Stat } from '../components/ui'
import { listRows, updateRow } from '../lib/api'
import { STAGES } from '../lib/constants'
import { daysLeft, fmtDate, fmtDateTime, leftText, recentDays, todayISO } from '../lib/format'
import { DEFAULT_PACE, paceStatus, staleApplications } from '../lib/pace'
import { notifyErr, notifyOk } from '../lib/toast'
import type { Profile, Row } from '../types'

export interface PageProps {
  profile: Profile | null
  onChanged: () => void | Promise<void>
  go: (page: string) => void
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
  const stale = staleApplications(apps, msgs, 7)

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
      <div className="grid grid-5">
        <Stat label="岗位池" value={jobs.length} foot={`本周新增 ${jobs.filter((j) => String(j.created_at ?? '').slice(0, 10) >= weekAgo).length}`} icon="🎯" color="#3b82f6" />
        <Stat label="已投递" value={apps.length} foot={`本周 +${appliedThisWeek}`} icon="📮" color="#f2542d" />
        <Stat label="面试中" value={interviewing} foot={`进行中的流程 ${interviewing} 个`} icon="🎤" color="#8b5cf6" />
        <Stat label="Offer" value={offers.length} foot={offers.length ? `待决策 ${offers.filter((o) => (o.decision ?? 'undecided') === 'undecided').length}` : '还没有 Offer'} icon="🏆" color="#12a150" />
        <Stat label="待办" value={openTasks.length} foot={`7 天内到期 ${dueSoon.length}`} icon="⏰" color="#f59e0b" />
      </div>

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
            <h3>超期未回复</h3>
            <span className="spacer" />
            <span className="small muted">≥ 7 天</span>
            <button className="btn sm ghost" onClick={() => go('pipeline')}>
              去处理
            </button>
          </div>
          <div className="card-body">
            {stale.length === 0 ? (
              <Empty text="没有超过 7 天没动静的投递。" />
            ) : (
              stale.slice(0, 6).map((s) => (
                <div key={s.application.id} className="row" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
                  <span className={s.days >= 14 ? 'badge danger' : 'badge warn'}>{s.days} 天</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="cell-main">{s.application.company}</div>
                    <div className="cell-sub">
                      {s.application.title} · 最后沟通 {s.lastAt}
                    </div>
                  </div>
                </div>
              ))
            )}
            {stale.length > 6 ? <div className="small muted">还有 {stale.length - 6} 个，去投递看板看全部。</div> : null}
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
