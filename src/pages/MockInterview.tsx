import { useEffect, useRef, useState } from 'react'
import { errText } from '../cloud'
import { Empty, Field, Stat } from '../components/ui'
import { generateInterviewQuestions, generateInterviewReview } from '../lib/ai'
import { insertRow, listRows } from '../lib/api'
import { speechSupported, startDictation, type Dictation } from '../lib/speech'
import { MOCK_CATEGORY, appendAnswer, createSession, parseQuestions, reviewSubject, sessionProgress, sessionToQA, type MockSession } from '../lib/mockInterview'
import { speak, stopSpeaking, ttsSupported } from '../lib/tts'
import { qaToText, serializeQA } from '../lib/interviewQA'
import { todayISO } from '../lib/format'
import { notifyErr, notifyOk } from '../lib/toast'
import type { Job } from '../types'
import type { PageProps } from './Overview'

/**
 * AI 模拟面试。
 *
 * 对面是模型，不是真人面试官：练的内容和「AI 面试辅助」一模一样（出题 → 我说 → 逐题复盘），
 * 但这里没有需要被瞒住的评估方，所以可以放心把整套实时语音链路打开。
 *
 * 成本写死在界面上：一场固定 2 次模型调用（整批出题 1 次 + 复盘 1 次）。
 * 逐题追问要多花一次/题，会吃掉「每任务 8 次」的额度，所以不做。
 *
 * 双端能力不对称，按事实分别判断，不写成「双端一致」：
 * - 朗读题目走 SpeechSynthesis，桌面壳里一般可用；
 * - 转写我的回答走 Web Speech Recognition，桌面壳里**没有**，这时必须走打字记录。
 */

