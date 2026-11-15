import { useEffect, useRef, useState } from 'react'
import { errText } from '../cloud'
import { Empty, Field, Stat } from '../components/ui'
import { generateInterviewReview } from '../lib/ai'
import { insertRow, listRows, updateRow } from '../lib/api'
import { fmtDateTime, todayISO } from '../lib/format'
import { answeredCount, serializeQA, type QAItem } from '../lib/interviewQA'
import { speechSupported, startDictation, type Dictation } from '../lib/speech'
import { transcriptToQA, type DialogueLine } from '../lib/transcript'
import { notifyErr, notifyOk } from '../lib/toast'
import type { Row } from '../types'
import type { PageProps } from './Overview'

/**
 * AI 面试辅助。
 *
 * 一条主线：面试进行中只录我自己的麦克风（转写我的回答），面后把会议软件的
 * 转写导进来补齐对方提问，合成完整问答 → 逐题复盘 + 提升方案 → 写回该场记录。
 *
 * 不读取桌面/系统音频：对方的提问一律以会议软件产出的文本为准。
 */

type MarkedQuestion = { q: string; from: number }

export default function LiveAssist({ profile, onChanged }: PageProps) {
  const [mode, setMode] = useState<'record' | 'import'>('record')
  const [rows, setRows] = useState<Row[]>([])
  const [targetId, setTargetId] = useState('')

  // 面试中录制
  const [listening, setListening] = useState(false)
  const [myLines, setMyLines] = useState<string[]>([])
  const [interim, setInterim] = useState('')
  const [marks, setMarks] = useState<MarkedQuestion[]>([])
  const [pendingQuestion, setPendingQuestion] = useState('')
  const dictation = useRef<Dictation | null>(null)

  // 面试后导入
  const [raw, setRaw] = useState('')
  const [lines, setLines] = useState<DialogueLine[]>([])
  const [speakers, setSpeakers] = useState<string[]>([])
  const [self, setSelf] = useState<string | null>(null)

  // 合成后的问答与复盘
  const [qa, setQa] = useState<QAItem[]>([])
  const [review, setReview] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        setRows(await listRows('interviews', { limit: 200, order: 'scheduled_at', ascending: false }))
      } catch (error) {
        notifyErr(errText(error))
      }
    })()
  }, [])

  /** 未关联记录且没有任何问答时不该调用模型，先给出可操作的提示 */
  function toggleRecord() {
    if (listening) {
      dictation.current?.stop()
      dictation.current = null
      setListening(false)
      setInterim('')
      return
    }
    if (!speechSupported()) {
      notifyErr('当前浏览器不支持语音转写（Chrome / Edge 可用）。可以先用「面试后导入」')
      return
    }
    const handle = startDictation({
      lang: 'zh-CN',
      onFinal: (text) => setMyLines((prev) => [...prev, text]),
      onInterim: setInterim,
      onError: (message) => {
        notifyErr(message)
        setListening(false)
      },
      onEnd: () => setListening(false),
    })
    if (!handle) {
      notifyErr('启动语音转写失败，检查麦克风权限')
      return
    }
    dictation.current = handle
    setListening(true)
  }

  useEffect(() => () => dictation.current?.stop(), [])

  /** 记下这一题：以当前时刻为界，之后我说的话都归到这题的回答 */
  function markQuestion() {
    const text = pendingQuestion.trim()
    if (!text) {
      notifyErr('先把面试官问的题写进输入框')
      return
    }
    setMarks((prev) => [...prev, { q: text, from: myLines.length }])
    setPendingQuestion('')
  }

  function composeQA() {
    if (!marks.length && !myLines.length) {
      notifyErr('还没有任何记录')
      return
    }
    if (!marks.length) {
      setQa([{ q: '（未登记题目，下面是这场我说的内容）', a: myLines.join(' ') }])
      notifyOk('已把内容整理成一条，建议补上题目')
      return
    }
    const items = marks.map((mark, index) => {
      const end = index + 1 < marks.length ? marks[index + 1].from : myLines.length
      return { q: mark.q, a: myLines.slice(mark.from, end).join(' ') }
    })
    setQa(items)
    notifyOk(`已合成 ${items.length} 题，可在下方补答案`)
  }

  function parseImport() {
    if (!raw.trim()) {
      notifyErr('先把会议软件里的字幕 / 转写粘进来')
      return
    }
    const parsed = transcriptToQA(raw)
    setLines(parsed.lines)
    setSpeakers(parsed.speakers)
    setSelf(parsed.self)
    setQa(parsed.qa)
    if (!parsed.qa.length) notifyErr('没解析出问答，可能这份文本里没有说话人标注')
    else notifyOk(`已解析 ${parsed.qa.length} 题`)
  }

  function switchSelf(name: string) {
    setSelf(name)
    const parsed = transcriptToQA(raw, name)
    setQa(parsed.qa)
  }

  async function pickFile(file: File | null) {
    if (!file) return
    try {
      const text = await file.text()
      setRaw(text)
      const parsed = transcriptToQA(text)
      setLines(parsed.lines)
      setSpeakers(parsed.speakers)
      setSelf(parsed.self)
      setQa(parsed.qa)
      notifyOk(`已读取 ${file.name}`)
    } catch (error) {
      notifyErr(`读取文件失败：${errText(error)}`)
    }
  }

  async function runReview() {
    const items = qa.filter((it) => it.q.trim() || it.a.trim())
    if (!items.length) {
      notifyErr('还没有可复盘的问答')
      return
    }
    setBusy(true)
    setReview('')
    try {
      const target = rows.find((r) => String(r.id) === targetId)
      const text = await generateInterviewReview(
        {
          company: String(target?.company ?? ''),
          title: String(target?.title ?? ''),
          round: String(target?.round_name ?? ''),
          qa: items,
          pastReflection: String(target?.reflection ?? ''),
        },
        profile,
      )
      setReview(text)
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!review) {
      notifyErr('先生成复盘')
      return
    }
    const text = serializeQA(qa)
    try {
      if (targetId) {
        await updateRow('interviews', Number(targetId), { questions: text, reflection: review })
        notifyOk('已写回这场面试记录')
        await onChanged()
      } else {
        await insertRow('knowledge', {
          title: `面试复盘 · ${rows.find((r) => String(r.id) === targetId)?.company ?? '未关联'} · ${todayISO()}`,
          category: '面试复盘',
          content: review,
          tags: [],
        })
        notifyOk('已存入「个人知识库 → 面试复盘」')
      }
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  const target = rows.find((r) => String(r.id) === targetId)
  const hasQa = qa.some((it) => it.q.trim() || it.a.trim())

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="grid grid-3">
        <Stat label="面中记录" value={myLines.length} foot="我这边已有的句子" color="#3b82f6" />
        <Stat label="已标记题目" value={marks.length} foot="面试官问的每一题" color="#7c3aed" />
        <Stat label="待复盘问答" value={qa.length} foot={`其中 ${answeredCount(qa)} 题有回答`} color="#12a150" />
      </div>

      <section className="card">
        <div className="card-head">
          <h3>1. 关联这场面试</h3>
          <span className="spacer" />
          <span className="small muted">复盘写回这条记录，下次二面准备能读到</span>
        </div>
        <div className="card-body">
          <Field label="面试记录" hint="不选也能复盘，但结果只会存进知识库，不会写回一面/二面记录">
            <select className="select" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">不关联，仅生成复盘</option>
              {rows.map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.company} · {r.round_name ?? '未命名'} · {fmtDateTime(r.scheduled_at)}
                </option>
              ))}
            </select>
          </Field>
          {target ? (
            <div className="small muted mt8">
              将写回：{target.company} · {target.title || '未填岗位'} · {target.round_name ?? '未命名'} 的问答与复盘
            </div>
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>2. 拿到对话</h3>
          <div className="row" style={{ gap: 6, marginLeft: 12 }}>
            <button className={mode === 'record' ? 'chip on' : 'chip'} onClick={() => setMode('record')}>
              面试中录制
            </button>
            <button className={mode === 'import' ? 'chip on' : 'chip'} onClick={() => setMode('import')}>
              面试后导入
            </button>
          </div>
        </div>
        <div className="card-body">
          {mode === 'record' ? (
            <div className="grid" style={{ gap: 10 }}>
              <div className="row wrap">
                <button className={listening ? 'btn danger' : 'btn primary'} onClick={toggleRecord}>
                  {listening ? '停止记录' : '开始记录我的回答'}
                </button>
                <span className="small muted">
                  {speechSupported() ? '只开麦克风，转写我自己说的话；不读取桌面音频' : '当前浏览器不支持语音转写，请用「面试后导入」'}
                </span>
              </div>
              <div className="row wrap">
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 260 }}
                  placeholder="面试官刚问了什么？打完点右边「记下这题」"
                  value={pendingQuestion}
                  onChange={(e) => setPendingQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') markQuestion()
                  }}
                />
                <button className="btn" onClick={markQuestion}>
                  记下这题
                </button>
              </div>
              {marks.length ? (
                <div className="small muted">
                  已标记：{marks.map((m, i) => `${i + 1}. ${m.q}`).join('　')}
                </div>
              ) : null}
              <div className="md" style={{ background: '#fafbfc', borderRadius: 9, padding: 12, minHeight: 120, maxHeight: 260, overflow: 'auto' }}>
                {myLines.length ? myLines.map((line, index) => <div key={index}>· {line}</div>) : '这里会滚动显示我这边被转写的句子。'}
                {interim ? <div style={{ color: '#9aa3af' }}>{interim}…</div> : null}
              </div>
              <div className="row">
                <button className="btn" onClick={composeQA}>
                  合成问答
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    setMyLines([])
                    setMarks([])
                    setQa([])
                    setInterim('')
                  }}
                >
                  清空重来
                </button>
              </div>
            </div>
          ) : (
            <div className="grid" style={{ gap: 10 }}>
              <div className="small muted" style={{ lineHeight: 1.8 }}>
                支持粘贴飞书妙记 / 腾讯会议字幕 / Zoom 的 .vtt、.srt，或 BOSS 上复制的对话。解析后确认「哪个说话人是我」，不对就换。
              </div>
              <textarea
                className="textarea"
                style={{ minHeight: 150 }}
                placeholder={'例如：\n面试官：先自我介绍一下\n我：我是…\n面试官：你这个项目的难点在哪'}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
              />
              <div className="row wrap">
                <button className="btn primary" onClick={parseImport}>
                  解析对话
                </button>
                <label className="btn">
                  选择转写文件
                  <input
                    type="file"
                    accept=".txt,.vtt,.srt,.md"
                    style={{ display: 'none' }}
                    onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                {speakers.length ? (
                  <span className="row" style={{ gap: 6 }}>
                    <span className="small muted">哪个说话人是我：</span>
                    <select className="select" value={self ?? ''} onChange={(e) => switchSelf(e.target.value)}>
                      {speakers.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </span>
                ) : null}
              </div>
              {lines.length ? <div className="small muted">已解析 {lines.length} 段对话</div> : null}
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>3. 核对问答</h3>
          <span className="spacer" />
          <span className="small muted">题号即复盘时的引用顺序</span>
        </div>
        <div className="card-body">
          {qa.length === 0 ? (
            <Empty text="还没有问答。上面录制或导入之后，这里会出现可编辑的题目与回答。" />
          ) : (
            <div className="grid" style={{ gap: 10 }}>
              {qa.map((item, index) => (
                <div key={index} className="grid" style={{ gap: 6, paddingBottom: 10, borderBottom: '1px solid #eef0f3' }}>
                  <div className="row">
                    <strong style={{ fontSize: 13 }}>第 {index + 1} 题</strong>
                    <span className="spacer" />
                    <button className="btn sm ghost" onClick={() => setQa(qa.filter((_, i) => i !== index))}>
                      删除
                    </button>
                  </div>
                  <input
                    className="input"
                    value={item.q}
                    onChange={(e) => setQa(qa.map((it, i) => (i === index ? { ...it, q: e.target.value } : it)))}
                  />
                  <textarea
                    className="textarea"
                    style={{ minHeight: 64 }}
                    value={item.a}
                    onChange={(e) => setQa(qa.map((it, i) => (i === index ? { ...it, a: e.target.value } : it)))}
                  />
                </div>
              ))}
              <button className="btn sm" onClick={() => setQa([...qa, { q: '', a: '' }])}>
                + 再加一题
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>4. 生成复盘与提升方案</h3>
          <span className="spacer" />
          <button className="btn primary" onClick={() => void runReview()} disabled={busy || !hasQa}>
            {busy ? '复盘中…' : '生成复盘'}
          </button>
        </div>
        <div className="card-body">
          <div className="md" style={{ background: '#fafbfc', borderRadius: 9, padding: 12, minHeight: 140, whiteSpace: 'pre-wrap' }}>
            {review || '结果在这里：整体判断 / 逐题诊断 / 更优答法 / 下一步提升。'}
          </div>
          {review ? (
            <div className="row mt8">
              <button className="btn" onClick={() => void save()}>
                {targetId ? '写回这场面试记录' : '存入知识库'}
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
