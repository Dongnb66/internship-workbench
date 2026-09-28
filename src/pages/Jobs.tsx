import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errText } from '../cloud'
import { Drawer, Empty, Field, Modal, ScoreCell } from '../components/ui'
import JobImportModal from '../components/JobImportModal'
import { evaluateJD } from '../lib/ai'
import { deleteRow, insertRow, listRows, updateRow } from '../lib/api'
import { localScore, prefilterJob } from '../lib/score'
import { SAMPLE_JOBS, isSampleRow, sampleToRow } from '../lib/samples'
import { CHANNEL_CAPABILITIES, CHANNELS, INDUSTRIES, JOB_TYPES, PRIORITIES } from '../lib/constants'
import { dateOnly, fmtDate, leftText, textToArray, todayISO } from '../lib/format'
import { notifyErr, notifyOk } from '../lib/toast'
import type { Row } from '../types'
import type { PageProps } from './Overview'

const emptyForm = {
  company: '',
  title: '',
  city: '',
  job_type: '实习',
  industry: '互联网',
  education: '本科',
  salary: '',
  source: 'BOSS直聘',
  url: '',
  jd_text: '',
  tags: '',
  priority: '中',
  deadline: '',
  notes: '',
}

export default function Jobs({ profile, onChanged, go }: PageProps) {
  const [rows, setRows] = useState<Row[]>([])
  const [resumes, setResumes] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [filterType, setFilterType] = useState('全部')
  const [filterStatus, setFilterStatus] = useState('全部')
  const [sortBy, setSortBy] = useState('匹配度')
  const [detail, setDetail] = useState<Row | null>(null)
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [form, setForm] = useState<Record<string, string>>({ ...emptyForm })
  const [applyFor, setApplyFor] = useState<Row | null>(null)
  const [applyForm, setApplyForm] = useState({ channel: 'BOSS直聘', resume_id: '', applied_at: todayISO(), next_action: '', next_action_at: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  /**
   * 筛选条件一变就清空勾选。
   *
   * 不清的后果很隐蔽：`selected` 是全量 rows 的 id，而筛选只改 `shown`。
   * 用户先勾一批、再切筛选、然后点「批量 AI 评分」，按钮上写的是「（3）」，
   * 实际会把已经看不见的行一起送去评分 —— 消耗真实模型额度，且用户无从察觉。
   * 在这里清空，按钮计数与真实目标就再也不会对不上。
   *
   * 写成事件处理器而不是 `useEffect(..., [筛选条件])`：effect 里 setState 会多触发
   * 一轮渲染，而清勾选本身正是「用户改筛选」这个事件的结果，放在事件里更贴。
   */
  function changeFilter<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value)
      setSelected([])
    }
  }
  const abortRef = useRef(false)
  const [batch, setBatch] = useState({
    running: false,
    index: 0,
    total: 0,
    scored: 0,
    skipped: 0,
    blocked: 0,
    failed: 0,
    current: '',
    failedIds: [] as number[],
    /** 因 JD 写死硬门槛（届数/学历/证书/年限）被跳过、但用户可一键覆盖重跑的岗位 */
    blockedIds: [] as number[],
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [jobs, rs] = await Promise.all([listRows('jobs', { limit: 800 }), listRows('resumes', { limit: 200 })])
      setRows(jobs)
      setResumes(rs)
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const cities = useMemo(() => Array.from(new Set(rows.map((r) => r.city).filter(Boolean))) as string[], [rows])

  const shown = useMemo(() => {
    let list = [...rows]
    const kw = keyword.trim().toLowerCase()
    if (kw) {
      list = list.filter((r) => `${r.company} ${r.title} ${r.jd_text ?? ''} ${(r.tags ?? []).join(' ')}`.toLowerCase().includes(kw))
    }
    if (filterType !== '全部') list = list.filter((r) => r.job_type === filterType)
    if (filterStatus !== '全部') list = list.filter((r) => r.status === filterStatus)
    if (sortBy === '匹配度') list.sort((a, b) => Number(b.match_score ?? 0) - Number(a.match_score ?? 0))
    if (sortBy === '截止最近') list.sort((a, b) => String(a.deadline ?? '9999').localeCompare(String(b.deadline ?? '9999')))
    if (sortBy === '最新录入') list.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    return list
  }, [rows, keyword, filterType, filterStatus, sortBy])

  function openNew() {
    setForm({ ...emptyForm })
    setEditing('new')
  }

  function openEdit(row: Row) {
    setForm({
      company: row.company ?? '',
      title: row.title ?? '',
      city: row.city ?? '',
      job_type: row.job_type ?? '实习',
      industry: row.industry ?? '互联网',
      education: row.education ?? '本科',
      salary: row.salary ?? '',
      // 来源为空时不能用 'BOSS直聘' 兜底：那会把「没填来源」静默改写成「BOSS直聘」。
      // select 侧会对不在 CHANNELS 里的值（含空串）追加一项显式展示。
      source: row.source ?? '',
      url: row.url ?? '',
      jd_text: row.jd_text ?? '',
      tags: (row.tags ?? []).join('、'),
      priority: row.priority ?? '中',
      // 截止日回填必须取本地日历日：slice(0,10) 截的是 UTC 日期，带时间的
      // timestamptz 在 UTC+8 会差一天，用户不改直接保存就把截止日悄悄提前了
      deadline: row.deadline ? dateOnly(row.deadline) : '',
      notes: row.notes ?? '',
    })
    setEditing(row)
  }

  async function save() {
    if (!form.company.trim() || !form.title.trim()) {
      notifyErr('公司与岗位名称为必填')
      return
    }
    setBusy(true)
    try {
      const scored = localScore(form.jd_text, form.title, profile)
      const payload: Row = {
        company: form.company.trim(),
        title: form.title.trim(),
        city: form.city.trim() || null,
        job_type: form.job_type,
        industry: form.industry,
        education: form.education,
        salary: form.salary.trim() || null,
        source: form.source,
        url: form.url.trim() || null,
        jd_text: form.jd_text,
        tags: textToArray(form.tags),
        priority: form.priority,
        deadline: form.deadline || null,
        notes: form.notes || null,
        match_score: scored.score,
      }
      if (editing === 'new') {
        await insertRow('jobs', payload)
        notifyOk('岗位已加入岗位池')
      } else if (editing) {
        await updateRow('jobs', editing.id, { ...payload, updated_at: new Date().toISOString() })
        notifyOk('已保存修改')
      }
      setEditing(null)
      await load()
      await onChanged()
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setBusy(false)
    }
  }

  async function rescore() {
    setBusy(true)
    try {
      for (const row of rows) {
        const scored = localScore(row.jd_text ?? '', row.title ?? '', profile)
        if (scored.score !== Number(row.match_score ?? -1)) {
          await updateRow('jobs', row.id, { match_score: scored.score })
        }
      }
      notifyOk('已按当前画像重算匹配度')
      await load()
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setBusy(false)
    }
  }

  function toggleOne(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? shown.map((r) => r.id) : [])
  }

  /**
   * 两段式批量评分：先关键词预筛挡掉明显不相关的岗位（省大模型额度），
   * 再对通过预筛的逐条做 AI 深评，结果结构化写回岗位池与评估历史。
   * 严格串行执行，可随时中断，失败项可一键重试。
   */
  async function batchScore(targetIds?: number[], ignoreBlockers = false) {
    const ids = targetIds ?? selected
    const targets = rows.filter((r) => ids.includes(r.id))
    if (!targets.length) return
    abortRef.current = false
    // 复用 busy 与 rescore/保存/导入互斥：批量评分一轮要跑几分钟，
    // 期间「重算匹配度」若可点会并发写 match_score，last-writer-wins
    // 把刚花的 AI 深评额度直接覆盖掉
    setBusy(true)
    let scored = 0
    let skipped = 0
    let blocked = 0
    let failed = 0
    const failedIds: number[] = []
    const blockedIds: number[] = []
    setBatch({ running: true, index: 0, total: targets.length, scored, skipped, blocked, failed, current: '', failedIds: [], blockedIds: [] })

    try {
      for (let i = 0; i < targets.length; i += 1) {
        if (abortRef.current) break
        const job = targets[i]
        setBatch((b) => ({ ...b, index: i + 1, current: `${job.company} · ${job.title}` }))

        const pre = prefilterJob(job.jd_text ?? '', job.title ?? '', profile, undefined, ignoreBlockers)
        if (!pre.pass) {
          const hard = pre.blockers.hard
          if (hard.length && !ignoreBlockers) {
            blocked += 1
            blockedIds.push(job.id)
            // 把命中的 JD 原句写进备注：用户隔几天回来看，能自己复核判定对不对
            try {
              await updateRow('jobs', job.id, {
                notes: `${job.notes ? `${job.notes}\n` : ''}[硬门槛 ${todayISO()}] ${hard.map((b) => `${b.label}｜依据：${b.quote}`).join('　')}`,
              })
            } catch {
              // 备注写入失败不影响后续岗位
            }
            setBatch((b) => ({ ...b, blocked, blockedIds: [...blockedIds] }))
            continue
          }
          skipped += 1
          try {
            await updateRow('jobs', job.id, {
              match_score: pre.score,
              notes: `${job.notes ? `${job.notes}\n` : ''}[预筛 ${todayISO()}] 本地分 ${pre.score}，跳过 AI 深评`,
            })
          } catch {
            // 预筛结果的写入失败不影响后续岗位
          }
          setBatch((b) => ({ ...b, skipped }))
          continue
        }

        try {
          const evaluated = await evaluateJD(job.jd_text ?? '', profile)
          // ⚠️ await 之后必须重新检查中断标记：用户点「停止」的时刻几乎总是落在
          // 某一次 await 期间，只在循环开头检查的话，这一条会照常把分数和 AI 报告写进去，
          // 用户以为停了、数据却多了一条，而且无法撤销。
          if (abortRef.current) break
          await updateRow('jobs', job.id, {
            match_score: evaluated.score,
            priority: evaluated.score >= 75 ? '高' : evaluated.score >= 55 ? '中' : '低',
          })
          await insertRow('ai_reports', {
            company: job.company,
            title: job.title,
            jd_text: job.jd_text ?? '',
            score: evaluated.score,
            verdict: evaluated.verdict,
            dims: evaluated.dims,
            highlights: evaluated.highlights.join('\n'),
            gaps: evaluated.gaps.join('\n'),
            greeting: evaluated.greeting,
            model: 'cloud-llm',
          })
          scored += 1
        } catch (e) {
          const msg = String((e as Error)?.message ?? '')
          if (/额度|上限，循环被熔断|总数已达/.test(msg)) {
            // 额度挡住了就别再往下撞：剩下的岗位一条也不会评分，
            // 继续循环只会把「失败」数刷高、把真正的原因（今天用完了）淹掉。
            setBatch((b) => ({ ...b, current: `额度护罩生效，批量评分停在第 ${i + 1} 条：${msg}` }))
            break
          }
          failed += 1
          failedIds.push(job.id)
        }
        setBatch((b) => ({ ...b, scored, failed, failedIds: [...failedIds] }))
      }

      setBatch((b) => ({ ...b, running: false, current: '' }))
      // 中止与正常结束必须可区分：否则用户点了「停止」也看到「结束」，分不清这批跑没跑完
      notifyOk(
        abortRef.current
          ? `已停止：AI 深评 ${scored} · 预筛跳过 ${skipped} · 失败 ${failed}`
          : `批量评分结束：AI 深评 ${scored} · 预筛跳过 ${skipped} · 失败 ${failed}`,
      )
      await load()
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function remove(row: Row) {
    if (!window.confirm(`确定删除「${row.company} · ${row.title}」？该岗位会从岗位池移除，不影响已有投递记录。`)) return
    try {
      await deleteRow('jobs', row.id)
      notifyOk('已删除')
      setDetail(null)
      await load()
      await onChanged()
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  const sampleCount = rows.filter(isSampleRow).length

  /**
   * 一键铺 5 条示例岗位。目的不是「送数据」，而是让空表立刻能演示这个工具的价值：
   * 匹配度有梯度、有命中也有缺口、有远程岗、有一条故意大面积不匹配的用来验证预筛。
   * 全部用「示例·」前缀命名，随时可一键清空，不会和真实投递混在一起。
   */
  async function loadSamples() {
    setBusy(true)
    try {
      for (const sample of SAMPLE_JOBS) {
        const score = localScore(sample.jd_text, sample.title, profile).score
        await insertRow('jobs', sampleToRow(sample, score))
      }
      notifyOk(`已导入 ${SAMPLE_JOBS.length} 条示例岗位，随时可一键清空`)
      await load()
      await onChanged()
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setBusy(false)
    }
  }

  async function clearSamples() {
    if (!window.confirm(`确定清空 ${sampleCount} 条示例岗位？只会删掉「示例·」开头的记录，你自己录入的不受影响。`)) return
    setBusy(true)
    try {
      for (const row of rows.filter(isSampleRow)) {
        await deleteRow('jobs', row.id)
      }
      notifyOk('示例数据已清空')
      await load()
      await onChanged()
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setBusy(false)
    }
  }

  async function submitApply() {
    if (!applyFor) return
    setBusy(true)
    try {
      const resume = resumes.find((r) => String(r.id) === applyForm.resume_id)
      await insertRow('applications', {
        job_id: applyFor.id,
        company: applyFor.company,
        title: applyFor.title,
        city: applyFor.city ?? null,
        stage: 'applied',
        channel: applyForm.channel,
        resume_id: resume?.id ?? null,
        resume_name: resume ? `${resume.name} ${resume.version ?? ''}`.trim() : null,
        applied_at: applyForm.applied_at,
        next_action: applyForm.next_action || null,
        next_action_at: applyForm.next_action_at || null,
        notes: applyForm.notes || null,
      })
      await updateRow('jobs', applyFor.id, { status: 'applied' })
      if (resume) await updateRow('resumes', resume.id, { used_count: Number(resume.used_count ?? 0) + 1 })
      notifyOk('已转入投递看板')
      setApplyFor(null)
      setDetail(null)
      await load()
      await onChanged()
      go('pipeline')
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setBusy(false)
    }
  }

  function sendToAi(row: Row) {
    window.sessionStorage.setItem('iwb:ai-prefill', JSON.stringify({ company: row.company, title: row.title, jd: row.jd_text ?? '' }))
    go('ai')
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="card">
        <div className="card-body">
          <div className="filters">
            <input className="input" style={{ minWidth: 230 }} placeholder="搜索公司 / 岗位 / JD 关键词" value={keyword} onChange={(e) => changeFilter(setKeyword)(e.target.value)} />
            <select className="select" value={filterType} onChange={(e) => changeFilter(setFilterType)(e.target.value)}>
              {['全部', ...JOB_TYPES].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <select className="select" value={filterStatus} onChange={(e) => changeFilter(setFilterStatus)(e.target.value)}>
              {['全部', 'pool', 'applied', 'archived'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <select className="select" value={sortBy} onChange={(e) => changeFilter(setSortBy)(e.target.value)}>
              {['匹配度', '截止最近', '最新录入'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <span className="spacer" />
            <button className="btn" onClick={rescore} disabled={busy || !rows.length}>
              重算匹配度
            </button>
            {batch.running ? (
              <button className="btn danger" onClick={() => (abortRef.current = true)}>
                停止
              </button>
            ) : (
              <button className="btn" onClick={() => batchScore()} disabled={busy || !selected.length}>
                批量 AI 评分（{selected.length}）
              </button>
            )}
            <button className="btn" onClick={() => setImportOpen(true)}>
              批量导入
            </button>
            <button className="btn primary" onClick={openNew}>
              + 新增岗位
            </button>
          </div>
          {sampleCount ? (
            <div className="hint warn mt8">
              岗位池里有 {sampleCount} 条「示例·」开头的演示数据，它们不是真实在招岗位。
              <button className="linkish" style={{ marginLeft: 8 }} onClick={() => void clearSamples()}>
                一键清空示例数据
              </button>
            </div>
          ) : null}
          {cities.length ? (
            <div className="row wrap mt8" style={{ gap: 6 }}>
              <span className="small muted">城市：</span>
              {cities.slice(0, 12).map((c) => (
                <button key={c} className={keyword === c ? 'chip on' : 'chip'} onClick={() => changeFilter(setKeyword)(keyword === c ? '' : c)}>
                  {c}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <details className="card">
        <summary className="card-head" style={{ cursor: 'pointer' }}>
          <h3>渠道能力边界</h3>
          <span className="small muted">投递永远是人工。点开看采集 / AI 处理 / 投递 / 回填四个环节的分工</span>
        </summary>
        <div className="card-body">
          <div className="table-wrap">
            <table className="tb">
              <thead>
                <tr>
                  <th>渠道</th>
                  <th>采集（岗位怎么进池）</th>
                  <th>AI 处理</th>
                  <th>投递</th>
                  <th>回填（网申表单）</th>
                </tr>
              </thead>
              <tbody>
                {CHANNEL_CAPABILITIES.map((c) => (
                  <tr key={c.channel}>
                    <td className="cell-main">{c.channel}</td>
                    <td>{c.collect}</td>
                    <td>{c.ai}</td>
                    <td>{c.apply}</td>
                    <td>{c.backfill}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="small muted mt8">
            「投递」一列恒为人工：本工作台不登录招聘平台、不自动发送任何消息，最终提交永远由你完成。
            这是产品承诺，不是暂未实现。
          </div>
        </div>
      </details>

      {batch.total ? (
        <div className="card">
          <div className="card-body">
            <div className="row">
              <strong>{batch.running ? '批量评分进行中' : '上次批量评分结果'}</strong>
              <span className="spacer" />
              <span className="small muted">
                {batch.index} / {batch.total}
              </span>
            </div>
            <div className="bar mt8">
              <i style={{ width: `${batch.total ? (batch.index / batch.total) * 100 : 0}%` }} />
            </div>
            <div className="small muted mt8">
              AI 深评 {batch.scored} · 预筛跳过 {batch.skipped} · 硬门槛拦截 {batch.blocked} · 失败 {batch.failed}
              {batch.current ? ` · 当前：${batch.current}` : ''}
            </div>
            <div className="row mt8">
              <span className="small muted">
                流程：硬门槛拦截 → 关键词预筛 → 通过者逐条 AI 七维深评 → 分数写回岗位池，评估记录进 AI 页历史
              </span>
              <span className="spacer" />
              {!batch.running && batch.blockedIds.length ? (
                <button className="btn sm" onClick={() => void batchScore(batch.blockedIds, true)}>
                  仍要深评这些（{batch.blockedIds.length}）
                </button>
              ) : null}
              {!batch.running && batch.failedIds.length ? (
                <button className="btn sm" onClick={() => void batchScore(batch.failedIds)}>
                  重试失败项（{batch.failedIds.length}）
                </button>
              ) : null}
              {!batch.running ? (
                <button className="btn sm ghost" onClick={() => setBatch({ running: false, index: 0, total: 0, scored: 0, skipped: 0, blocked: 0, failed: 0, current: '', failedIds: [], blockedIds: [] })}>
                  收起
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {!loading && rows.length === 0 ? (
        <section className="card">
          <div className="card-body starter">
            <div className="starter-head">
              <h3>岗位池现在是空的，先往里放东西</h3>
              <span className="small muted">这个工具的价值在「有数据之后」才看得出来：匹配度、投递节奏、超期提醒都建立在岗位池之上。</span>
            </div>

            <div className="starter-steps">
              <div className="starter-step">
                <span className="idx">1</span>
                <h4>让岗位进来（四条路，任选）</h4>
                <p>
                  <b>最快：</b>去<b>岗位广场</b>看一眼，那里是所有人共享的岗位库，点「加入岗位池」就把岗位复制进你自己的池子，不用自己抓。
                  <br />
                  <b>快：</b>装了浏览器助手的话，在招聘结果页点「采集本页岗位」，一秒读完当前这一屏，粘到「批量导入」即可入库。
                  <br />
                  <b>批量：</b>跑一次本地抓取器（<code>cd crawler &amp;&amp; npm run crawl -- --site tencent</code>），它会自己翻页、逐个补 JD，
                  产出 <code>crawler/output/*.json</code> 后在「批量导入」里选文件。
                  <br />
                  <b>稳：</b>直接把看到的岗位信息整段复制，点「批量导入」粘进去，会自动拆成公司 / 岗位 / 城市 / 薪资 / 截止 / JD 正文。
                </p>
              </div>
              <div className="starter-step">
                <span className="idx">2</span>
                <h4>让匹配度先跑起来</h4>
                <p>
                  导入后勾选岗位点「批量 AI 评分」。先用本地规则秒筛掉明显不相关的，只把值得看的送大模型七维深评，省额度也省时间。
                </p>
              </div>
              <div className="starter-step">
                <span className="idx">3</span>
                <h4>转入投递并登记沟通</h4>
                <p>
                  匹配度高的点「转投递」，招呼发出去后登记一笔。超过跟进窗口还没回音的，总览页会自动挑出来提醒你换渠道。
                </p>
              </div>
            </div>

            <div className="starter-actions">
              <button className="btn primary" onClick={() => go('square')}>
                去岗位广场挑岗位
              </button>
              <button className="btn" onClick={() => setImportOpen(true)}>
                粘贴导入岗位
              </button>
              <button className="btn" onClick={() => void loadSamples()} disabled={busy}>
                {busy ? '导入中…' : `导入 ${SAMPLE_JOBS.length} 条示例岗位看看`}
              </button>
              <button className="btn" onClick={openNew}>
                手动新增一条
              </button>
            </div>

            <div className="starter-foot">
              示例岗位用「示例·」前缀命名，不是真实在招岗位，看完可一键清空。
              <br />
              本工作台没有服务端爬虫（云上静态站点 + 云数据库，没有常驻进程和浏览器内核）。抓取跑在你自己机器上的
              <code>crawler/</code>：用你自己的网络出口和登录态，只读你屏幕上已经渲染出来的 DOM，串行 + 强制间隔，不调平台接口、不绕验证码。
            </div>
          </div>
        </section>
      ) : null}

      {rows.length ? (
        <section className="card">
          <div className="card-head">
            <h3>岗位清单</h3>
            <span className="spacer" />
            <span className="small muted">
              共 {rows.length} 个 · 当前显示 {shown.length} 个
            </span>
        </div>
        <div className="table-wrap">
          {shown.length === 0 ? (
            <Empty text="当前筛选条件下没有岗位。清掉搜索词，或把类型 / 状态筛选切回「全部」。" />
          ) : (
            <table className="tb">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input
                      type="checkbox"
                      checked={shown.length > 0 && shown.every((r) => selected.includes(r.id))}
                      onChange={(e) => toggleAll(e.target.checked)}
                    />
                  </th>
                  <th>公司 / 岗位</th>
                  <th>城市</th>
                  <th>类型</th>
                  <th>薪资</th>
                  <th>匹配度</th>
                  <th>截止</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggleOne(row.id)} />
                    </td>
                    <td>
                      <div className="cell-main">{row.company}</div>
                      <div className="cell-sub">{row.title}</div>
                    </td>
                    <td>{row.city ?? '暂无'}</td>
                    <td>
                      <span className="badge">{row.job_type ?? '暂无'}</span>
                    </td>
                    <td className="small">{row.salary ?? '暂无'}</td>
                    <td>
                      <ScoreCell value={Number(row.match_score ?? 0)} />
                    </td>
                    <td className="small">
                      {row.deadline ? (
                        <span className={Number(leftText(row.deadline).includes('已过')) ? 'badge' : 'badge warn'}>
                          {fmtDate(row.deadline)} · {leftText(row.deadline)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <span className={row.status === 'applied' ? 'badge ok' : row.status === 'archived' ? 'badge' : 'badge info'}>
                        {row.status === 'applied' ? '已投递' : row.status === 'archived' ? '已归档' : '待投'}
                      </span>
                    </td>
                    <td>
                      <div className="actions">
                        <button className="linkish" onClick={() => setDetail(row)}>
                          详情
                        </button>
                        <button className="linkish" onClick={() => setApplyFor(row)}>
                          转投递
                        </button>
                        <button className="linkish" onClick={() => openEdit(row)}>
                          编辑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </section>
      ) : null}

      {detail ? (
        <Drawer
          title={`${detail.company} · ${detail.title}`}
          onClose={() => setDetail(null)}
          footer={
            <>
              <button className="btn" onClick={() => sendToAi(detail)}>
                AI 评估这个 JD
              </button>
              <button className="btn primary" onClick={() => setApplyFor(detail)}>
                转投递
              </button>
            </>
          }
        >
          <div className="row wrap mb16" style={{ gap: 6 }}>
            {[detail.city, detail.job_type, detail.education, detail.industry, detail.priority ? `优先级 ${detail.priority}` : ''].filter(Boolean).map((t) => (
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
              <div>{detail.salary ?? '暂无'}</div>
            </div>
            <div>
              <div className="small muted">截止日期</div>
              <div>
                {fmtDate(detail.deadline)} {detail.deadline ? `（${leftText(detail.deadline)}）` : ''}
              </div>
            </div>
            <div>
              <div className="small muted">来源</div>
              <div>{detail.source ?? '暂无'}</div>
            </div>
            <div>
              <div className="small muted">匹配度</div>
              <div>{Number(detail.match_score ?? 0)}%</div>
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
            {detail.jd_text || '（未录入 JD 原文，建议补上，AI 评估与打招呼都依赖它）'}
          </div>
          {detail.notes ? (
            <>
              <div className="small muted mt16">备注</div>
              <div className="md">{detail.notes}</div>
            </>
          ) : null}
          <div className="mt16">
            <button className="btn danger sm" onClick={() => void remove(detail)}>
              删除该岗位
            </button>
          </div>
        </Drawer>
      ) : null}

      {editing ? (
        <Modal
          title={editing === 'new' ? '新增岗位' : '编辑岗位'}
          wide
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>
                取消
              </button>
              <button className="btn primary" onClick={save} disabled={busy}>
                {busy ? '保存中…' : '保存'}
              </button>
            </>
          }
        >
          <div className="grid grid-2">
            <Field label="公司 *">
              <input className="input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            </Field>
            <Field label="岗位名称 *">
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="城市">
              <input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>
            <Field label="岗位类型">
              <select className="select" value={form.job_type} onChange={(e) => setForm({ ...form, job_type: e.target.value })}>
                {JOB_TYPES.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="行业">
              <select className="select" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })}>
                {INDUSTRIES.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="学历要求">
              <input className="input" value={form.education} onChange={(e) => setForm({ ...form, education: e.target.value })} />
            </Field>
            <Field label="薪资">
              <input className="input" placeholder="如 150-200/天" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} />
            </Field>
            <Field label="来源">
              <select className="select" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                {/* 当前值不在 CHANNELS（如「AI 评估」「批量导入」）或为空串时追加一项显式展示，
                    否则 select 会显示成第一项「BOSS直聘」，用户一保存真实来源就被覆盖 */}
                {(CHANNELS.includes(form.source) ? CHANNELS : [...CHANNELS, form.source]).map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="优先级">
              <select className="select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {PRIORITIES.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="截止日期">
              <input className="input" type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </Field>
          </div>
          <Field label="岗位链接">
            <input className="input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" />
          </Field>
          <Field label="标签" hint="用顿号或逗号分隔，如 Python、RAG、大模型">
            <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          </Field>
          <Field label="JD 原文" hint="直接粘贴 BOSS / 官网的 JD，匹配度和 AI 评估都基于它">
            <textarea className="textarea" style={{ minHeight: 160 }} value={form.jd_text} onChange={(e) => setForm({ ...form, jd_text: e.target.value })} />
          </Field>
          <Field label="备注">
            <textarea className="textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </Modal>
      ) : null}

      {importOpen ? (
        <JobImportModal
          existing={rows}
          profile={profile}
          onClose={() => setImportOpen(false)}
          onDone={async () => {
            await load()
            await onChanged()
          }}
        />
      ) : null}

      {applyFor ? (
        <Modal
          title={`转入投递 · ${applyFor.company}`}
          onClose={() => setApplyFor(null)}
          footer={
            <>
              <button className="btn" onClick={() => setApplyFor(null)}>
                取消
              </button>
              <button className="btn primary" onClick={submitApply} disabled={busy}>
                {busy ? '提交中…' : '确认投递'}
              </button>
            </>
          }
        >
          <Field label="投递渠道">
            <select className="select" value={applyForm.channel} onChange={(e) => setApplyForm({ ...applyForm, channel: e.target.value })}>
              {CHANNELS.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="使用的简历版本">
            <select className="select" value={applyForm.resume_id} onChange={(e) => setApplyForm({ ...applyForm, resume_id: e.target.value })}>
              <option value="">未指定</option>
              {resumes.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.name} {r.version ?? ''}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-2">
            <Field label="投递日期">
              <input className="input" type="date" value={applyForm.applied_at} onChange={(e) => setApplyForm({ ...applyForm, applied_at: e.target.value })} />
            </Field>
            <Field label="下一步时间">
              <input className="input" type="date" value={applyForm.next_action_at} onChange={(e) => setApplyForm({ ...applyForm, next_action_at: e.target.value })} />
            </Field>
          </div>
          <Field label="下一步动作">
            <input className="input" placeholder="如 3 天后未回复则换渠道跟进" value={applyForm.next_action} onChange={(e) => setApplyForm({ ...applyForm, next_action: e.target.value })} />
          </Field>
          <Field label="备注">
            <textarea className="textarea" value={applyForm.notes} onChange={(e) => setApplyForm({ ...applyForm, notes: e.target.value })} />
          </Field>
        </Modal>
      ) : null}
    </div>
  )
}
