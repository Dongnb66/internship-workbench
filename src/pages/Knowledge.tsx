import { useCallback, useEffect, useState } from 'react'
import { errText } from '../cloud'
import { Empty, Field, Modal } from '../components/ui'
import { deleteRow, insertRow, listRows, updateRow } from '../lib/api'
import { KNOW_CATEGORIES } from '../lib/constants'
import { fmtDate, textToArray } from '../lib/format'
import { notifyErr, notifyOk } from '../lib/toast'
import type { Row } from '../types'
import type { PageProps } from './Overview'

export default function Knowledge({ onChanged }: PageProps) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('全部')
  const [keyword, setKeyword] = useState('')
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await listRows('knowledge', { limit: 500 }))
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const shown = rows.filter((r) => {
    if (category !== '全部' && r.category !== category) return false
    const kw = keyword.trim().toLowerCase()
    if (!kw) return true
    return `${r.title} ${r.content ?? ''} ${(r.tags ?? []).join(' ')}`.toLowerCase().includes(kw)
  })

  function openNew() {
    setForm({ title: '', category: '八股', content: '', tags: '' })
    setEditing('new')
  }

  function openEdit(row: Row) {
    setForm({
      title: row.title ?? '',
      category: row.category ?? '八股',
      content: row.content ?? '',
      tags: (row.tags ?? []).join('、'),
    })
    setEditing(row)
  }

  async function save() {
    if (!form.title?.trim()) {
      notifyErr('标题必填')
      return
    }
    setBusy(true)
    try {
      const payload: Row = {
        title: form.title.trim(),
        category: form.category,
        content: form.content ?? '',
        tags: textToArray(form.tags ?? ''),
      }
      if (editing === 'new') {
        await insertRow('knowledge', payload)
        notifyOk('已沉淀一条')
      } else if (editing) {
        await updateRow('knowledge', editing.id, payload)
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
    if (!window.confirm(`删除「${row.title}」？`)) return
    try {
      await deleteRow('knowledge', row.id)
      notifyOk('已删除')
      setEditing(null)
      await load()
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="card">
        <div className="card-body row wrap">
          <input className="input" style={{ minWidth: 220 }} placeholder="搜索标题 / 内容 / 标签" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <div className="row wrap" style={{ gap: 6 }}>
            {['全部', ...KNOW_CATEGORIES].map((c) => (
              <button key={c} className={category === c ? 'chip on' : 'chip'} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <button className="btn primary" onClick={openNew}>
            + 新增条目
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <section className="card">
          <Empty
            text={loading ? '加载中…' : '知识库还是空的。把常被追问的八股答案、面经、公司情报、打过招呼的话术存进来，面试前翻一遍。'}
            action={<button className="btn primary sm" onClick={openNew}>写第一条</button>}
          />
        </section>
      ) : (
        <div className="grid grid-2">
          {shown.map((row) => (
            <section className="card" key={row.id}>
              <div className="card-head">
                <h3>{row.title}</h3>
                <span className="spacer" />
                <span className="badge brand">{row.category}</span>
              </div>
              <div className="card-body">
                <div className="md" style={{ maxHeight: 160, overflow: 'auto' }}>
                  {row.content}
                </div>
                <div className="row wrap mt8" style={{ gap: 6 }}>
                  {(row.tags ?? []).map((t: string) => (
                    <span className="badge" key={t}>
                      #{t}
                    </span>
                  ))}
                  <span className="spacer" />
                  <span className="small muted">{fmtDate(row.created_at)}</span>
                </div>
                <div className="actions mt8">
                  <button className="btn sm" onClick={() => openEdit(row)}>
                    编辑
                  </button>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      {editing ? (
        <Modal
          wide
          title={editing === 'new' ? '新增知识条目' : `编辑 · ${(editing as Row).title}`}
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
            <Field label="标题 *">
              <input className="input" value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="分类">
              <select className="select" value={form.category ?? '八股'} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {KNOW_CATEGORIES.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="内容">
            <textarea className="textarea" style={{ minHeight: 220 }} value={form.content ?? ''} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          </Field>
          <Field label="标签" hint="用顿号分隔">
            <input className="input" value={form.tags ?? ''} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          </Field>
        </Modal>
      ) : null}
    </div>
  )
}