export default function MockInterview({ profile, onChanged }: PageProps) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [jobId, setJobId] = useState('')
  const [company, setCompany] = useState('')
  const [title, setTitle] = useState('')
  const [jd, setJd] = useState('')
  const [count, setCount] = useState(5)

  const [session, setSession] = useState<MockSession>(() => createSession({ company: '', title: '', count: 5 }))
  const [asking, setAsking] = useState(false)
  const [askRaw, setAskRaw] = useState('')

  const [listening, setListening] = useState(-1)
  const [interim, setInterim] = useState('')
  const dictation = useRef<Dictation | null>(null)

  const [review, setReview] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        setJobs((await listRows('jobs', { limit: 200, order: 'created_at', ascending: false })) as Job[])
      } catch (error) {
        notifyErr(errText(error))
      }
    })()
  }, [])

  /** 停掉当前题目的录音：切题、结束、离开页面都要停，不能让转写继续往上一题里灌字 */
  function stopRecord() {
    dictation.current?.stop()
    dictation.current = null
    setListening(-1)
    setInterim('')
  }

  useEffect(() => {
    stopSpeaking()
    return () => stopRecord()
  }, [])

  function pickJob(id: string) {
    setJobId(id)
    const job = jobs.find((j) => String(j.id) === id)
    if (!job) return
    setCompany(String(job.company ?? ''))
    setTitle(String(job.title ?? ''))
    setJd(String(job.jd_text ?? ''))
  }

  async function makeQuestions() {
    const want = Math.min(12, Math.max(1, Number(count) || 5))
    setAsking(true)
    setAskRaw('')
    setReview('')
    try {
      const text = await generateInterviewQuestions({ company, title, jd, count: want }, profile, (delta) => setAskRaw((prev) => prev + delta))
      const questions = parseQuestions(text, want)
      if (!questions.length) {
        notifyErr('模型没吐出可用的题目，原文在下面，可手动改题再练')
        setSession({ ...createSession({ company, title, count: want }), questions: [], answers: [] })
        return
      }
      setSession({ ...createSession({ company, title, count: want }), questions, answers: questions.map(() => '') })
      notifyOk(`出了 ${questions.length} 道题${questions.length < want ? `（要 ${want} 道，模型只给了这些）` : ''}`)
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setAsking(false)
    }
  }

  function toggleRecord(index: number) {
    if (listening === index) {
      stopRecord()
      return
    }
    stopRecord()
    if (!speechSupported()) {
      notifyErr('这台环境没有语音转写（Electron 桌面壳不带 webkitSpeechRecognition），请在下面输入框里直接记回答')
      return
    }
    const handle = startDictation({
      lang: 'zh-CN',
      onFinal: (text) => setSession((prev) => ({ ...prev, answers: appendAnswer(prev, index, text) })),
      onInterim: setInterim,
      onError: (message) => {
        notifyErr(message)
        setListening(-1)
      },
      onEnd: () => setListening(-1),
    })
    if (!handle) {
      notifyErr('启动转写失败，检查麦克风权限')
      return
    }
    dictation.current = handle
    setListening(index)
  }

  function editAnswer(index: number, value: string) {
    setSession((prev) => {
      const answers = [...prev.answers]
      while (answers.length <= index) answers.push('')
      answers[index] = value
      return { ...prev, answers }
    })
  }

  async function runReview() {
    const qa = sessionToQA(session)
    if (!qa.some((it) => it.a.trim())) {
      notifyErr('一题回答都没有，复盘只能变成猜；先答几题再来')
      return
    }
    setBusy(true)
    setReview('')
    stopRecord()
    try {
      const subject = reviewSubject(session)
      const text = await generateInterviewReview(
        {
          company: subject.company,
          title: subject.title,
          round: subject.round,
          jd,
          qa,
          pastReflection: '',
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
    const subject = reviewSubject(session)
    try {
      await insertRow('knowledge', {
        title: `模拟面试 · ${subject.company} · ${subject.title} · ${todayISO()}`,
        category: MOCK_CATEGORY,
        content: `【题目与我的回答】\n${qaToText(sessionToQA(session))}\n\n【复盘】\n${review}`,
        tags: ['模拟面试'],
      })
      notifyOk('已存入「个人知识库 → 模拟面试」')
      await onChanged()
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  const progress = sessionProgress(session)
  const answered = progress.answered

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="grid grid-3">
        <Stat label="本场题目" value={progress.total} foot={`已答 ${answered} 题`} color="#3b82f6" />
        <Stat label="模型调用" value={answered ? 2 : 1} foot="出题 1 次 + 复盘 1 次" color="#7c3aed" />
        <Stat label="对面是谁" value="AI" foot="不是真人面试官" color="#12a150" />
      </div>

      <section className="card">
        <div className="card-head">
          <h3>1. 按什么练</h3>
          <span className="spacer" />
          <span className="small muted">选岗位会自动带出 JD；不选就只按你的画像出通用题</span>
        </div>
        <div className="card-body">
          <div className="grid grid-2">
            <Field label="从岗位池选">
              <select className="select" value={jobId} onChange={(e) => pickJob(e.target.value)}>
                <option value="">不选，手填</option>
                {jobs.map((j) => (
                  <option key={j.id} value={String(j.id)}>
                    {j.company} · {j.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="题数（1-12）">
              <input className="input" type="number" min={1} max={12} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </Field>
            <Field label="公司">
              <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="不填就是自练" />
            </Field>
            <Field label="岗位">
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如 AI 应用开发实习生" />
            </Field>
          </div>
          <Field label="岗位 JD（可选）" hint="题目要落在 JD 上才像真面试；JD 属于外部文本，进模型前会被隔离包装">
            <textarea className="textarea" style={{ minHeight: 90 }} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="粘贴 JD 原文，留空则按画像出通用题" />
          </Field>
          <div className="row mt8">
            <button className="btn primary" onClick={() => void makeQuestions()} disabled={asking}>
              {asking ? '出题中…' : '出一批题'}
            </button>
            <span className="small muted">本场固定 2 次模型调用，额度记在你的账号上</span>
          </div>
          {asking && askRaw ? <pre className="small muted mt8" style={{ whiteSpace: 'pre-wrap' }}>{askRaw}</pre> : null}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>2. 逐题作答</h3>
          <span className="spacer" />
          <span className="small muted">
            朗读：{ttsSupported() ? '可用' : '这台机器没有可用音色'}　转写：{speechSupported() ? '可用' : '不可用（桌面壳没有语音识别，请打字）'}
          </span>
        </div>
        <div className="card-body">
          {progress.total === 0 ? (
            <Empty text="还没有题目。上面「出一批题」之后，这里会一题一题排开。" />
          ) : (
            <div className="grid" style={{ gap: 12 }}>
              {session.questions.map((q, i) => (
                <div key={i} className="grid" style={{ gap: 6, paddingBottom: 10, borderBottom: '1px solid #eef0f3' }}>
                  <div className="row wrap">
                    <strong style={{ fontSize: 13 }}>第 {i + 1} 题</strong>
                    <span style={{ flex: 1, minWidth: 200 }}>{q}</span>
                    <button
                      className="btn sm ghost"
                      onClick={() => {
                        if (!speak(q)) notifyErr('这台机器念不出来，直接看题')
                      }}
                    >
                      念题
                    </button>
                    <button className={listening === i ? 'btn sm danger' : 'btn sm'} onClick={() => toggleRecord(i)}>
                      {listening === i ? '停止记录' : '记录我的回答'}
                    </button>
                    {listening === i ? <button className="btn sm ghost" onClick={stopRecord}>停</button> : null}
                  </div>
                  <textarea
                    className="textarea"
                    style={{ minHeight: 60 }}
                    value={session.answers[i] ?? ''}
                    placeholder={speechSupported() ? '转写结果会落在这里，也可以自己打字补充' : '这台环境不能转写，直接打字记录你的回答'}
                    onChange={(e) => editAnswer(i, e.target.value)}
                  />
                  {listening === i && interim ? <div className="small muted" style={{ color: '#9aa3af' }}>{interim}…</div> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>3. 复盘</h3>
          <span className="spacer" />
          <button className="btn primary" onClick={() => void runReview()} disabled={busy || !answered}>
            {busy ? '复盘中…' : '生成复盘'}
          </button>
        </div>
        <div className="card-body">
          {!answered && progress.total ? <div className="small muted" style={{ marginBottom: 8 }}>一题回答都没记，复盘只能靠猜，所以按钮先按住。</div> : null}
          <div className="md" style={{ background: '#fafbfc', borderRadius: 9, padding: 12, minHeight: 140, whiteSpace: 'pre-wrap' }}>
            {review || '结果在这里：整体判断 / 逐题诊断 / 更优答法 / 下一步提升。'}
          </div>
          {review ? (
            <div className="row mt8">
              <button className="btn" onClick={() => void save()}>
                存入知识库
              </button>
              <span className="small muted">存的是问答原文 + 复盘，序列化沿用现有格式：{serializeQA(sessionToQA(session)).slice(0, 24)}…</span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
