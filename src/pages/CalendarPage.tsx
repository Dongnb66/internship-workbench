import { useCallback, useEffect, useMemo, useState } from 'react'
import { errText } from '../cloud'
import { Empty, Field, Modal } from '../components/ui'
import { insertRow, listRows, updateRow } from '../lib/api'
import { TASK_KINDS } from '../lib/constants'
import { fmtDateTime, monthLabel, monthMatrix, pad, todayISO } from '../lib/format'
import { notifyErr, notifyOk } from '../lib/toast'
import type { Row } from '../types'
import type { PageProps } from './Overview'

interface Ev {
  date: string
  label: string
  kind: 'task' | 'interview' | 'deadline' | 'next'
}

const KIND_CLASS: Record<Ev['kind'], string> = {
  task: 'ev',
  interview: 'ev violet',
  deadline: 'ev',
  next: 'ev blue',
}

export default function CalendarPage({ onChanged }: PageProps) {
  const [cursor, setCursor] = useState(() => new Date())
  const [tasks, setTasks] = useState<Row[]>([])
  const [ivs, setIvs] = useState<Row[]>([])
  const [jobs, setJobs] = useState<Row[]>([])
  const [apps, setApps] = useState<Row[]>([])
  const [adding, setAdding] = useState<string | null>(null)
  const [form, setForm] = useState({ title: '', kind: '投递', time: '', company: '', notes: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [t, i, j, a] = await Promise.all([
        listRows('tasks', { limit: 500, order: 'due_at', ascending: true }),
        listRows('interviews', { limit: 500, order: 'scheduled_at', ascending: true }),
        listRows('jobs', { limit: 800 }),
        listRows('applications', { limit: 800 }),
      ])
      setTasks(t)
      setIvs(i)
      setJobs(j)
      setApps(a)
    } catch (error) {
      notifyErr(errText(error))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const events = useMemo<Ev[]>(() => {
    const out: Ev[] = []
    for (const t of tasks) {
      if (t.due_at) out.push({ date: String(t.due_at).slice(0, 10), label: `${t.done ? '✓ ' : ''}${t.title}`, kind: 'task' })
    }
    for (const i of ivs) {
      if (i.scheduled_at) out.push({ date: String(i.scheduled_at).slice(0, 10), label: `${i.company} ${i.round_name ?? i.kind ?? '面试'}`, kind: 'interview' })
    }
    for (const j of jobs) {
      if (j.deadline) out.push({ date: String(j.deadline).slice(0, 10), label: `${j.company} 截止`, kind: 'deadline' })
    }
    for (const a of apps) {
      if (a.next_action_at) out.push({ date: String(a.next_action_at).slice(0, 10), label: `${a.company} 跟进`, kind: 'next' })
    }
    return out
  }, [tasks, ivs, jobs, apps])

  const weeks = monthMatrix(cursor)
  const today = todayISO()
  const monthKey = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`

  const upcoming = events
    .filter((e) => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 12)

  function shiftMonth(delta: number) {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1))
  }

  async function save() {
    if (!form.title.trim()) {
      notifyErr('待办内容不能为空')
      return
    }
    setBusy(true)
    try {
      await insertRow('tasks', {
        title: form.title.trim(),
        kind: form.kind,
        due_at: form.time ? new Date(form.time).toISOString() : adding ? new Date(`${adding}T23:59:00`).toISOString() : null,
        company: form.company || null,
        notes: form.notes || null,
        done: false,
      })
      notifyOk('已加入日历')
      setAdding(null)
      setForm({ title: '', kind: '投递', time: '', company: '', notes: '' })
      await load()
      await onChanged()
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(task: Row) {
    try {
      await updateRow('tasks', task.id, { done: !task.done })
      await load()
      await onChanged()
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="card">
        <div className="card-body row wrap">
          <button className="btn sm" onClick={() => shiftMonth(-1)}>
            ← 上月
          </button>
          <strong>{monthLabel(cursor)}</strong>
          <button className="btn sm" onClick={() => shiftMonth(1)}>
            下月 →
          </button>
          <button
            className="btn sm ghost"
            onClick={() => {
              setCursor(new Date())
              setAdding(today)
            }}
          >
            今天 + 加待办
          </button>
          <span className="spacer" />
          <span className="small muted">本月事项 {events.filter((e) => e.date.startsWith(monthKey)).length} 条 · 未来待办 {upcoming.filter((e) => e.kind === 'task').length} 条</span>
        </div>
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start', gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)' }}>
        <section className="card">
          <div className="card-body">
            <div className="cal">
              {['日', '一', '二', '三', '四', '五', '六'].map((h) => (
                <div className="h" key={h}>
                  {h}
                </div>
              ))}
              {weeks.flat().map((d) => {
                const dayEvents = events.filter((e) => e.date === d)
                const out = !d.startsWith(monthKey)
                return (
                  <div key={d} className={`d${out ? ' out' : ''}${d === today ? ' today' : ''}`} onClick={() => setAdding(d)} style={{ cursor: 'pointer' }}>
                    <b>{Number(d.slice(8, 10))}</b>
                    {dayEvents.slice(0, 3).map((e, i) => (
                      <div key={i} className={KIND_CLASS[e.kind]} title={e.label}>
                        {e.label}
                      </div>
                    ))}
                    {dayEvents.length > 3 ? <div className="ev">+{dayEvents.length - 3}</div> : null}
                  </div>
                )
              })}
            </div>
            <div className="row wrap small muted mt8" style={{ gap: 12 }}>
              <span>紫 = 面试/笔试</span>
              <span>橙 = 岗位截止 / 待办</span>
              <span>蓝 = 投递跟进</span>
              <span>点任意日期可加待办</span>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>接下来</h3>
            <span className="spacer" />
            <button className="btn sm" onClick={() => setAdding(today)}>
              + 加待办
            </button>
          </div>
          <div className="card-body">
            {upcoming.length === 0 ? (
              <Empty text="未来没有排期事项。" />
            ) : (
              upcoming.map((e, idx) => {
                const task = tasks.find((t) => t.due_at && String(t.due_at).slice(0, 10) === e.date && e.label.includes(String(t.title)))
                return (
                  <div key={idx} className="row" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
                    {task ? <input type="checkbox" checked={Boolean(task.done)} onChange={() => void toggle(task)} /> : <span className="badge">·</span>}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>{e.label}</div>
                      <div className="cell-sub">{e.date}</div>
                    </div>
                  </div>
                )
              })
            )}
            <div className="small muted mt16">最近更新时间 {fmtDateTime(new Date().toISOString())}</div>
          </div>
        </section>
      </div>

      {adding ? (
        <Modal
          title={`新增待办 · ${adding}`}
          onClose={() => setAdding(null)}
          footer={
            <>
              <button className="btn" onClick={() => setAdding(null)}>
                取消
              </button>
              <button className="btn primary" onClick={save} disabled={busy}>
                {busy ? '保存中…' : '保存'}
              </button>
            </>
          }
        >
          <Field label="待办内容 *">
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如 跟进字节 HR，问笔试安排" />
          </Field>
          <div className="grid grid-2">
            <Field label="类型">
              <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {TASK_KINDS.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="时间">
              <input className="input" type="datetime-local" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </Field>
          </div>
          <Field label="相关公司">
            <input className="input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </Field>
          <Field label="备注">
            <textarea className="textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </Modal>
      ) : null}
    </div>
  )
}
