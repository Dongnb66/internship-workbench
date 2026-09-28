import { useCallback, useEffect, useMemo, useState } from 'react'
import { errText } from '../cloud'
import { Icon } from '../components/Icon'
import { Empty, Field, Modal, Stat } from '../components/ui'
import { deleteRow, insertRow, listRows, updateRow } from '../lib/api'
import { DIMS } from '../lib/constants'
import { fmtDate, leftText, num } from '../lib/format'
import { notifyErr, notifyOk } from '../lib/toast'
import type { Row } from '../types'
import type { PageProps } from './Overview'

const DECISION_LABEL: Record<string, { text: string; cls: string }> = {
  undecided: { text: '待决策', cls: 'badge warn' },
  accepted: { text: '已接受', cls: 'badge ok' },
  declined: { text: '已拒绝', cls: 'badge' },
}

export default function Offers({ onChanged }: PageProps) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [dims, setDims] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await listRows('offers', { limit: 200 }))
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function blankDims(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const d of DIMS) out[d] = 6
    return out
  }

  function openNew() {
    setForm({ company: '', title: '', city: '', daily_rate: '', monthly_salary: '', allowance: '', months: '', start_date: '', deadline: '', decision: 'undecided', notes: '' })
    setDims(blankDims())
    setEditing('new')
  }

  function openEdit(row: Row) {
    setForm({
      company: row.company ?? '',
      title: row.title ?? '',
      city: row.city ?? '',
      daily_rate: row.daily_rate ?? '',
      monthly_salary: row.monthly_salary ?? '',
      allowance: row.allowance ?? '',
      months: row.months ?? '',
      start_date: row.start_date ? String(row.start_date).slice(0, 10) : '',
      deadline: row.deadline ? String(row.deadline).slice(0, 10) : '',
      decision: row.decision ?? 'undecided',
      notes: row.notes ?? '',
    })
    setDims({ ...blankDims(), ...(row.dims ?? {}) })
    setEditing(row)
  }

  async function save() {
    if (!form.company?.trim()) {
      notifyErr('公司名称为必填')
      return
    }
    setBusy(true)
    try {
      const payload: Row = {
        company: form.company.trim(),
        title: form.title || null,
        city: form.city || null,
        daily_rate: form.daily_rate ? num(form.daily_rate) : null,
        monthly_salary: form.monthly_salary ? num(form.monthly_salary) : null,
        allowance: form.allowance ? num(form.allowance) : null,
        months: form.months ? num(form.months) : null,
        start_date: form.start_date || null,
        deadline: form.deadline || null,
        dims,
        decision: form.decision || 'undecided',
        notes: form.notes || null,
      }
      if (editing === 'new') {
        await insertRow('offers', payload)
        notifyOk('已添加 Offer')
      } else if (editing) {
        await updateRow('offers', editing.id, payload)
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

  async function decide(row: Row, decision: string) {
    try {
      await updateRow('offers', row.id, { decision })
      notifyOk(decision === 'accepted' ? '已标记接受' : decision === 'declined' ? '已标记拒绝' : '已改为待决策')
      await load()
      await onChanged()
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  async function remove(row: Row) {
    if (!window.confirm(`删除 ${row.company} 的 Offer 记录？`)) return
    try {
      await deleteRow('offers', row.id)
      notifyOk('已删除')
      setEditing(null)
      await load()
      await onChanged()
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  const ranking = useMemo(() => {
    return rows
      .map((r) => {
        const values = DIMS.map((d) => num(r.dims?.[d] ?? 0)).filter((v) => v > 0)
        const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
        return { row: r, avg }
      })
      .sort((a, b) => b.avg - a.avg)
  }, [rows])

  const monthly = (r: Row): number => {
    const days = 21.75
    if (r.daily_rate) return num(r.daily_rate) * days
    return num(r.monthly_salary)
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="grid grid-4">
        <Stat label="Offer 总数" value={rows.length} icon={<Icon name="offers" size={15} />} color="#12a150" foot="拿到手的" />
        <Stat label="待决策" value={rows.filter((r) => (r.decision ?? 'undecided') === 'undecided').length} icon={<Icon name="help" size={15} />} color="#f59e0b" foot="还没定的" />
        <Stat label="已接受" value={rows.filter((r) => r.decision === 'accepted').length} icon={<Icon name="check" size={15} />} color="#3b82f6" foot="定下来的" />
        <Stat label="最高月折算" value={rows.length ? `¥${Math.round(Math.max(...rows.map((r) => monthly(r)))).toLocaleString('zh-CN')}` : '—'} icon={<Icon name="money" size={15} />} color="#e8443a" foot="日薪按 21.75 天折算" />
      </div>

      <section className="card">
        <div className="card-head">
          <h3>Offer 对比（按多维评分排序）</h3>
          <span className="spacer" />
          <button className="btn primary" onClick={openNew}>
            + 添加 Offer
          </button>
        </div>
        <div className="table-wrap">
          {rows.length === 0 ? (
            <Empty text={loading ? '加载中…' : '还没有 Offer。拿到后记一条，多维打分能帮你少纠结。'} action={<button className="btn primary sm" onClick={openNew}>添加第一个 Offer</button>} />
          ) : (
            <table className="tb">
              <thead>
                <tr>
                  <th>公司 / 岗位</th>
                  <th>城市</th>
                  <th>日薪 / 月折算</th>
                  <th>评分均值</th>
                  <th>截止</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map(({ row, avg }) => (
                  <tr key={row.id}>
                    <td>
                      <div className="cell-main">{row.company}</div>
                      <div className="cell-sub">{row.title ?? '—'}</div>
                    </td>
                    <td>{row.city ?? '—'}</td>
                    <td className="small">
                      {row.daily_rate ? `¥${row.daily_rate}/天` : '—'}
                      <br />
                      <span className="muted">≈ ¥{Math.round(monthly(row)).toLocaleString('zh-CN')}/月</span>
                    </td>
                    <td>
                      <span className="mono" style={{ fontWeight: 600 }}>
                        {avg.toFixed(1)}
                      </span>
                      <span className="muted small"> / 10</span>
                    </td>
                    <td className="small">{row.deadline ? `${fmtDate(row.deadline)} · ${leftText(row.deadline)}` : '—'}</td>
                    <td>
                      <span className={DECISION_LABEL[row.decision ?? 'undecided']?.cls}>{DECISION_LABEL[row.decision ?? 'undecided']?.text}</span>
                    </td>
                    <td>
                      <div className="actions">
                        <button className="linkish" onClick={() => openEdit(row)}>
                          编辑
                        </button>
                        <button className="linkish" onClick={() => void decide(row, 'accepted')}>
                          接受
                        </button>
                        <button className="linkish" onClick={() => void decide(row, 'declined')}>
                          拒绝
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

      {rows.length ? (
        <section className="card">
          <div className="card-head">
            <h3>逐项维度对比</h3>
            <span className="spacer" />
            <span className="small muted">1-10 分，自己按真实感受打</span>
          </div>
          <div className="card-body grid grid-2">
            {ranking.map(({ row, avg }) => (
              <div key={row.id} className="card" style={{ boxShadow: 'none' }}>
                <div className="card-body">
                  <div className="row">
                    <span className="cell-main">{row.company}</span>
                    <span className="spacer" />
                    <span className="badge brand">均值 {avg.toFixed(1)}</span>
                  </div>
                  <div className="mt8">
                    {DIMS.map((d) => (
                      <div className="dim-row" key={d}>
                        <span className="muted">{d}</span>
                        <div className="bar">
                          <i style={{ width: `${(num(row.dims?.[d] ?? 0) / 10) * 100}%` }} />
                        </div>
                        <span className="mono" style={{ textAlign: 'right' }}>
                          {num(row.dims?.[d] ?? 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {row.notes ? <div className="small muted mt8">{row.notes}</div> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {editing ? (
        <Modal
          wide
          title={editing === 'new' ? '添加 Offer' : `编辑 Offer · ${(editing as Row).company}`}
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
            <Field label="岗位">
              <input className="input" value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="城市">
              <input className="input" value={form.city ?? ''} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>
            <Field label="日薪（元）">
              <input className="input" value={form.daily_rate ?? ''} onChange={(e) => setForm({ ...form, daily_rate: e.target.value })} />
            </Field>
            <Field label="月薪（元）">
              <input className="input" value={form.monthly_salary ?? ''} onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })} />
            </Field>
            <Field label="补贴 / 房补（元/月）">
              <input className="input" value={form.allowance ?? ''} onChange={(e) => setForm({ ...form, allowance: e.target.value })} />
            </Field>
            <Field label="实习月数">
              <input className="input" value={form.months ?? ''} onChange={(e) => setForm({ ...form, months: e.target.value })} />
            </Field>
            <Field label="入职时间">
              <input className="input" type="date" value={form.start_date ?? ''} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </Field>
            <Field label="答复截止">
              <input className="input" type="date" value={form.deadline ?? ''} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </Field>
            <Field label="决策">
              <select className="select" value={form.decision ?? 'undecided'} onChange={(e) => setForm({ ...form, decision: e.target.value })}>
                <option value="undecided">待决策</option>
                <option value="accepted">已接受</option>
                <option value="declined">已拒绝</option>
              </select>
            </Field>
          </div>

          <div className="small muted mb8">多维评分（1-10）</div>
          {DIMS.map((d) => (
            <div className="dim-row" key={d}>
              <span className="muted">{d}</span>
              <input
                type="range"
                min={1}
                max={10}
                value={dims[d] ?? 6}
                onChange={(e) => setDims({ ...dims, [d]: Number(e.target.value) })}
              />
              <span className="mono" style={{ textAlign: 'right' }}>
                {dims[d] ?? 6}
              </span>
            </div>
          ))}
          <Field label="备注">
            <textarea className="textarea" value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </Modal>
      ) : null}
    </div>
  )
}
