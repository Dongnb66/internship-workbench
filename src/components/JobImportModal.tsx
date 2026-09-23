import { useMemo, useRef, useState } from 'react'
import { errText } from '../cloud'
import { Field, Modal } from './ui'
import { insertRow } from '../lib/api'
import { JOB_TYPES } from '../lib/constants'
import { todayISO } from '../lib/format'
import { localScore } from '../lib/score'
import { notifyErr, notifyOk } from '../lib/toast'
import {
  dedupeAgainst,
  draftToRow,
  guessFromBlock,
  importReadiness,
  isDraftUsable,
  looksLikeCollectorJson,
  parseCollectorJson,
  parseJobsFromBlock,
  probeJobFile,
  splitJobBlocks,
  type JobDraft,
} from '../lib/import'
import type { Profile, Row } from '../types'

interface Props {
  existing: Row[]
  profile: Profile | null
  onClose: () => void
  onDone: () => void | Promise<void>
}

/** 选文件的上限：抓取一天的量也就几百 KB，超过这个数基本是选错了文件 */
const MAX_FILE_BYTES = 5 * 1024 * 1024

/**
 * 批量导入岗位：粘贴一段（或多段）原始文本 → 拆分 → 大模型结构化 → 人工核对 → 入库。
 *
 * 两个刻意的设计：
 * 1) 解析结果**必须先预览再入库**。模型可能把两个岗位并成一条，或者把导航文字当成职责；
 *    入库前让人看一眼，比事后去岗位池里翻垃圾便宜得多。
 * 2) 每次解析前显示本地草稿。模型不可用时（没额度、超时）流程依然能走完，
 *    退化成「本地正则 + 人工补字段」，不会白粘一次。
 */
