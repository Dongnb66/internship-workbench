const format = require('./format')

/** 投递节奏守则：判断现在能不能发、还剩几条 */
const DEFAULT_PACE = { dailyLimit: 8, window: '09:00-21:00', minIntervalMin: 30 }

/** 发送前自检清单：投递纪律的可执行版本 */
const GREET_CHECKLIST = [
  '读一遍，改成我平时说话的样子，不像模板',
  '没有出现学校名称',
  '没有提到自己没做过的技术',
  '技术数字与简历口径一致，能经得起 clone 核对',
  '长度与对方问题的强度匹配，问一句就不要回三段',
  '只放大真实可验证的能力，没有自曝短板'
]

/** "09:00-21:00" → [540, 1260]（距零点分钟数） */
function parseWindow(value) {
  const m = /^(\d{1,2}):(\d{2})\s*[-~—]\s*(\d{1,2}):(\d{2})$/.exec(String(value || '').trim())
  if (!m) return [9 * 60, 21 * 60]
  return [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])]
}

function inWindow(now, value) {
  const range = parseWindow(value)
  const minutes = now.getHours() * 60 + now.getMinutes()
  return minutes >= range[0] && minutes <= range[1]
}

function isToday(iso, today) {
  return !!iso && String(iso).slice(0, 10) === today
}

/** 我发出的打招呼（direction=out），对方发来的不占我的发送额度 */
function outgoing(messages) {
  return messages.filter(function (m) { return (m.direction || 'out') === 'out' })
}

function paceStatus(messages, config, now) {
  const cfg = config || DEFAULT_PACE
  const current = now || new Date()
  const today = format.todayISO()
  const outs = outgoing(messages)
  let sentToday = 0
  for (let i = 0; i < outs.length; i += 1) {
    if (isToday(outs[i].sent_at || outs[i].created_at, today)) sentToday += 1
  }

  const sorted = outs.slice().sort(function (a, b) {
    return String(b.sent_at || b.created_at || '').localeCompare(String(a.sent_at || a.created_at || ''))
  })
  const last = sorted[0]
  let minutesSinceLast = null
  if (last) {
    // 用 format.parseDate 而不是自己 replace —— 与 Web 端 pace.ts 的 `new Date(...)` 同口径。
    // 自己剥掉 T/时区后缀会把 UTC 时间当成本地时间，算出「距上次发送」差几个小时。
    const lastAt = format.parseDate(last.sent_at || last.created_at)
    if (!isNaN(lastAt.getTime())) minutesSinceLast = Math.floor((current.getTime() - lastAt.getTime()) / 60000)
  }

  const inWindowNow = inWindow(current, cfg.window)
  const reasons = []
  if (sentToday >= cfg.dailyLimit) reasons.push('今日已达上限 ' + cfg.dailyLimit + ' 条')
  if (!inWindowNow) reasons.push('不在发送时间窗 ' + cfg.window + ' 内')
  if (minutesSinceLast !== null && minutesSinceLast < cfg.minIntervalMin) {
    reasons.push('距上次发送仅 ' + minutesSinceLast + ' 分钟，冷却 ' + cfg.minIntervalMin + ' 分钟')
  }

  return {
    sentToday: sentToday,
    limit: cfg.dailyLimit,
    remaining: Math.max(0, cfg.dailyLimit - sentToday),
    inWindowNow: inWindowNow,
    minutesSinceLast: minutesSinceLast,
    allowed: reasons.length === 0,
    reasons: reasons
  }
}

/** 已投递但超过 days 天没有新沟通的岗位，用来提醒换渠道 */
function staleApplications(applications, messages, days, today) {
  const limit = days === undefined ? 7 : days
  const base = new Date(String(today || format.todayISO()).replace(/-/g, '/')).getTime()
  const out = []
  for (let i = 0; i < applications.length; i += 1) {
    const app = applications[i]
    if (app.stage === 'offer' || app.stage === 'rejected') continue
    const times = [String(app.applied_at || app.created_at || '')]
    for (let j = 0; j < messages.length; j += 1) {
      const m = messages[j]
      if (Number(m.application_id) !== Number(app.id)) continue
      times.push(String(m.replied_at || m.sent_at || m.created_at || ''))
    }
    const filtered = times.filter(Boolean).sort()
    const lastAt = filtered.length ? filtered[filtered.length - 1] : null
    if (!lastAt) continue
    const diff = Math.floor((base - new Date(String(lastAt).slice(0, 10).replace(/-/g, '/')).getTime()) / 86400000)
    if (diff >= limit) out.push({ application: app, lastAt: String(lastAt).slice(0, 10), days: diff })
  }
  return out.sort(function (a, b) { return b.days - a.days })
}

const REPLY_STATUS_LABEL = {
  sent: { text: '已发送', cls: 'badge-info' },
  read: { text: '对方已读', cls: 'badge' },
  replied: { text: '已回复', cls: 'badge-warn' },
  interview: { text: '已约面', cls: 'badge-ok' },
  rejected: { text: '已婉拒', cls: 'badge-danger' },
  no_reply: { text: '未回复', cls: 'badge' }
}

function replyLabel(status) {
  return REPLY_STATUS_LABEL[String(status)] || { text: String(status || '已记录'), cls: 'badge' }
}

/** 沟通过后建议推进到的投递阶段 */
function stageForStatus(status, current) {
  if (status === 'interview') return 'interview'
  if (status === 'rejected') return 'rejected'
  if (status === 'replied' && current === 'applied') return 'written'
  return current
}

module.exports = {
  DEFAULT_PACE: DEFAULT_PACE,
  GREET_CHECKLIST: GREET_CHECKLIST,
  parseWindow: parseWindow,
  inWindow: inWindow,
  isToday: isToday,
  outgoing: outgoing,
  paceStatus: paceStatus,
  staleApplications: staleApplications,
  REPLY_STATUS_LABEL: REPLY_STATUS_LABEL,
  replyLabel: replyLabel,
  stageForStatus: stageForStatus
}
