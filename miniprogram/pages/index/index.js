const api = require('../../utils/api')
const pace = require('../../utils/pace')
const format = require('../../utils/format')
const { ensureLogin, toastError } = require('../../utils/auth')

Page({
  data: {
    loading: true,
    stats: { jobs: 0, applied: 0, interview: 0, offer: 0, tasks: 0 },
    pace: null,
    stale: [],
    todos: [],
    // 先给一个值，避免首屏 undefined === false 判断不成立导致提示条闪一下
    hasProfile: true
  },

  onShow() {
    const that = this
    ensureLogin().then(function (session) {
      if (!session) return
      that.load()
    })
  },

  onPullDownRefresh() {
    const that = this
    this.load().then(function () { wx.stopPullDownRefresh() })
  },

  load() {
    this.setData({ loading: true })
    const that = this
    return Promise.all([
      api.listRows('jobs', { limit: 500 }),
      api.listRows('applications', { limit: 500 }),
      api.listRows('tasks', { limit: 500, order: 'due_at', ascending: true }),
      api.listRows('messages', { limit: 1000, order: 'sent_at', ascending: false }),
      api.getProfile()
    ])
      .then(function (res) {
        const jobs = res[0]
        const apps = res[1]
        const tasks = res[2]
        const messages = res[3]
        const profile = res[4]

        let applied = 0
        let interviewing = 0
        let offers = 0
        for (let i = 0; i < apps.length; i += 1) {
          applied += 1
          if (apps[i].stage === 'interview') interviewing += 1
          if (apps[i].stage === 'offer') offers += 1
        }

        const openTasks = tasks.filter(function (t) { return !t.done })
        const todos = openTasks.slice(0, 5).map(function (t) {
          return {
            id: t.id,
            title: t.title,
            kind: t.kind || '其它',
            company: t.company || '',
            due: format.fmtDate(t.due_at),
            left: format.leftText(t.due_at),
            urgent: format.daysLeft(t.due_at) !== null && format.daysLeft(t.due_at) <= 1
          }
        })

        const config = {
          dailyLimit: profile && profile.daily_greet_limit ? Number(profile.daily_greet_limit) : pace.DEFAULT_PACE.dailyLimit,
          window: (profile && profile.greet_window) || pace.DEFAULT_PACE.window,
          minIntervalMin: profile && profile.min_interval_min ? Number(profile.min_interval_min) : pace.DEFAULT_PACE.minIntervalMin
        }
        const status = pace.paceStatus(messages, config)
        const percent = Math.min(100, Math.round((status.sentToday / Math.max(1, status.limit)) * 100))

        const staleList = pace.staleApplications(apps, messages, 7).slice(0, 5).map(function (s) {
          return {
            id: s.application.id,
            company: s.application.company,
            title: s.application.title,
            days: s.days,
            lastAt: s.lastAt,
            urgent: s.days >= 14
          }
        })

        that.setData({
          loading: false,
          stats: {
            jobs: jobs.length,
            applied: applied,
            interview: interviewing,
            offer: offers,
            tasks: openTasks.length
          },
          pace: {
            sentToday: status.sentToday,
            limit: status.limit,
            remaining: status.remaining,
            allowed: status.allowed,
            window: config.window,
            inWindowNow: status.inWindowNow,
            minutesSinceLast: status.minutesSinceLast,
            minIntervalMin: config.minIntervalMin,
            reasons: status.reasons,
            percent: percent
          },
          stale: staleList,
          todos: todos,
          hasProfile: !!profile
        })
      })
      .catch(function (err) {
        that.setData({ loading: false })
        toastError(err)
      })
  },

  markDone(e) {
    const id = e.currentTarget.dataset.id
    const that = this
    api.updateRow('tasks', id, { done: true })
      .then(function () {
        wx.showToast({ title: '已标记完成', icon: 'success' })
        that.load()
      })
      .catch(toastError)
  },

  goJobs() {
    wx.switchTab({ url: '/pages/jobs/jobs' })
  },

  goPipeline() {
    wx.switchTab({ url: '/pages/pipeline/pipeline' })
  },

  goSettings() {
    wx.switchTab({ url: '/pages/me/me' })
  },

  openConversation(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/conversation/conversation?id=' + id })
  }
})
