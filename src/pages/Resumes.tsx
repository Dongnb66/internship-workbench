import { useCallback, useEffect, useRef, useState } from 'react'
import { errText } from '../cloud'
import { Empty, Field, Modal, Stat } from '../components/ui'
import { analyzeResume, parseResumeAnalysis, type ResumeAnalysis } from '../lib/ai'
import { deleteRow, insertRow, listRows, updateRow } from '../lib/api'
import { RESUME_DIRECTIONS } from '../lib/constants'
import { fmtDate } from '../lib/format'
import { extractResumeText, resumeKindOf } from '../lib/resumeFile'
import { removeResumeFile, signResumeUrl, uploadResumeFile } from '../lib/storage'
import { notifyErr, notifyOk } from '../lib/toast'
import type { Row } from '../types'
import type { PageProps } from './Overview'

/** 渲染层用于判断已存 analysis 的形状是否可展示（老数据/脏数据不炸页面） */
function toAnalysis(value: unknown): ResumeAnalysis | null {
  if (!value || typeof value !== 'object') return null
  const a = parseResumeAnalysis(JSON.stringify(value))
  return a.summary || a.skills.length || a.projects.length || a.defense.length ? a : null
}

export default function Resumes({ onChanged, go }: PageProps) {
  const [rows, setRows] = useState<Row[]>([])
  const [apps, setApps] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [analyzingRow, setAnalyzingRow] = useState<Row | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisRaw, setAnalysisRaw] = useState('')
  const [analysis, setAnalysis] = useState<ResumeAnalysis | null>(null)

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
    setForm({ name: '', version: 'v1', direction: 'AI Agent 方向', target_role: '', file_url: '', file_path: '', file_name: '', content_text: '', highlights: '', projects: '', notes: '', is_default: 'false' })
    setEditing('new')
  }

  function openEdit(row: Row) {
    setForm({
      name: row.name ?? '',
      version: row.version ?? 'v1',
      direction: row.direction ?? '',
      target_role: row.target_role ?? '',
      file_url: row.file_url ?? '',
      file_path: row.file_path ?? '',
      file_name: row.file_name ?? '',
      content_text: row.content_text ?? '',
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
        file_path: form.file_path || null,
        file_name: form.file_name || null,
        content_text: form.content_text || null,
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
      // 附件清理是尽力而为：行删除才是主操作，存储侧失败不影响本次删除
      if (row.file_path) void removeResumeFile(String(row.file_path))
      await deleteRow('resumes', row.id)
      notifyOk('已删除')
      setEditing(null)
      await load()
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  /** 上传附件：先本地提取文本（失败则什么都不传），再传存储，最后回填表单 */
  async function onPickFile(file: File) {
    setUploading(true)
    try {
      const text = await extractResumeText(file)
      const up = await uploadResumeFile(file)
      setForm((f) => ({ ...f, file_path: up.path, file_url: up.url, file_name: up.fileName, content_text: text }))
      notifyOk(`附件已上传，提取到 ${text.length} 字简历文本（可在下方核对）`)
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  /** 打开附件：有永久路径就现签（签名链接只有 1 小时，存的 file_url 大概率已过期）；
   *  仅网盘外链（无 file_path）才直接用 file_url */
  async function openAttachment(row: Row) {
    try {
      let url = ''
      if (row.file_path) url = await signResumeUrl(String(row.file_path))
      if (!url && row.file_url) url = String(row.file_url)
      if (!url) {
        notifyErr('没有可用的文件链接：请重新上传附件')
        return
      }
      window.open(url, '_blank', 'noreferrer')
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  function openAnalyze(row: Row) {
    setAnalyzingRow(row)
    setAnalysis(toAnalysis(row.analysis))
    setAnalysisRaw('')
  }

  async function runAnalysis() {
    const row = analyzingRow
    if (!row) return
    const text = String(row.content_text ?? '').trim()
    if (!text) {
      notifyErr('这份简历还没有文本内容：先在编辑里上传附件或粘贴简历全文，再分析')
      return
    }
    setAnalyzing(true)
    setAnalysisRaw('')
    try {
      const result = await analyzeResume(text, row.target_role, (t) => setAnalysisRaw((p) => p + t))
      setAnalysis(result)
      await updateRow('resumes', row.id, { analysis: result })
      notifyOk('分析完成，结果已保存到这份简历')
      await load()
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setAnalyzing(false)
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
          <span className="small muted">支持上传 PDF / docx 附件，AI 可基于简历原文做分析</span>
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
                      <div className="cell-sub">
                        更新于 {fmtDate(row.created_at)}
                        {row.file_name ? ` · 📎 ${row.file_name}` : ''}
                        {row.content_text ? '' : ' · 无文本（AI 分析不可用）'}
                      </div>
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
                        {row.file_path ? (
                          <button className="linkish" onClick={() => void openAttachment(row)}>
                            打开附件
                          </button>
                        ) : row.file_url ? (
                          <a className="linkish" href={row.file_url} target="_blank" rel="noreferrer">
                            打开文件
                          </a>
                        ) : null}
                        <button className="linkish" onClick={() => openAnalyze(row)}>
                          {toAnalysis(row.analysis) ? '查看分析' : 'AI 分析'}
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
            <Field label="文件链接" hint="外部网盘/在线简历链接；上传附件后会自动生成本应用的短链">
              <input className="input" value={form.file_url ?? ''} onChange={(e) => setForm({ ...form, file_url: e.target.value })} placeholder="https:// 网盘 / 在线简历" />
            </Field>
          </div>
          <Field label="附件（PDF / docx / txt / md，≤10MB）" hint="上传后自动提取纯文本供 AI 分析；重复上传会覆盖之前的附件">
            <div className="row">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt,.md,.markdown"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onPickFile(f)
                }}
              />
              <button className="btn" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? '上传并提取中…' : form.file_path ? '重新上传附件' : '上传附件'}
              </button>
              {form.file_name ? <span className="small">📎 {form.file_name}</span> : <span className="small muted">尚未上传</span>}
            </div>
          </Field>
          <Field label="简历全文（AI 分析的原料）" hint="上传附件会自动填充；也可以直接把简历文字粘贴到这里">
            <textarea
              className="textarea"
              style={{ minHeight: 140 }}
              value={form.content_text ?? ''}
              onChange={(e) => setForm({ ...form, content_text: e.target.value })}
              placeholder="粘贴简历全文，或上传 PDF/docx 自动提取"
            />
          </Field>
          {form.content_text ? (
            <div className="small muted" style={{ marginTop: -8, marginBottom: 8 }}>
              当前文本 {form.content_text.length} 字{resumeKindOf(form.file_name ?? '') === 'pdf' ? ' · 来源：PDF 提取' : ''}
            </div>
          ) : null}
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

      {analyzingRow ? (
        <Modal
          wide
          title={`AI 简历分析 · ${(analyzingRow as Row).name}`}
          onClose={() => {
            if (analyzing) return // 分析中不允许误关弹层丢结果
            setAnalyzingRow(null)
          }}
          footer={
            <>
              <span className="small muted">
                {(analyzingRow as Row).content_text ? `${String((analyzingRow as Row).content_text).length} 字简历文本` : '⚠ 这份简历还没有文本，先去编辑里上传附件或粘贴全文'}
              </span>
              <span className="spacer" />
              <button className="btn" onClick={() => setAnalyzingRow(null)} disabled={analyzing}>
                关闭
              </button>
              <button className="btn primary" onClick={() => void runAnalysis()} disabled={analyzing}>
                {analyzing ? '分析中…' : analysis ? '重新分析' : '开始分析'}
              </button>
            </>
          }
        >
          <div className="hint mb16">
            以面试官视角拆解这份简历：学历、技能、项目、面试防守关键词与优化建议。分析只基于简历文本本身，结果自动保存到这份简历。
          </div>
          {analyzing && !analysisRaw ? <div className="muted">模型思考中…</div> : null}
          {analyzing && analysisRaw && !analysis ? (
            <pre className="md" style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 320, overflow: 'auto' }}>{analysisRaw}</pre>
          ) : null}
          {analysis ? (
            <div className="grid" style={{ gap: 12 }}>
              {analysis.summary ? (
                <div className="card" style={{ padding: '10px 12px' }}>
                  <strong>综合印象</strong>
                  <div className="md" style={{ fontSize: 13 }}>{analysis.summary}</div>
                </div>
              ) : null}
              {[
                ['🎓 学历与教育背景', analysis.education],
                ['🛠 工程与横向技能', analysis.skills],
                ['📦 项目拆解', analysis.projects],
                ['🛡 面试防守关键词', analysis.defense],
                ['⚠ 可能被质疑的点', analysis.risks],
                ['✏️ 优化建议（按优先级）', analysis.suggestions],
              ]
                .filter(([, items]) => (items as string[]).length > 0)
                .map(([label, items]) => (
                  <div key={label as string}>
                    <div className="mb8" style={{ fontWeight: 600 }}>{label as string}</div>
                    <ul className="md" style={{ fontSize: 13, paddingLeft: 20, margin: 0 }}>
                      {(items as string[]).map((item, i) => (
                        <li key={i} style={{ marginBottom: 4 }}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              {!analysis.summary && !analysis.skills.length && !analysis.projects.length && !analysis.defense.length ? (
                <div className="muted">分析结果为空：模型没有返回有效内容，请重新分析。</div>
              ) : null}
            </div>
          ) : null}
        </Modal>
      ) : null}
    </div>
  )
}
