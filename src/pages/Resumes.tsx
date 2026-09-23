import { useCallback, useEffect, useState } from 'react'
import { errText } from '../cloud'
import { Empty, Field, Modal, Stat } from '../components/ui'
import { deleteRow, insertRow, listRows, updateRow } from '../lib/api'
import { RESUME_DIRECTIONS } from '../lib/constants'
import { fmtDate } from '../lib/format'
import { notifyErr, notifyOk } from '../lib/toast'
import type { Row } from '../types'
import type { PageProps } from './Overview'

export default function Resumes({ onChanged, go }: PageProps) {
  const [rows, setRows] = useState<Row[]>([])
  const [apps, setApps] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rs, as] = await Promise.all([listRows('resumes', { limit: 200 }), listRows('applications', { limit: 800 })])
      setRows(rs)
      setApps(as)
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openNew() {
    setForm({ name: '', version: 'v1', direction: 'AI Agent 方向', target_role: '', file_url: '', highlights: '', projects: '', notes: '', is_default: 'false' })
    setEditing('new')
  }

  function openEdit(row: Row) {
    setForm({
      name: row.name ?? '',
      version: row.version ?? 'v1',
      direction: row.direction ?? '',
      target_role: row.target_role ?? '',
      file_url: row.file_url ?? '',
      highlights: row.highlights ?? '',
      projects: row.projects ?? '',
      notes: row.notes ?? '',
      is_default: row.is_default ? 'true' : 'false',
    })
    setEditing(row)
  }

  async function save() {
    if (!form.name?.trim()) {
      notifyErr('简历名称必填，如「杨运栋-AI Agent方向」')
      return
    }
    setBusy(true)
    try {
      const payload: Row = {
        name: form.name.trim(),
        version: form.version || 'v1',
        direction: form.direction || null,
        target_role: form.target_role || null,
        file_url: form.file_url || null,
        highlights: form.highlights || null,
        projects: form.projects || null,
        notes: form.notes || null,
        is_default: form.is_default === 'true',
      }
      if (editing === 'new') {
        const created = await insertRow('resumes', payload)
        if (payload.is_default) await clearOtherDefaults(created.id)
        notifyOk('已添加简历版本')
      } else if (editing) {
        await updateRow('resumes', editing.id, payload)
        if (payload.is_default) await clearOtherDefaults(editing.id)
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

  async function clearOtherDefaults(keepId: number) {
    for (const r of rows) {
      if (r.id !== keepId && r.is_default) {
        await updateRow('resumes', r.id, { is_default: false })
      }
    }
  }

  async function setDefault(row: Row) {
    try {
      await updateRow('resumes', row.id, { is_default: true })
      await clearOtherDefaults(row.id)
      notifyOk('已设为默认版本')
      await load()
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  async function remove(row: Row) {
    if (!window.confirm(`删除简历版本「${row.name} ${row.version ?? ''}」？已有投递记录里的简历名不会受影响。`)) return
    try {
      await deleteRow('resumes', row.id)
      notifyOk('已删除')
      setEditing(null)
      await load()
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  const usage = (row: Row) => apps.filter((a) => Number(a.resume_id) === Number(row.id) || a.resume_name === `${row.name} ${row.version ?? ''}`.trim()).length

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="grid grid-2">
        <Stat label="简历版本" value={rows.length} icon="📄" color="#3b82f6" foot="按方向各留一版" />
        <Stat
          label="投递最多的一版"
          value={rows.length ? [...rows].sort((a, b) => usage(b) - usage(a))[0].name : '—'}
          icon="🔥"
          color="#f2542d"
          foot={rows.length ? `被使用 ${usage([...rows].sort((a, b) => usage(b) - usage(a))[0])} 次` : '还没有版本'}
        />
      </div>

      <section className="card">
        <div className="card-head">
          <h3>简历库</h3>
          <span className="spacer" />
          <span className="small muted">文件本身放网盘 / 本地，这里登记版本用途与使用情况</span>
          <button className="btn primary" onClick={openNew}>
            + 新增版本
          </button>
        </div>
        <div className="table-wrap">
          {rows.length === 0 ? (
            <Empty
              text={loading ? '加载中…' : '还没有登记简历版本。建议至少按「方向」拆两版：AI Agent 方向、后端方向。'}
              action={<button className="btn primary sm" onClick={openNew}>登记第一个版本</button>}
            />
          ) : (
            <table className="tb">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>方向</th>
                  <th>目标岗位</th>
                  <th>使用次数</th>
                  <th>默认</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="cell-main">
                        {row.name} <span className="badge">{row.version ?? 'v1'}</span>
                      </div>
                      <div className="cell-sub">更新于 {fmtDate(row.created_at)}</div>
                    </td>
                    <td className="small">{row.direction ?? '—'}</td>
                    <td className="small">{row.target_role ?? '—'}</td>
                    <td className="mono">{usage(row)}</td>
                    <td>{row.is_default ? <span className="badge ok">默认</span> : <span className="badge">—</span>}</td>
                    <td>
                      <div className="actions">
                        <button className="linkish" onClick={() => setDefault(row)}>
                          设为默认
                        </button>
                        <button className="linkish" onClick={() => openEdit(row)}>
                          编辑
                        </button>
                        {row.file_url ? (
                          <a className="linkish" href={row.file_url} target="_blank" rel="noreferrer">
                            打开文件
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

      <div className="hint">
        下一版简历按 JD 定制更有效：在 AI 页粘一个 JD，直接拿到匹配亮点、缺口和打招呼话术，再决定改哪几个项目描述。
        <button className="linkish" style={{ marginLeft: 8 }} onClick={() => go('ai')}>
          去 AI 页
        </button>
      </div>

      {editing ? (
        <Modal
          wide
          title={editing === 'new' ? '登记简历版本' : `编辑 · ${(editing as Row).name}`}
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
            <Field label="名称 *">
              <input className="input" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 杨运栋-通用投递" />
            </Field>
            <Field label="版本号">
              <input className="input" value={form.version ?? ''} onChange={(e) => setForm({ ...form, version: e.target.value })} />
            </Field>
            <Field label="方向">
              <select className="select" value={form.direction ?? ''} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
                <option value="">未指定</option>
                {RESUME_DIRECTIONS.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="目标岗位">
              <input className="input" value={form.target_role ?? ''} onChange={(e) => setForm({ ...form, target_role: e.target.value })} placeholder="如 AI 应用开发实习生" />
            </Field>
            <Field label="是否默认">
              <select className="select" value={form.is_default ?? 'false'} onChange={(e) => setForm({ ...form, is_default: e.target.value })}>
                <option value="false">否</option>
                <option value="true">是</option>
              </select>
            </Field>
            <Field label="文件链接">
              <input className="input" value={form.file_url ?? ''} onChange={(e) => setForm({ ...form, file_url: e.target.value })} placeholder="https:// 网盘 / 在线简历" />
            </Field>
          </div>
          <Field label="亮点摘要" hint="这一版主打的 3 条能力，投递时对照 JD 快速确认">
            <textarea className="textarea" value={form.highlights ?? ''} onChange={(e) => setForm({ ...form, highlights: e.target.value })} />
          </Field>
          <Field label="项目与数字">
            <textarea className="textarea" value={form.projects ?? ''} onChange={(e) => setForm({ ...form, projects: e.target.value })} />
          </Field>
          <Field label="备注">
            <textarea className="textarea" value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </Modal>
      ) : null}
    </div>
  )
}