export default function JobImportModal({ existing, profile, onClose, onDone }: Props) {
  const [text, setText] = useState('')
  const [drafts, setDrafts] = useState<JobDraft[]>([])
  const [picked, setPicked] = useState<boolean[]>([])
  const [parsing, setParsing] = useState(false)
  const [progress, setProgress] = useState({ index: 0, total: 0 })
  const [importing, setImporting] = useState(false)
  const [note, setNote] = useState('')
  const abortRef = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const readiness = useMemo(() => importReadiness(profile), [profile])
  const fromCollector = useMemo(() => looksLikeCollectorJson(text), [text])
  const blocks = useMemo(() => (text.trim() && !fromCollector ? splitJobBlocks(text) : []), [text, fromCollector])
  const checks = useMemo(() => dedupeAgainst(existing, drafts), [existing, drafts])
  const scored = useMemo(
    () => drafts.map((d) => localScore(d.jd_text, d.title, profile).score),
    [drafts, profile],
  )
  const pickedCount = picked.filter(Boolean).length

  function applyDrafts(next: JobDraft[]) {
    setDrafts(next)
    setPicked(next.map((d) => isDraftUsable(d) && Boolean(d.title)))
  }

  function patch(index: number, key: keyof JobDraft, value: string) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, [key]: value } : d)))
  }

  /** 只跑本地启发式：想看拆分对不对、又不想花额度时用 */
  function localOnly() {
    if (!blocks.length) {
      notifyErr('先把岗位文本粘进来')
      return
    }
    applyDrafts(blocks.map((b) => guessFromBlock(b)))
    setNote(`已按本地规则拆成 ${blocks.length} 段，字段大多需要手动补——这是一次不消耗额度的预演。`)
  }

  /**
   * 浏览器扩展 / 本地抓取器的产出：字段已经读好了，直接映射，不用过模型。
   * 显式接受 source，因为从文件读进来时 state 还没更新，闭包里的 text 是旧的。
   */
  function readCollector(source?: string) {
    const next = parseCollectorJson(source ?? text)
    if (!next) {
      notifyErr('这段 JSON 里没有识别到岗位，可以直接换成文本粘贴')
      return
    }
    applyDrafts(next)
    setNote(`已读取采集/抓取的 ${next.length} 个岗位，没有消耗模型额度。请核对公司与岗位名 —— 程序读不到的字段是空的，它不会替你猜。`)
  }

  /** 选一个本地文件：本地抓取器的产出、扩展的采集结果，或任何你存下来的岗位文本 */
  async function pickFile(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      notifyErr(`文件太大了（${Math.round(file.size / 1024 / 1024)} MB），岗位文本不会有这么大，先确认选对了没`)
      return
    }

    let raw = ''
    try {
      raw = await file.text()
    } catch (error) {
      notifyErr(`读文件失败：${errText(error)}`)
      return
    }

    const probe = probeJobFile(file.name, raw)
    setText(raw)

    if (probe.kind === 'empty') {
      applyDrafts([])
      setNote('')
      notifyErr(probe.hint)
      return
    }
    if (probe.kind === 'collector') {
      readCollector(raw)
      setNote(`${file.name}：${probe.hint}`)
      return
    }
    applyDrafts([])
    setNote(`${file.name}：${probe.hint}`)
  }

  async function parseWithAI() {
    if (!blocks.length) {
      notifyErr('先把岗位文本粘进来')
      return
    }
    abortRef.current = false
    setParsing(true)
    setNote('')
    setProgress({ index: 0, total: blocks.length })
    const collected: JobDraft[] = []
    let failed = 0
    for (let i = 0; i < blocks.length; i += 1) {
      if (abortRef.current) break
      setProgress({ index: i + 1, total: blocks.length })
      try {
        const result = await parseJobsFromBlock(blocks[i], '批量导入')
        collected.push(...result)
      } catch {
        failed += 1
        collected.push({ ...guessFromBlock(blocks[i]), source: '批量导入' })
      }
    }
    setParsing(false)
    applyDrafts(collected)
    setNote(
      collected.length
        ? `拆出 ${collected.length} 个岗位。请逐个核对公司名与岗位名 —— 模型认不出来的字段是空的，它不会替你猜。${failed ? `（其中 ${failed} 段走了本地兜底）` : ''}`
        : '没有解析出任何岗位，换一段更完整的文本试试。',
    )
  }

  async function doImport() {
    const targets = drafts.filter((_, i) => picked[i])
    if (!targets.length) {
      notifyErr('至少勾选一条')
      return
    }
    setImporting(true)
    let ok = 0
    let fail = 0
    let firstError = ''
    for (const draft of targets) {
      try {
        const score = localScore(draft.jd_text, draft.title, profile).score
        await insertRow('jobs', draftToRow(draft, score, `导入时间 ${todayISO()}`))
        ok += 1
      } catch (error) {
        fail += 1
        if (!firstError) firstError = errText(error)
      }
    }
    setImporting(false)
    if (ok && fail) notifyOk(`已导入 ${ok} 个岗位 · 失败 ${fail} 个（${firstError}）`)
    else if (ok) notifyOk(`已导入 ${ok} 个岗位`)
    else notifyErr(`一条都没写进去：${firstError || '登录态可能已失效'}`)
    await onDone()
    if (!fail) onClose()
  }

  return (
    <Modal
      title="批量导入岗位"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="small muted">
            {drafts.length
              ? `已勾选 ${pickedCount} / ${drafts.length}`
              : fromCollector
                ? '检测到浏览器采集数据'
                : blocks.length
                  ? `本地拆成 ${blocks.length} 段`
                  : '等待粘贴'}
          </span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          {parsing ? (
            <button className="btn danger" onClick={() => (abortRef.current = true)}>
              停止解析（{progress.index}/{progress.total}）
            </button>
          ) : fromCollector ? (
            <button className="btn" onClick={() => readCollector()} disabled={importing}>
              读取采集数据（不用模型）
            </button>
          ) : (
            <>
              <button className="btn" onClick={localOnly} disabled={!blocks.length || importing}>
                仅本地拆分
              </button>
              <button className="btn" onClick={parseWithAI} disabled={!blocks.length || importing}>
                AI 结构化解析
              </button>
            </>
          )}
          <button className="btn primary" onClick={doImport} disabled={!pickedCount || importing || parsing}>
            {importing ? '导入中…' : `导入 ${pickedCount} 条`}
          </button>
        </>
      }
    >
      <div className={`hint ${readiness.ok ? '' : 'warn'}`} style={{ marginBottom: 12 }}>
        {readiness.hint}
      </div>

      {fromCollector ? (
        <div className="hint ok" style={{ marginBottom: 12 }}>
          这是浏览器助手 / 本地抓取器产出的原始数据，字段已经读好了，点「读取采集数据」直接进预览，不需要跑模型。
        </div>
      ) : null}

      <div className="file-row">
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={importing || parsing}>
          选择抓取结果文件
        </button>
        <span className="small muted">
          本地抓取器的产出在 <code>crawler/output/</code>（.json 或 .txt 都能读），扩展的采集结果也可以存成文件选进来。
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.txt,application/json,text/plain"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            // 先清空 value，否则同一个文件选第二次不会触发 change
            e.target.value = ''
            if (file) void pickFile(file)
          }}
        />
      </div>

      <Field
        label="把招聘页 / 邮件 / 聊天记录里的岗位信息整段粘进来"
        hint="支持一次粘多个岗位：用单独一行的 --- 分隔最稳，不写分隔线也行，模型会自己判断有几条。三条来路：手动复制粘贴、浏览器助手采集本页、本地抓取器批量产出选文件。"
      >
        <textarea
          className="textarea"
          style={{ minHeight: 150 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`示例（可直接粘真实页面内容）：

公司：某某科技
岗位：后端开发实习生
工作地点：深圳
薪资：180-250/天
截止日期：2026-10-15
https://example.com/job/123
岗位职责
1. ……

---
（第二个岗位……）`}
        />
      </Field>

      {note ? <div className="small muted mb12">{note}</div> : null}

      {drafts.length ? (
        <div className="table-wrap">
          <table className="tb">
            <thead>
              <tr>
                <th style={{ width: 34 }} />
                <th>公司</th>
                <th>岗位</th>
                <th>城市</th>
                <th>类型</th>
                <th>薪资</th>
                <th>截止</th>
                <th>本地分</th>
                <th>JD</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d, i) => (
                <tr key={i}>
                  <td>
                    <input
                      type="checkbox"
                      checked={Boolean(picked[i])}
                      onChange={(e) => setPicked((prev) => prev.map((v, j) => (j === i ? e.target.checked : v)))}
                    />
                  </td>
                  <td>
                    <input className="input" style={{ minWidth: 130 }} value={d.company} onChange={(e) => patch(i, 'company', e.target.value)} />
                  </td>
                  <td>
                    <input className="input" style={{ minWidth: 170 }} value={d.title} onChange={(e) => patch(i, 'title', e.target.value)} />
                    {checks[i]?.duplicate ? (
                      <div className="small muted">岗位池里已有同公司同岗位：{String(checks[i]?.existing?.title ?? '')}</div>
                    ) : null}
                  </td>
                  <td>
                    <input className="input" style={{ width: 84 }} value={d.city} onChange={(e) => patch(i, 'city', e.target.value)} />
                  </td>
                  <td>
                    <select className="select" value={d.job_type} onChange={(e) => patch(i, 'job_type', e.target.value)}>
                      {JOB_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="input" style={{ width: 110 }} value={d.salary} onChange={(e) => patch(i, 'salary', e.target.value)} />
                  </td>
                  <td>
                    <input
                      className="input"
                      type="date"
                      style={{ width: 140 }}
                      value={d.deadline}
                      onChange={(e) => patch(i, 'deadline', e.target.value)}
                    />
                  </td>
                  <td>
                    <span className={scored[i] >= 75 ? 'badge ok' : scored[i] >= 55 ? 'badge warn' : 'badge'}>{scored[i]}</span>
                  </td>
                  <td className="small muted">{d.jd_text ? `${d.jd_text.length} 字` : <span className="accent">缺失</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {drafts.length ? (
        <div className="small muted mt8">
          入库后匹配度会按当前画像重算一次；缺 JD 的岗位会带上提醒备注，建议先补 JD 再送 AI 深评。
        </div>
      ) : null}
    </Modal>
  )
}
