import { useCallback, useEffect, useMemo, useState } from 'react'
import { errText } from '../cloud'
import ConversationDrawer from '../components/ConversationDrawer'
import { Icon, type IconName } from '../components/Icon'
import { Empty, Field, Modal, Stat } from '../components/ui'
import { deleteRow, insertRow, listRows, updateRow } from '../lib/api'
import { CHANNELS, STAGES } from '../lib/constants'
import { lastContactByApplication } from '../lib/conversation'
import { fmtDate, todayISO } from '../lib/format'
import { REPLY_STATUS_LABEL, staleApplications } from '../lib/pace'
import { jobUrlByApplication } from '../lib/timeline'
import { notifyErr, notifyOk } from '../lib/toast'
import type { Row } from '../types'
import type { PageProps } from './Overview'

const PIPE_ICON: Record<string, IconName> = {
  applied: 'send',
  interview: 'interviews',
  offer: 'offers',
}

export default function Pipeline({ profile, onChanged, go }: PageProps) {
  const [rows, setRows] = useState<Row[]>([])
  const [resumes, setResumes] = useState<Row[]>([])
  const [messages, setMessages] = useState<Row[]>([])
  const [jobs, setJobs] = useState<Row[]>([])
  const [convFor, setConvFor] = useState<Row | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'kanban' | 'table'>('kanban')
  const [dragOver, setDragOver] = useState<string>('')
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [interviewFor, setInterviewFor] = useState<Row | null>(null)
  const [interviewForm, setInterviewForm] = useState({ round_name: '一面', kind: '面试', scheduled_at: '', mode: '线上', place: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [apps, rs, msgs, js] = await Promise.all([
        listRows('applications', { limit: 800 }),
        listRows('resumes', { limit: 200 }),
        listRows('messages', { limit: 1000, order: 'sent_at', ascending: false }),
        listRows('jobs', { limit: 800 }),
      ])
      setRows(apps)
      setResumes(rs)
      setMessages(msgs)
      setJobs(js)
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const lastContact = useMemo(() => lastContactByApplication(messages), [messages])
  const stale = useMemo(() => staleApplications(rows, messages), [rows, messages])
  const staleIds = useMemo(() => new Set(stale.map((s) => Number(s.application.id))), [stale])
  // 投递 → 原岗位链接：打招呼、约面、跟进修补都要跳回招聘平台的原帖
  const jobUrlMap = useMemo(() => jobUrlByApplication(rows, jobs), [rows, jobs])

  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const s of STAGES) out[s.key] = rows.filter((r) => r.stage === s.key).length
    return out
  }, [rows])

  async function moveTo(row: Row, stage: string) {
    if (row.stage === stage) return
    try {
      await updateRow('applications', row.id, { stage, updated_at: new Date().toISOString() })
      notifyOk(`已移动到「${STAGES.find((s) => s.key === stage)?.label}」`)
      await load()
      await onChanged()
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  function openEdit(row: Row) {
    setForm({
      company: row.company ?? '',
      title: row.title ?? '',
      city: row.city ?? '',
      stage: row.stage ?? 'applied',
      channel: row.channel ?? 'BOSS直聘',
      resume_id: row.resume_id ? String(row.resume_id) : '',
      applied_at: row.applied_at ? String(row.applied_at).slice(0, 10) : todayISO(),
      next_action: row.next_action ?? '',
      next_action_at: row.next_action_at ? String(row.next_action_at).slice(0, 10) : '',
      contact: row.contact ?? '',
      notes: row.notes ?? '',
    })
    setEditing(row)
  }

  function openNew() {
    setForm({
      company: '',
      title: '',
      city: '',
      stage: 'applied',
      channel: 'BOSS直聘',
      resume_id: '',
      applied_at: todayISO(),
      next_action: '',
      next_action_at: '',
      contact: '',
      notes: '',
    })
    setEditing('new')
  }

  async function save() {
    if (!form.company?.trim() || !form.title?.trim()) {
      notifyErr('公司与岗位名称为必填')
      return
    }
    setBusy(true)
    try {
      const resume = resumes.find((r) => String(r.id) === form.resume_id)
      const payload: Row = {
        company: form.company.trim(),
        title: form.title.trim(),
        city: form.city?.trim() || null,
        stage: form.stage,
        channel: form.channel,
        resume_id: resume?.id ?? null,
        resume_name: resume ? `${resume.name} ${resume.version ?? ''}`.trim() : null,
        applied_at: form.applied_at || todayISO(),
        next_action: form.next_action || null,
        next_action_at: form.next_action_at || null,
        contact: form.contact || null,
        notes: form.notes || null,
      }
      if (editing === 'new') {
        await insertRow('applications', payload)
        notifyOk('已新增投递记录')
      } else if (editing) {
        await updateRow('applications', editing.id, { ...payload, updated_at: new Date().toISOString() })
        notifyOk('已保存')
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

  async function remove(row: Row) {
    if (!window.confirm(`删除「${row.company} · ${row.title}」的投递记录？`)) return
    try {
      await deleteRow('applications', row.id)
      notifyOk('已删除')
      setEditing(null)
      await load()
      await onChanged()
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  async function saveInterview() {
    if (!interviewFor) return
    setBusy(true)
    try {
      await insertRow('interviews', {
        application_id: interviewFor.id,
        company: interviewFor.company,
        title: interviewFor.title,
        round_name: interviewForm.round_name,
        kind: interviewForm.kind,
        scheduled_at: interviewForm.scheduled_at ? new Date(interviewForm.scheduled_at).toISOString() : null,
        mode: interviewForm.mode,
        place: interviewForm.place || null,
        result: 'pending',
      })
      if (interviewFor.stage === 'written') {
        // 笔试通过后进入面试阶段
        await updateRow('applications', interviewFor.id, { stage: 'interview' })
      }
      notifyOk('已记录该轮流程')
      setInterviewFor(null)
      await load()
      await onChanged()
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="grid grid-5">
        {STAGES.map((s) => (
          <Stat key={s.key} label={s.label} value={counts[s.key] ?? 0} icon={<Icon name={PIPE_ICON[s.key] ?? 'clock'} size={15} />} color={s.color} foot={s.key === 'applied' ? '刚投出去的' : s.key === 'offer' ? '拿到手的' : '进行中'} />
        ))}
      </div>

      <div className="card">
        <div className="card-body row wrap">
          <div className="row" style={{ gap: 6 }}>
            <button className={view === 'kanban' ? 'chip on' : 'chip'} onClick={() => setView('kanban')}>
              看板视图
            </button>
            <button className={view === 'table' ? 'chip on' : 'chip'} onClick={() => setView('table')}>
              表格视图
            </button>
          </div>
          <span className="spacer" />
          <span className="small muted">看板支持拖拽卡片切换阶段</span>
          <button className="btn primary" onClick={openNew}>
            + 新增投递
          </button>
        </div>
      </div>

      {view === 'kanban' ? (
        <div className="kanban">
          {STAGES.map((s) => {
            const list = rows.filter((r) => r.stage === s.key)
            return (
              <div
                key={s.key}
                className={dragOver === s.key ? 'kcol drag-over' : 'kcol'}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(s.key)
                }}
                onDragLeave={() => setDragOver('')}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver('')
                  const id = Number(e.dataTransfer.getData('text/plain'))
                  const row = rows.find((r) => r.id === id)
                  if (row) void moveTo(row, s.key)
                }}
              >
                <div className="kcol-head">
                  <span className="dot" style={{ background: s.color }} />
                  {s.label}
                  <span className="spacer" />
                  <span className="muted mono">{list.length}</span>
                </div>
                {list.map((row) => (
                  <div
                    key={row.id}
                    className="kcard"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', String(row.id))}
                  >
                    <div className="kcard-title">
                      {row.company} · {row.title}
                    </div>
                    <div className="kcard-meta">
                      {row.city ? `${row.city} · ` : ''}
                      {row.channel ?? '渠道未记'}
                      <br />
                      投递：{fmtDate(row.applied_at)}
                      {row.resume_name ? (
                        <>
                          <br />
                          简历：{row.resume_name}
                        </>
                      ) : null}
                      {lastContact[String(row.id)] ? (
                        <>
                          <br />
                          最近沟通：
                          {(REPLY_STATUS_LABEL[String(lastContact[String(row.id)].reply_status)] ?? { text: '已记录' }).text} · {fmtDate(lastContact[String(row.id)].sent_at ?? lastContact[String(row.id)].created_at)}
                        </>
                      ) : null}
                      {row.next_action ? (
                        <>
                          <br />
                          下一步：{row.next_action}
                          {row.next_action_at ? `（${fmtDate(row.next_action_at)}）` : ''}
                        </>
                      ) : null}
                    </div>
                    {staleIds.has(Number(row.id)) ? (
                      <div className="small" style={{ color: 'var(--up)', marginTop: 6 }}>
                        ⚠ {stale.find((s) => Number(s.application.id) === Number(row.id))?.days} 天没有新进展，该跟进了
                      </div>
                    ) : null}
                    <div className="kcard-actions">
                      <button className="btn sm" onClick={() => setConvFor(row)}>
                        会话
                      </button>
                      <button className="btn sm ghost" onClick={() => setInterviewFor(row)}>
                        面试
                      </button>
                      <button className="btn sm ghost" onClick={() => openEdit(row)}>
                        详情
                      </button>
                      {jobUrlMap.get(Number(row.id)) ? (
                        <a className="btn sm ghost" href={jobUrlMap.get(Number(row.id))} target="_blank" rel="noreferrer">
                          原岗位 ↗
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))}
                {list.length === 0 ? <div className="small muted" style={{ padding: '8px 4px' }}>拖卡片到这里</div> : null}
              </div>
            )
          })}
        </div>
      ) : (
        <section className="card">
          <div className="card-head">
            <h3>投递记录</h3>
            <span className="spacer" />
            <span className="small muted">共 {rows.length} 条</span>
          </div>
          <div className="table-wrap">
            {rows.length === 0 ? (
              <Empty text={loading ? '加载中…' : '还没有投递记录。'} action={<button className="btn primary sm" onClick={openNew}>新增第一条</button>} />
            ) : (
              <table className="tb">
                <thead>
                  <tr>
                    <th>公司 / 岗位</th>
                    <th>阶段</th>
                    <th>最近沟通</th>
                    <th>渠道</th>
                    <th>投递日期</th>
                    <th>下一步</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="cell-main">{row.company}</div>
                        <div className="cell-sub">{row.title}</div>
                      </td>
                      <td>
                        <select className="select" style={{ padding: '4px 8px' }} value={row.stage} onChange={(e) => void moveTo(row, e.target.value)}>
                          {STAGES.map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="small">
                        {lastContact[String(row.id)] ? (
                          <>
                            <span className={(REPLY_STATUS_LABEL[String(lastContact[String(row.id)].reply_status)] ?? { cls: 'badge' }).cls}>
                              {(REPLY_STATUS_LABEL[String(lastContact[String(row.id)].reply_status)] ?? { text: '已记录' }).text}
                            </span>
                            <div className="cell-sub">{fmtDate(lastContact[String(row.id)].sent_at ?? lastContact[String(row.id)].created_at)}</div>
                          </>
                        ) : (
                          <span className="muted">暂无</span>
                        )}
                      </td>
                      <td className="small">{row.channel ?? '暂无'}</td>
                      <td className="small">{fmtDate(row.applied_at)}</td>
                      <td className="small">{row.next_action ?? '暂无'}</td>
                      <td>
                        <div className="actions">
                          <button className="linkish" onClick={() => setConvFor(row)}>
                            会话
                          </button>
                          <button className="linkish" onClick={() => openEdit(row)}>
                            编辑
                          </button>
                          <button className="linkish" onClick={() => setInterviewFor(row)}>
                            面试
                          </button>
                          {jobUrlMap.get(Number(row.id)) ? (
                            <a className="linkish" href={jobUrlMap.get(Number(row.id))} target="_blank" rel="noreferrer">
                              原岗位
                            </a>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      <div className="hint">
        提示：每次改完阶段，总览与提醒日历会同步更新；面试 / 笔试日程建议用「记一笔流程」登记，日历页会显示。
        <button className="linkish" style={{ marginLeft: 8 }} onClick={() => go('interviews', 'calendar')}>
          去看日历
        </button>
      </div>

      {editing ? (
        <Modal
          title={editing === 'new' ? '新增投递' : `编辑 · ${(editing as Row).company}`}
          wide
          onClose={() => setEditing(null)}
          footer={
            <>
              {editing !== 'new' ? (
                <button className="btn danger" onClick={() => void remove(editing as Row)}>
                  删除
                </button>
              ) : null}
              <span className="spacer" />
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
              <input className="input" value={form.company ?? ''} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            </Field>
            <Field label="岗位 *">
              <input className="input" value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="城市">
              <input className="input" value={form.city ?? ''} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>
            <Field label="阶段">
              <select className="select" value={form.stage ?? 'applied'} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="渠道">
              <select className="select" value={form.channel ?? ''} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                {CHANNELS.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="简历版本">
              <select className="select" value={form.resume_id ?? ''} onChange={(e) => setForm({ ...form, resume_id: e.target.value })}>
                <option value="">未指定</option>
                {resumes.map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {r.name} {r.version ?? ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="投递日期">
              <input className="input" type="date" value={form.applied_at ?? ''} onChange={(e) => setForm({ ...form, applied_at: e.target.value })} />
            </Field>
            <Field label="下一步时间">
              <input className="input" type="date" value={form.next_action_at ?? ''} onChange={(e) => setForm({ ...form, next_action_at: e.target.value })} />
            </Field>
          </div>
          <Field label="下一步动作">
            <input className="input" value={form.next_action ?? ''} onChange={(e) => setForm({ ...form, next_action: e.target.value })} />
          </Field>
          <Field label="联系人 / 联系方式">
            <input className="input" value={form.contact ?? ''} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          </Field>
          <Field label="备注">
            <textarea className="textarea" value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </Modal>
      ) : null}

      {interviewFor ? (
        <Modal
          title={`记录流程 · ${interviewFor.company}`}
          onClose={() => setInterviewFor(null)}
          footer={
            <>
              <button className="btn" onClick={() => setInterviewFor(null)}>
                取消
              </button>
              <button className="btn primary" onClick={saveInterview} disabled={busy}>
                {busy ? '保存中…' : '保存'}
              </button>
            </>
          }
        >
          <div className="grid grid-2">
            <Field label="类型">
              <select className="select" value={interviewForm.kind} onChange={(e) => setInterviewForm({ ...interviewForm, kind: e.target.value })}>
                {['笔试', '面试', '宣讲', '其它'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="轮次">
              <select className="select" value={interviewForm.round_name} onChange={(e) => setInterviewForm({ ...interviewForm, round_name: e.target.value })}>
                {['笔试', '一面', '二面', '三面', 'HR 面', '终面'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="时间">
              <input className="input" type="datetime-local" value={interviewForm.scheduled_at} onChange={(e) => setInterviewForm({ ...interviewForm, scheduled_at: e.target.value })} />
            </Field>
            <Field label="形式">
              <select className="select" value={interviewForm.mode} onChange={(e) => setInterviewForm({ ...interviewForm, mode: e.target.value })}>
                {['线上', '线下', '电话'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="地点 / 会议链接">
            <input className="input" value={interviewForm.place} onChange={(e) => setInterviewForm({ ...interviewForm, place: e.target.value })} />
          </Field>
        </Modal>
      ) : null}

      {convFor ? (
        <ConversationDrawer
          application={convFor}
          messages={messages}
          profile={profile}
          jobUrl={jobUrlMap.get(Number(convFor.id)) ?? null}
          onClose={() => setConvFor(null)}
          onChanged={async () => {
            await load()
            await onChanged()
          }}
        />
      ) : null}

      {stale.length ? (
        <div className="hint">
          有 {stale.length} 个岗位超过 7 天没有新进展（卡片上已标红）：
          {stale.slice(0, 3).map((s) => ` ${s.application.company}（${s.days} 天）`).join('、')}
          {stale.length > 3 ? ' 等' : ''}。点卡片上的「会话」记一条跟进，或换渠道再试一次。
        </div>
      ) : null}
    </div>
  )
}
