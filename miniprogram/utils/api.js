const { cloud, errText } = require('./cloud')

function db() {
  return cloud.database
}

/**
 * 唯一的数据访问出口。页面不直接调 SDK。
 * 所有表都开了 RLS（owner_id = auth.uid()），前端永远不传 owner_id。
 */

function listRows(table, opts) {
  const o = opts || {}
  let q = db().from(table).select('*')
  const filters = o.filters || []
  for (let i = 0; i < filters.length; i += 1) q = q.eq(filters[i][0], filters[i][1])
  q = q.order(o.order || 'created_at', { ascending: o.ascending === true })
  if (o.limit) q = q.limit(o.limit)
  return q.then(function (res) {
    if (res.error) throw new Error(errText(res.error))
    return res.data || []
  })
}

function insertRow(table, payload) {
  return db().from(table).insert(payload).select().then(function (res) {
    if (res.error) throw new Error(errText(res.error))
    const rows = res.data || []
    // 空数组 = 被 RLS 拒绝。不能当成功处理，否则界面显示成功而数据根本没落库。
    if (!rows.length) throw new Error('写入被拒绝：请确认已登录且数据归属当前账号')
    return rows[0]
  })
}

function updateRow(table, id, patch) {
  return db().from(table).update(patch).eq('id', id).select().then(function (res) {
    if (res.error) throw new Error(errText(res.error))
    const rows = res.data || []
    if (!rows.length) throw new Error('没有改动任何数据：该记录不存在或不属于当前账号')
    return rows[0]
  })
}

function deleteRow(table, id) {
  return db().from(table).delete().eq('id', id).select().then(function (res) {
    if (res.error) throw new Error(errText(res.error))
    const rows = res.data || []
    if (!rows.length) throw new Error('删除失败：该记录不存在或不属于当前账号')
    return true
  })
}

/** 只取主键用于计数，避免把整表内容拉下来 */
function countRows(table) {
  return db().from(table).select('id').then(function (res) {
    if (res.error) throw new Error(errText(res.error))
    return (res.data || []).length
  })
}

function getProfile() {
  return db().from('profile').select('*').limit(1).then(function (res) {
    if (res.error) throw new Error(errText(res.error))
    const rows = res.data || []
    return rows.length ? rows[0] : null
  })
}

function saveProfile(payload) {
  return getProfile().then(function (current) {
    const body = Object.assign({}, payload)
    delete body.id
    if (current && current.id) {
      body.updated_at = new Date().toISOString()
      return updateRow('profile', current.id, body)
    }
    return insertRow('profile', body)
  })
}

/** 写一条沟通流水；状态变化时同步推进投递记录的阶段与下一步动作 */
function addMessage(input) {
  const app = input.application
  const pace = require('./pace')
  return insertRow('messages', {
    application_id: app ? app.id : null,
    company: input.company,
    title: input.title || null,
    direction: input.direction,
    channel: input.channel || (app ? app.channel : null) || null,
    content: input.content || null,
    reply_status: input.status,
    replied_at: input.direction === 'in' ? new Date().toISOString() : null,
    next_follow_at: input.followAt || defaultFollowAt(input.status),
    notes: input.notes || null
  }).then(function (row) {
    if (!app) return row
    const nextStage = pace.stageForStatus(input.status, String(app.stage || 'applied'))
    const patch = { updated_at: new Date().toISOString() }
    if (nextStage !== app.stage) patch.stage = nextStage
    if (input.status === 'interview') patch.next_action = '准备面试：复盘项目细节与常见八股'
    else if (input.status === 'replied') patch.next_action = '回复 HR 并确认下一步安排'
    else if (input.status === 'rejected') patch.next_action = '归档，复盘这一家挂在哪一步'
    else patch.next_action = '按跟进日再联系一次，仍未回就换渠道'
    patch.next_action_at = input.followAt || defaultFollowAt(input.status)
    // 阶段推进失败不阻塞流水记录本身
    return updateRow('applications', app.id, patch).catch(function () { return row })
  })
}

function plusDays(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return formatPad(d.getFullYear()) + '-' + formatPad(d.getMonth() + 1) + '-' + formatPad(d.getDate())
}

function formatPad(n) {
  return n < 10 ? '0' + n : String(n)
}

/** 不同状态给不同跟进节奏：招呼后 4 天、已读/超时未回 2 天、其余 1 天 */
function defaultFollowAt(status) {
  if (status === 'sent') return plusDays(4)
  if (status === 'read' || status === 'no_reply') return plusDays(2)
  return plusDays(1)
}

function timelineFor(messages, applicationId) {
  return messages
    .filter(function (m) { return Number(m.application_id) === Number(applicationId) })
    .sort(function (a, b) {
      return String(a.sent_at || a.created_at || '').localeCompare(String(b.sent_at || b.created_at || ''))
    })
}

function lastContactByApplication(messages) {
  const out = {}
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i]
    const key = String(m.application_id === null || m.application_id === undefined ? '' : m.application_id)
    if (!key) continue
    const prev = out[key]
    const cur = String(m.sent_at || m.created_at || '')
    if (!prev || cur >= String(prev.sent_at || prev.created_at || '')) out[key] = m
  }
  return out
}

module.exports = {
  listRows: listRows,
  insertRow: insertRow,
  updateRow: updateRow,
  deleteRow: deleteRow,
  countRows: countRows,
  getProfile: getProfile,
  saveProfile: saveProfile,
  addMessage: addMessage,
  defaultFollowAt: defaultFollowAt,
  timelineFor: timelineFor,
  lastContactByApplication: lastContactByApplication
}
