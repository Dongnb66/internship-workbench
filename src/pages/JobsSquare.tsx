import { useCallback, useEffect, useMemo, useState } from 'react'
import { errText } from '../cloud'
import { Drawer, Empty, ScoreCell } from '../components/ui'
import { insertRow, listPublicJobs, listRows } from '../lib/api'
import { JOB_TYPES } from '../lib/constants'
import { localScore } from '../lib/score'
import { SQUARE_SOURCE, filterSquareJobs, inPool, poolKeySet, publicToPoolRow, squareCities } from '../lib/square'
import { fmtDate } from '../lib/format'
import { notifyErr, notifyOk } from '../lib/toast'
import type { PublicJob, Row } from '../types'
import type { PageProps } from './Overview'

/**
 * 岗位广场：所有人共享的只读岗位库。
 *
 * 存在的理由是一个产品层面的硬伤 —— 这个工作台是按用户隔离的（RLS），
 * 所以新用户打开岗位池必然是空的，而「空」等于看不出这个工具的价值。
 * 广场把「公共的岗位数据」与「我的私有跟踪状态」拆开：广场对所有人只读，
 * 点「加入岗位池」才把这一条复制进自己的 `jobs`。
 *
 * 因此这个页面**没有任何写广场的代码**。它只写两处：用户自己的 `jobs`（加入），
 * 以及什么都不写（已加入的判定是纯读比对去重键）。
 */
/**
 * 判断错误是不是「表还不存在」。
 *
 * 这个状态会真实发生：代码先合、建表后做（云上没有跑迁移的后端进程，
 * 表由工作台侧执行 SQL 创建）。如果直接把 Postgres 的原始报错甩给用户，
 * 看到的是一串 `42P01` 之类的东西，读不出「该去建表」这个动作。
 */
function isMissingTable(message: string): boolean {
  const t = String(message ?? '')
  return /42P01/.test(t) || /does not exist|不存在/.test(t)
}

