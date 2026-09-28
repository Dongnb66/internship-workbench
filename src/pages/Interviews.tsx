import { useCallback, useEffect, useMemo, useState } from 'react'
import { errText } from '../cloud'
import { Icon } from '../components/Icon'
import { Empty, Field, Modal, Stat } from '../components/ui'
import { generateInterviewPrep, summarizeReflection } from '../lib/ai'
import { applicationOptions } from '../lib/interviews'
import { interviewFactGate } from '../lib/factGate'
import { deleteRow, insertRow, listRows, updateRow } from '../lib/api'
import { fmtDateTime, todayISO } from '../lib/format'
import { notifyErr, notifyOk } from '../lib/toast'
import type { Row } from '../types'
import type { PageProps } from './Overview'

const RESULT_LABEL: Record<string, { text: string; cls: string }> = {
  pending: { text: '待进行', cls: 'badge info' },
  pass: { text: '已通过', cls: 'badge ok' },
  fail: { text: '未通过', cls: 'badge danger' },
}

export default function Interviews({ profile, onChanged }: PageProps) {
  const [rows, setRows] = useState<Row[]>([])
  const [apps, setApps] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'pending' | 'done' | 'all'>('pending')
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [aiFor, setAiFor] = useState<Row | null>(null)
  const [aiJd, setAiJd] = useState('')
  const [aiResumeText, setAiResumeText] = useState('')
  const [aiResumeName, setAiResumeName] = useState('')
  const [aiPast, setAiPast] = useState<{ round: string; questions: string; reflection: string }[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiOut, setAiOut] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await listRows('interviews', { limit: 500, order: 'scheduled_at', ascending: false }))
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
    const result = r.result ?? 'pending'
    if (filter === 'pending') return result === 'pending'
    if (filter === 'done') return result !== 'pending'
    return true
  })

  /** 打开表单时把投递列表带上：关联投递后，「AI 面试准备」才能沿 id 自动带入 JD / 简历 / 历史复盘 */
  async function loadApplications() {
    if (apps.length) return
    try {
      setApps(await listRows('applications', { limit: 500 }))
    } catch (error) {
      notifyErr(`投递列表加载失败：${errText(error)}`)
    }
  }

  function openNew() {
    setForm({ company: '', title: '', round_name: '一面', kind: '面试', scheduled_at: '', mode: '线上', place: '', questions: '', reflection: '', result: 'pending', application_id: '' })
    setEditing('new')
    void loadApplications()
  }

  function openEdit(row: Row) {
    setForm({
      company: row.company ?? '',
      title: row.title ?? '',
      round_name: row.round_name ?? '一面',
      kind: row.kind ?? '面试',
      scheduled_at: row.scheduled_at ? String(row.scheduled_at).slice(0, 16) : '',
      mode: row.mode ?? '线上',
      place: row.place ?? '',
      questions: row.questions ?? '',
      reflection: row.reflection ?? '',
      result: row.result ?? 'pending',
      application_id: row.application_id ? String(row.application_id) : '',
    })
    setEditing(row)
    void loadApplications()
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
        round_name: form.round_name,
        kind: form.kind,
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        mode: form.mode,
        place: form.place || null,
        questions: form.questions || null,
        reflection: form.reflection || null,
        result: form.result || 'pending',
        // 关联投递：AI 面试准备沿它自动带入 JD / 所投简历 / 历史复盘
        application_id: form.application_id ? Number(form.application_id) : null,
      }
      if (editing === 'new') {
        await insertRow('interviews', payload)
        notifyOk('已添加')
      } else if (editing) {
        await updateRow('interviews', editing.id, payload)
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

  async function setResult(row: Row, result: string) {
    try {
      await updateRow('interviews', row.id, { result })
      notifyOk('结果已更新')
      await load()
      await onChanged()
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  async function remove(row: Row) {
    if (!window.confirm(`删除「${row.company} · ${row.round_name ?? ''}」这条记录？`)) return
    try {
      await deleteRow('interviews', row.id)
      notifyOk('已删除')
      setEditing(null)
      await load()
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  /**
   * 打开「AI 面试准备」弹窗：能自动带上的都带上，不让用户再手抄一遍。
   * JD 来自投递关联的岗位池原文；简历来自投递时选的那一版（resumes.content_text）；
   * 历史复盘取同一家同一投递的往轮记录——往轮答不好的地方，这场要重点补。
   * 带入失败不挡手动流程：JD 永远可以自己粘。
   */
  async function openAi(row: Row) {
    setAiFor(row)
    setAiOut('')
    setAiJd('')
    setAiResumeText('')
    setAiResumeName('')
    setAiPast([])
    if (!row.application_id) return
    setAiLoading(true)
    try {
      const apps = await listRows('applications', { limit: 500 })
      const app = apps.find((a) => Number(a.id) === Number(row.application_id))
      if (!app) return
      const [jobs, resumes] = await Promise.all([
        app.job_id ? listRows('jobs', { limit: 800 }) : Promise.resolve([] as Row[]),
        app.resume_id ? listRows('resumes', { limit: 200 }) : Promise.resolve([] as Row[]),
      ])
      const job = app.job_id ? jobs.find((j) => Number(j.id) === Number(app.job_id)) : null
      if (job?.jd_text) setAiJd(String(job.jd_text))
      const resume = app.resume_id ? resumes.find((r) => Number(r.id) === Number(app.resume_id)) : null
      if (resume?.content_text) {
        setAiResumeText(String(resume.content_text))
        setAiResumeName(String(resume.name ?? resume.file_name ?? '已关联简历'))
      }
      const past = rows
        .filter(
          (r) =>
            r.id !== row.id &&
            Number(r.application_id ?? -1) === Number(row.application_id) &&
            (String(r.questions ?? '').trim() || String(r.reflection ?? '').trim()),
        )
        .map((r) => ({
          round: String(r.round_name ?? '上一轮'),
          questions: String(r.questions ?? ''),
          reflection: String(r.reflection ?? ''),
        }))
      setAiPast(past)
    } catch (error) {
      notifyErr(`自动带入关联数据失败（JD 可手动粘贴）：${errText(error)}`)
    } finally {
      setAiLoading(false)
    }
  }

  async function runPrep() {
    if (!aiFor) return
    setAiBusy(true)
    setAiOut('')
    try {
      const text = await generateInterviewPrep(
        { company: aiFor.company, title: aiFor.title ?? '', jd: aiJd, resumeText: aiResumeText, pastRounds: aiPast },
        profile,
      )
      setAiOut(text)
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setAiBusy(false)
    }
  }

  /** 面试准备包存入知识库：生成结果此前关弹窗即失，落进「个人知识库 → 面试准备」随时复看 */
  async function savePrepToKnowledge() {
    if (!aiFor || !aiOut) return
    try {
      await insertRow('knowledge', {
        title: `面试准备 · ${aiFor.company} ${aiFor.title ?? ''} · ${todayISO()}`,
        category: '面试准备',
        content: aiOut,
        tags: [],
      })
      notifyOk('已存入「个人知识库 → 面试准备」')
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  async function polish() {
    if (!form.reflection) {
      notifyErr('先在复盘里写点原始记录，再让 AI 整理')
      return
    }
    setBusy(true)
    try {
      const text = await summarizeReflection(form.reflection)
      setForm({ ...form, reflection: text })
      notifyOk('已整理为结构化复盘')
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setBusy(false)
    }
  }

  const pending = rows.filter((r) => (r.result ?? 'pending') === 'pending').length
  const passed = rows.filter((r) => r.result === 'pass').length
  const failed = rows.filter((r) => r.result === 'fail').length

  // 事实守门：面试记录里的数字必须与简历口径一致（面试官会 clone 仓库核对）
  const factViolations = useMemo(() => interviewFactGate(rows, profile), [rows, profile])
  const violationsByInterview = useMemo(() => {
    const map = new Map<number, typeof factViolations>()
    for (const v of factViolations) {
      const list = map.get(v.interviewId) ?? []
      list.push(v)
      map.set(v.interviewId, list)
    }
    return map
  }, [factViolations])

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="grid grid-3">
        <Stat label="待进行" value={pending} foot="笔试 / 面试未出结果" icon={<Icon name="hourglass" size={15} />} color="#3b82f6" />
        <Stat label="已通过" value={passed} foot="进入下一轮的" icon={<Icon name="check" size={15} />} color="#12a150" />
        <Stat label="未通过" value={failed} foot="复盘比结果重要" icon={<Icon name="x" size={15} />} color="#9aa3af" />
      </div>

      <div className="card">
        <div className="card-body row wrap">
          <div className="row" style={{ gap: 6 }}>
            {(
              [
                ['pending', '待进行'],
                ['done', '已结束'],
                ['all', '全部'],
              ] as const
            ).map(([key, label]) => (
              <button key={key} className={filter === key ? 'chip on' : 'chip'} onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <span className="small muted">今天 {todayISO()}</span>
          <button className="btn primary" onClick={openNew}>
            + 添加笔试/面试
          </button>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h3>流程记录</h3>
          <span className="spacer" />
          <span className="small muted">共 {rows.length} 条</span>
        </div>
        <div className="card-body">
          {shown.length === 0 ? (
            <Empty text={loading ? '加载中…' : '这里还没有记录。投递之后每约到一轮笔试或面试，就记一条。'} action={<button className="btn primary sm" onClick={openNew}>添加第一条</button>} />
          ) : (
            shown.map((row) => (
              <div key={row.id} className="card" style={{ marginBottom: 12, boxShadow: 'none' }}>
                <div className="card-body">
                  <div className="row wrap">
                    <span className="cell-main">
                      {row.company} · {row.title ?? ''}
                    </span>
                    <span className="badge">{row.kind ?? '面试'}</span>
                    <span className="badge brand">{row.round_name ?? '—'}</span>
                    <span className={RESULT_LABEL[row.result ?? 'pending']?.cls ?? 'badge'}>{RESULT_LABEL[row.result ?? 'pending']?.text ?? '待进行'}</span>
                    <span className="spacer" />
                    <span className="small muted">
                      {fmtDateTime(row.scheduled_at)} · {row.mode ?? '—'} {row.place ? `· ${row.place}` : ''}
                    </span>
                  </div>
                  {row.questions ? (
                    <div className="mt8">
                      <div className="small muted">被问到的问题</div>
                      <div className="md">{row.questions}</div>
                    </div>
                  ) : null}
                  {row.reflection ? (
                    <div className="mt8">
                      <div className="small muted">复盘</div>
                      <div className="md">{row.reflection}</div>
                    </div>
                  ) : null}
                  {(violationsByInterview.get(Number(row.id)) ?? []).map((v) => (
                    <div key={v.label} className="small mt8" style={{ color: '#b45309' }}>
                      ⚠ {v.label} —— {v.fix}（原话：{v.quote}）
                    </div>
                  ))}
                  <div className="actions mt8">
                    <button className="btn sm" onClick={() => openEdit(row)}>
                      编辑 / 复盘
                    </button>
                    <button className="btn sm ghost" onClick={() => setResult(row, 'pass')}>
                      标记通过
                    </button>
                    <button className="btn sm ghost" onClick={() => setResult(row, 'fail')}>
                      标记未过
                    </button>
                    <button
                      className="btn sm ghost"
                      onClick={() => void openAi(row)}
                    >
                      AI 面试准备
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {editing ? (
        <Modal
          title={editing === 'new' ? '添加笔试 / 面试' : `编辑 · ${(editing as Row).company}`}
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
            <Field label="岗位">
              <input className="input" value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="类型">
              <select className="select" value={form.kind ?? '面试'} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {['笔试', '面试', '宣讲', '其它'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="轮次">
              <select className="select" value={form.round_name ?? '一面'} onChange={(e) => setForm({ ...form, round_name: e.target.value })}>
                {['笔试', '一面', '二面', '三面', 'HR 面', '终面'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="时间">
              <input className="input" type="datetime-local" value={form.scheduled_at ?? ''} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
            </Field>
            <Field label="结果">
              <select className="select" value={form.result ?? 'pending'} onChange={(e) => setForm({ ...form, result: e.target.value })}>
                <option value="pending">待进行</option>
                <option value="pass">已通过</option>
                <option value="fail">未通过</option>
              </select>
            </Field>
            <Field label="形式">
              <select className="select" value={form.mode ?? '线上'} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                {['线上', '线下', '电话'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="地点 / 会议链接">
              <input className="input" value={form.place ?? ''} onChange={(e) => setForm({ ...form, place: e.target.value })} />
            </Field>
            <Field
              label="关联投递"
              hint="关联后，「AI 面试准备」会自动带入该岗位的 JD、你投的那份简历和这家公司的历史复盘"
            >
              <select className="select" value={form.application_id ?? ''} onChange={(e) => setForm({ ...form, application_id: e.target.value })}>
                <option value="">不关联（AI 准备需要手动粘贴 JD）</option>
                {applicationOptions(apps).map((o) => (
                  <option key={o.id} value={String(o.id)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="被问到的问题" hint="面试完趁热记，越原始越好">
            <textarea className="textarea" value={form.questions ?? ''} onChange={(e) => setForm({ ...form, questions: e.target.value })} />
          </Field>
          <Field label="复盘">
            <textarea className="textarea" style={{ minHeight: 130 }} value={form.reflection ?? ''} onChange={(e) => setForm({ ...form, reflection: e.target.value })} />
          </Field>
          <button className="btn" onClick={polish} disabled={busy}>
            {busy ? '整理中…' : 'AI 整理成结构化复盘'}
          </button>
        </Modal>
      ) : null}

      {aiFor ? (
        <Modal
          wide
          title={`AI 面试准备 · ${aiFor.company} ${aiFor.title ?? ''}`}
          onClose={() => setAiFor(null)}
          footer={
            <>
              <button className="btn" onClick={() => setAiFor(null)}>
                关闭
              </button>
              {aiOut ? (
                <button className="btn" onClick={() => void savePrepToKnowledge()}>
                  保存到知识库
                </button>
              ) : null}
              <span className="spacer" />
              <button className="btn primary" onClick={runPrep} disabled={aiBusy || aiLoading}>
                {aiBusy ? '生成中…' : '生成面试准备'}
              </button>
            </>
          }
        >
          <div className="small muted" style={{ lineHeight: 1.8 }}>
            {aiJd ? 'JD：已从岗位池自动带入原文，可在下方修改。' : 'JD：这条记录没关联到岗位原文，可在下方手动粘贴。'}
            {aiResumeName
              ? `简历：已带入你投的那份「${aiResumeName}」全文，深挖题会对着它出。`
              : '简历：这条投递没关联简历，将按画像准备。'}
            {aiPast.length
              ? `历史复盘：已带入同一家公司 ${aiPast.length} 轮记录，往轮答不好的地方会被重点提示。`
              : ''}
            {aiLoading ? '正在带入关联数据…' : ''}
          </div>
          <Field label="岗位 JD（自动带入，可修改）">
            <textarea className="textarea" value={aiJd} onChange={(e) => setAiJd(e.target.value)} placeholder="把该岗位 JD 粘到这里" />
          </Field>
          <div className="md" style={{ background: '#fafbfc', padding: 12, borderRadius: 9, minHeight: 120 }}>
            {aiOut || '生成结果显示在这里：一、项目深挖题（对着你简历追问） 二、高频八股（按 JD×简历交集） 三、缺口与补救话术。'}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
