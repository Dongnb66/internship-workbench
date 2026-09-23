import { useState } from 'react'
import { errText } from '../cloud'
import { Drawer, Field } from './ui'
import { addMessage, QUICK_ACTIONS, timelineFor } from '../lib/conversation'
import { fmtDate, fmtDateTime } from '../lib/format'
import { DEFAULT_PACE, GREET_CHECKLIST, paceStatus, REPLY_STATUS_LABEL } from '../lib/pace'
import { notifyErr, notifyOk } from '../lib/toast'
import type { Profile, Row } from '../types'

export default function ConversationDrawer({
  application,
  messages,
  profile,
  onClose,
  onChanged,
}: {
  application: Row
  messages: Row[]
  profile?: Profile | null
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const [content, setContent] = useState('')
  const [followAt, setFollowAt] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [gate, setGate] = useState(false)
  const [checks, setChecks] = useState<boolean[]>(() => GREET_CHECKLIST.map(() => false))

  const timeline = timelineFor(messages, application.id)

  const pace = {
    dailyLimit: profile?.daily_greet_limit ?? DEFAULT_PACE.dailyLimit,
    window: profile?.greet_window ?? DEFAULT_PACE.window,
    minIntervalMin: profile?.min_interval_min ?? DEFAULT_PACE.minIntervalMin,
  }
  const status = paceStatus(messages, pace)
  const allChecked = checks.every(Boolean)

  async function record(statusKey: string, direction: 'out' | 'in') {
    setBusy(true)
    try {
      await addMessage({
        application,
        company: application.company,
        title: application.title,
        status: statusKey,
        direction,
        content: content || null,
        notes: notes || null,
        followAt: followAt || null,
      })
      notifyOk('已记录到会话流水')
      setContent('')
      setNotes('')
      setFollowAt('')
      setGate(false)
      setChecks(GREET_CHECKLIST.map(() => false))
      await onChanged()
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setBusy(false)
    }
  }

  function tap(action: { status: string; direction: 'out' | 'in' }) {
    // 打招呼是唯一会触发平台风控的动作，发之前先过一遍自检清单
    if (action.status === 'sent') {
      setGate(true)
      return
    }
    void record(action.status, action.direction)
  }

  return (
    <Drawer
      title={`会话 · ${application.company} ${application.title ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <span className="small muted">记录后自动更新阶段与下一步跟进</span>
        </>
      }
    >
      <div className="small muted">快捷记录</div>
      <div className="row wrap mt8 mb16" style={{ gap: 6 }}>
        {QUICK_ACTIONS.map((a) => (
          <button key={a.status} className="chip" title={a.hint} disabled={busy} onClick={() => tap(a)}>
            {a.label}
          </button>
        ))}
      </div>

      {gate ? (
        <div className="hint mb16">
          <div className="row">
            <b>发送前自检</b>
            <span className="spacer" />
            <span className="small muted">
              今日已登记 {status.sentToday}/{status.limit}
            </span>
          </div>
          {GREET_CHECKLIST.map((c, i) => (
            <label key={c} className="row" style={{ gap: 8, marginTop: 8, cursor: 'pointer', alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={checks[i]}
                onChange={() => setChecks(checks.map((v, j) => (j === i ? !v : v)))}
              />
              <span>{c}</span>
            </label>
          ))}
          {status.allowed ? null : (
            <div className="small mt8">节奏提示：{status.reasons.join('；')}。如果消息已经发出去了，就如实登记。</div>
          )}
          <div className="row mt16">
            <button className="btn" onClick={() => setGate(false)} disabled={busy}>
              取消
            </button>
            <button className="btn primary" disabled={busy || !allChecked} onClick={() => void record('sent', 'out')}>
              {busy ? '登记中…' : '确认已发出并登记'}
            </button>
          </div>
        </div>
      ) : null}

      <Field label="这次沟通的内容 / 对方原话（可选）">
        <textarea className="textarea" value={content} onChange={(e) => setContent(e.target.value)} placeholder="如：HR 说简历已收到，本周内安排笔试" />
      </Field>
      <div className="grid grid-2">
        <Field label="下次跟进日期（留空按默认节奏）">
          <input className="input" type="date" value={followAt} onChange={(e) => setFollowAt(e.target.value)} />
        </Field>
        <Field label="备注">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      <div className="small muted mt16 mb8">时间线（{timeline.length}）</div>
      {timeline.length === 0 ? (
        <div className="empty">还没有沟通记录。发出第一条招呼后点上面的「已发打招呼」。</div>
      ) : (
        timeline.map((m) => {
          const label = REPLY_STATUS_LABEL[String(m.reply_status)] ?? { text: String(m.reply_status), cls: 'badge' }
          return (
            <div key={m.id} className="row" style={{ alignItems: 'flex-start', marginBottom: 12 }}>
              <span className={label.cls}>{label.text}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="small muted">
                  {fmtDateTime(m.sent_at ?? m.created_at)} · {m.direction === 'in' ? '对方 → 我' : '我 → 对方'}
                  {m.channel ? ` · ${m.channel}` : ''}
                </div>
                {m.content ? <div className="md">{m.content}</div> : null}
                {m.notes ? <div className="small muted">备注：{m.notes}</div> : null}
                {m.next_follow_at ? <div className="small muted">计划跟进：{fmtDate(m.next_follow_at)}</div> : null}
              </div>
            </div>
          )
        })
      )}

      <div className="hint mt16">
        这里只做「你自己登记」的沟通台账：工作台不登录招聘平台、不自动发消息、不抓取你的会话数据。登记的价值在于——超过跟进窗口仍未回复的岗位，总览页会自动挑出来提醒你换渠道。
      </div>
    </Drawer>
  )
}