export default function JobsSquare({ profile, onChanged, go }: PageProps) {
  const [publicJobs, setPublicJobs] = useState<PublicJob[]>([])
  const [poolRows, setPoolRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [filterCity, setFilterCity] = useState('全部')
  const [filterType, setFilterType] = useState('全部')
  const [filterPool, setFilterPool] = useState('全部')
  const [detail, setDetail] = useState<PublicJob | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [busyAll, setBusyAll] = useState(false)
  const [selected, setSelected] = useState<number[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      // 广场是公共数据，岗位池是私有数据，两者并行拉；池子只用来自 dedupeKey
      const [pub, pool] = await Promise.all([listPublicJobs(1000), listRows('jobs', { limit: 800 })])
      setPublicJobs(pub as PublicJob[])
      setPoolRows(pool)
    } catch (error) {
      setLoadError(errText(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const keys = useMemo(() => poolKeySet(poolRows), [poolRows])

  const cities = useMemo(() => squareCities(publicJobs), [publicJobs])

  const shown = useMemo(
    () => filterSquareJobs(publicJobs, { keyword, city: filterCity, jobType: filterType, poolState: filterPool }, keys),
    [publicJobs, keyword, filterCity, filterType, filterPool, keys],
  )

  const joinedCount = useMemo(() => publicJobs.filter((j) => inPool(j, keys)).length, [publicJobs, keys])

  /** 加入岗位池 = 复制一份快照。广场数据一字不动，重复点击由 dedupeKey 挡住 */
  async function join(job: PublicJob): Promise<boolean> {
    if (inPool(job, keys)) {
      notifyErr('这个岗位已经在你的岗位池里了')
      return false
    }
    try {
      const score = localScore(job.jd_text ?? '', job.title ?? '', profile).score
      await insertRow('jobs', publicToPoolRow(job, score))
      return true
    } catch (error) {
      notifyErr(errText(error))
      return false
    }
  }

  async function joinOne(job: PublicJob) {
    setBusyId(job.id)
    try {
      if (await join(job)) {
        notifyOk(`已加入岗位池：${job.company} · ${job.title}`)
        await load()
        await onChanged()
      }
    } finally {
      setBusyId(null)
    }
  }

  async function joinSelected() {
    const targets = shown.filter((j) => selected.includes(j.id) && !inPool(j, keys))
    if (!targets.length) {
      notifyErr('选中的岗位都已经在岗位池里了')
      return
    }
    setBusyAll(true)
    let ok = 0
    try {
      for (const job of targets) {
        try {
          const score = localScore(job.jd_text ?? '', job.title ?? '', profile).score
          await insertRow('jobs', publicToPoolRow(job, score))
          ok += 1
        } catch {
          // 单条失败不中断整批
        }
      }
      notifyOk(`已加入 ${ok} 个岗位到岗位池`)
      setSelected([])
      await load()
      await onChanged()
    } finally {
      setBusyAll(false)
    }
  }

  function toggleOne(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const joinable = shown.filter((j) => !inPool(j, keys))

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="card">
        <div className="card-body">
          <div className="row wrap" style={{ gap: 8 }}>
            <strong>岗位广场</strong>
            <span className="badge brand">公共岗位库 · 所有人可见</span>
            <span className="badge">只读</span>
            <span className="spacer" />
            <span className="small muted">
              共 {publicJobs.length} 个 · 已加入 {joinedCount} 个
            </span>
          </div>
          <div className="small muted mt8">
            广场里的岗位是所有人共享的同一批，任何人都改不了它。点「加入岗位池」会把这一个岗位<b>复制</b>一份到你的岗位池，
            之后你对它的匹配度、备注、投递状态都只属于你自己。
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="filters">
            <input
              className="input"
              style={{ minWidth: 230 }}
              placeholder="搜索公司 / 岗位 / JD 关键词"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <select className="select" value={filterCity} onChange={(e) => setFilterCity(e.target.value)}>
              {['全部', ...cities].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <select className="select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              {['全部', ...JOB_TYPES].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <select className="select" value={filterPool} onChange={(e) => setFilterPool(e.target.value)}>
              {['全部', '未加入', '已加入'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <span className="spacer" />
            <button className="btn" onClick={() => void joinSelected()} disabled={busyAll || !selected.length}>
              {busyAll ? '加入中…' : `批量加入（${selected.filter((id) => shown.some((j) => j.id === id && !inPool(j, keys))).length}）`}
            </button>
            <button className="btn" onClick={() => void load()} disabled={loading}>
              刷新
            </button>
            <button className="btn primary" onClick={() => go('jobs')}>
              去我的岗位池
            </button>
          </div>
          {cities.length ? (
            <div className="row wrap mt8" style={{ gap: 6 }}>
              <span className="small muted">城市：</span>
              {cities.slice(0, 12).map((c) => (
                <button key={c} className={filterCity === c ? 'chip on' : 'chip'} onClick={() => setFilterCity(filterCity === c ? '全部' : c)}>
                  {c}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {loading ? (
        <section className="card">
          <div className="card-body">
            <Empty text="正在读取岗位广场…" />
          </div>
        </section>
      ) : loadError ? (
        <section className="card">
          <div className="card-body starter">
            <div className="starter-head">
              <h3>{isMissingTable(loadError) ? '岗位广场还没建好' : '岗位广场读取失败'}</h3>
              <span className="small muted">
                {isMissingTable(loadError)
                  ? '公共岗位表（jobs_public）还没有在这个环境里创建 —— 页面代码已就绪，缺的只是数据表本身。'
                  : loadError}
              </span>
            </div>
            {isMissingTable(loadError) ? (
              <div className="starter-steps">
                <div className="starter-step">
                  <span className="idx">1</span>
                  <h4>建表</h4>
                  <p>
                    执行 <code>db/migrations/001_jobs_public.sql</code> 里的语句（一条一个请求），
                    建 <code>jobs_public</code> 表并挂上「所有人可读、无人可写」的策略。
                  </p>
                </div>
                <div className="starter-step">
                  <span className="idx">2</span>
                  <h4>灌种子数据</h4>
                  <p>
                    跑 <code>node db/build-seed.mjs</code> 生成 INSERT 语句并执行，广场就有岗位了。
                  </p>
                </div>
              </div>
            ) : null}
            <div className="starter-actions">
              <button className="btn" onClick={() => void load()} disabled={loading}>
                重试
              </button>
              <button className="btn primary" onClick={() => go('jobs')}>
                先去我的岗位池
              </button>
            </div>
            <div className="starter-foot">
              广场建好之前不影响你自己用：岗位池的抓取、导入、评分、投递流程都不依赖这张表。
            </div>
          </div>
        </section>
      ) : !publicJobs.length ? (
        <section className="card">
          <div className="card-body starter">
            <div className="starter-head">
              <h3>岗位广场还是空的</h3>
              <span className="small muted">广场的数据由工作台这边灌入，不是每个用户自己抓。</span>
            </div>
            <div className="starter-steps">
              <div className="starter-step">
                <span className="idx">1</span>
                <h4>先用自己的渠道把岗位池填起来</h4>
                <p>
                  广场空着不影响你自己用：回「岗位池」跑一次本地抓取器，或用浏览器助手采集，岗位立刻进你的池子。
                </p>
              </div>
              <div className="starter-step">
                <span className="idx">2</span>
                <h4>广场数据还没导入</h4>
                <p>
                  广场需要先把公共岗位写进数据库才会有人看到。在灌入之前，这里就是空的 —— 这是预期状态，不是坏了。
                </p>
              </div>
            </div>
            <div className="starter-actions">
              <button className="btn primary" onClick={() => go('jobs')}>
                去我的岗位池
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="card">
          <div className="card-head">
            <h3>岗位列表</h3>
            <span className="spacer" />
            <span className="small muted">
              当前显示 {shown.length} 个 · 其中 {joinable.length} 个还没加入
            </span>
          </div>
          <div className="table-wrap">
            {shown.length === 0 ? (
              <Empty text="当前筛选条件下没有岗位。清掉搜索词，或把城市 / 类型 / 加入状态切回「全部」。" />
            ) : (
              <table className="tb">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>
                      <input
                        type="checkbox"
                        checked={joinable.length > 0 && joinable.every((j) => selected.includes(j.id))}
                        onChange={(e) => setSelected(e.target.checked ? joinable.map((j) => j.id) : [])}
                      />
                    </th>
                    <th>公司 / 岗位</th>
                    <th>城市</th>
                    <th>类型</th>
                    <th>薪资</th>
                    <th>来源</th>
                    <th>岗位池</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((job) => {
                    const already = inPool(job, keys)
                    const score = localScore(job.jd_text ?? '', job.title ?? '', profile).score
                    return (
                      <tr key={job.id}>
                        <td>
                          <input type="checkbox" disabled={already} checked={selected.includes(job.id)} onChange={() => toggleOne(job.id)} />
                        </td>
                        <td>
                          <div className="cell-main">{job.company}</div>
                          <div className="cell-sub">{job.title}</div>
                        </td>
                        <td>{job.city ?? '—'}</td>
                        <td>
                          <span className="badge">{job.job_type ?? '—'}</span>
                        </td>
                        <td className="small">{job.salary ?? '—'}</td>
                        <td className="small">{job.source ?? '—'}</td>
                        <td>
                          {already ? <span className="badge ok">已在池中</span> : <ScoreCell value={score} />}
                        </td>
                        <td>
                          <div className="actions">
                            <button className="linkish" onClick={() => setDetail(job)}>
                              详情
                            </button>
                            {already ? (
                              <span className="small muted">已加入</span>
                            ) : (
                              <button className="linkish" onClick={() => void joinOne(job)} disabled={busyId === job.id}>
                                {busyId === job.id ? '加入中…' : '加入岗位池'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {detail ? (
        <Drawer
          title={`${detail.company} · ${detail.title}`}
          onClose={() => setDetail(null)}
          footer={
            inPool(detail, keys) ? (
              <button className="btn" onClick={() => go('jobs')}>
                已在岗位池，去查看
              </button>
            ) : (
              <button className="btn primary" onClick={() => void joinOne(detail)} disabled={busyId === detail.id}>
                {busyId === detail.id ? '加入中…' : '加入岗位池'}
              </button>
            )
          }
        >
          <div className="row wrap mb16" style={{ gap: 6 }}>
            {[detail.city, detail.job_type, detail.education, detail.industry].filter(Boolean).map((t) => (
              <span className="badge" key={String(t)}>
                {t}
              </span>
            ))}
            {(detail.tags ?? []).map((t: string) => (
              <span className="badge brand" key={t}>
                {t}
              </span>
            ))}
          </div>
          <div className="grid grid-2 mb16">
            <div>
              <div className="small muted">薪资</div>
              <div>{detail.salary ?? '—'}</div>
            </div>
            <div>
              <div className="small muted">来源渠道</div>
              <div>{detail.source ?? '—'}</div>
            </div>
            <div>
              <div className="small muted">采集时间</div>
              <div>{detail.posted_at ? fmtDate(detail.posted_at) : '—'}</div>
            </div>
            <div>
              <div className="small muted">本地初算匹配度</div>
              <div>{localScore(detail.jd_text ?? '', detail.title ?? '', profile).score}%</div>
            </div>
          </div>
          {detail.url ? (
            <p>
              <a href={detail.url} target="_blank" rel="noreferrer">
                打开原始岗位链接
              </a>
            </p>
          ) : null}
          <div className="small muted mt8">JD 原文</div>
          <div className="md" style={{ background: '#fafbfc', padding: 12, borderRadius: 9, marginTop: 6, maxHeight: 320, overflow: 'auto' }}>
            {detail.jd_text || '（招聘页上只有岗位名与城市，没有 JD 正文。加入岗位池后可自己补上。）'}
          </div>
        </Drawer>
      ) : null}
    </div>
  )
}
