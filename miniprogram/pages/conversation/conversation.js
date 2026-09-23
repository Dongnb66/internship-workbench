const api = require('../../utils/api')
const pace = require('../../utils/pace')
const format = require('../../utils/format')
const constants = require('../../utils/constants')
const { ensureLogin, toastError } = require('../../utils/auth')

Page({
  data: {
    loading: true,
    id: null,
    app: null,
    timeline: [],
    quickActions: [],
    content: '',
    notes: '',
    followAt: '',
    gate: false,
    checks: [],
    greetChecklist: pace.GREET_CHECKLIST,
    allChecked: false,
    busy: false,
    paceInfo: null
  },

  onLoad(query) {
    this.setData({ id: Number(query.id) })
    const actions = [
      { status: 'sent', label: '已发打招呼', direction: 'out' },
      { status: 'read', label: '对方已读', direction: 'out' },
      { status: 'replied', label: 'HR 回复了', direction: 'in' },
      { status: 'interview', label: '约到面试/笔试', direction: 'in' },
      { status: 'rejected', label: '被婉拒', direction: 'in' },
      { status: 'no_reply', label: '超时未回', direction: 'in' }
    ]
    const checks = pace.GREET_CHECKLIST.map(function () { return false })
    this.setData({ quickActions: actions, checks: checks })
  },

  onShow() {
    const that = this
    ensureLogin().then(function (session) {
      if (!session) return
      that.load()
    })
  },

  load() {
    const that = this
    return Promise.all([
      api.listRows('applications', { limit: 1, filters: [['id', this.data.id]] }),
      api.listRows('messages', { limit: 1000, order: 'sent_at', ascending: false }),
      api.getProfile()
    ])
      .then(function (res) {
        const app = res[0][0]
        const messages = res[1]
        const profile = res[2]

        const timeline = api.timelineFor(messages, that.data.id).map(function (m) {
          const label = pace.replyLabel(m.reply_status)
          return {
            id: m.id,
            label: label.text,
            cls: label.cls,
            when: format.fmtDateTime(m.sent_at || m.created_at),
            who: m.direction === 'in' ? '对方 → 我' : '我 → 对方',
            channel: m.channel || '',
            content: m.content || '',
            notes: m.notes || '',
            followAt: m.next_follow_at ? format.fmtDate(m.next_follow_at) : ''
          }
        })

        const config = {
          dailyLimit: profile && profile.daily_greet_limit ? Number(profile.daily_greet_limit) : pace.DEFAULT_PACE.dailyLimit,
          window: (profile && profile.greet_window) || pace.DEFAULT_PACE.window,
          minIntervalMin: profile && profile.min_interval_min ? Number(profile.min_interval_min) : pace.DEFAULT_PACE.minIntervalMin
        }
        const status = pace.paceStatus(messages, config)

        that.setData({
          loading: false,
          app: app
            ? {
                id: app.id,
                company: app.company,
                title: app.title,
                stage: app.stage,
                stageLabel: constants.stageLabel(app.stage),
                nextAction: app.next_action || '',
                nextAt: app.next_action_at ? format.fmtDate(app.next_action_at) : ''
              }
            : null,
          timeline: timeline,
          paceInfo: {
            sentToday: status.sentToday,
            limit: status.limit,
            allowed: status.allowed,
            reasonText: status.reasons.join('；')
          }
        })
      })
      .catch(toastError)
  },

  onContent(e) {
    this.setData({ content: e.detail.value })
  },

  onNotes(e) {
    this.setData({ notes: e.detail.value })
  },

  onFollowAt(e) {
    this.setData({ followAt: e.detail.value })
  },

  toggleCheck(e) {
    const i = Number(e.currentTarget.dataset.index)
    const checks = this.data.checks.slice()
    checks[i] = !checks[i]
    this.setData({ checks: checks, allChecked: checks.every(Boolean) })
  },

  /** 打招呼是唯一会触发平台风控的动作：发之前必须先过一遍自检清单 */
  tapAction(e) {
    const status = e.currentTarget.dataset.status
    const direction = e.currentTarget.dataset.direction
    if (status === 'sent') {
      this.setData({ gate: true })
      return
    }
    this.record(status, direction)
  },

  cancelGate() {
    this.setData({ gate: false })
  },

  confirmGate() {
    if (!this.data.allChecked) return
    // 节奏守则不是摆设：超出上限、不在时间窗、没到冷却时间就不许登记发送
    const info = this.data.paceInfo
    if (info && !info.allowed) {
      wx.showToast({ title: info.reasonText || '当前不适合发送', icon: 'none', duration: 2600 })
      return
    }
    const that = this
    this.record('sent', 'out').then(function () {
      that.setData({ gate: false, checks: pace.GREET_CHECKLIST.map(function () { return false }), allChecked: false })
    })
  },

  record(status, direction) {
    const that = this
    this.setData({ busy: true })
    return api
      .addMessage({
        application: this.data.app ? { id: this.data.app.id, stage: this.data.app.stage, channel: '' } : null,
        company: this.data.app ? this.data.app.company : '',
        title: this.data.app ? this.data.app.title : '',
        status: status,
        direction: direction,
        content: this.data.content || null,
        notes: this.data.notes || null,
        followAt: this.data.followAt || null
      })
      .then(function () {
        that.setData({ busy: false, content: '', notes: '', followAt: '' })
        wx.showToast({ title: '已记到会话流水', icon: 'success' })
        return that.load()
      })
      .catch(function (err) {
        that.setData({ busy: false })
        toastError(err)
      })
  }
})
