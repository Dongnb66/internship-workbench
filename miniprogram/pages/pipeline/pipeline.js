const api = require('../../utils/api')
const pace = require('../../utils/pace')
const format = require('../../utils/format')
const constants = require('../../utils/constants')
const { ensureLogin, toastError } = require('../../utils/auth')

Page({
  data: {
    loading: true,
    stage: 'all',
    stageTabs: [],
    rows: [],
    counts: {},
    total: 0,
    staleCount: 0
  },

  onShow() {
    const that = this
    ensureLogin().then(function (session) {
      if (!session) return
      that.load()
    })
  },

  onPullDownRefresh() {
    this.load().then(function () { wx.stopPullDownRefresh() })
  },

  load() {
    this.setData({ loading: true })
    const that = this
    return Promise.all([
      api.listRows('applications', { limit: 800 }),
      api.listRows('messages', { limit: 1000, order: 'sent_at', ascending: false })
    ])
      .then(function (res) {
        const apps = res[0]
        const messages = res[1]
        const lastContact = api.lastContactByApplication(messages)
        const stale = pace.staleApplications(apps, messages, 7)
        const staleIds = {}
        for (let i = 0; i < stale.length; i += 1) staleIds[String(stale[i].application.id)] = stale[i].days

        const counts = { all: apps.length }
        for (let i = 0; i < constants.STAGES.length; i += 1) {
          const key = constants.STAGES[i].key
          counts[key] = 0
        }
        for (let i = 0; i < apps.length; i += 1) {
          if (counts[apps[i].stage] === undefined) counts[apps[i].stage] = 0
          counts[apps[i].stage] += 1
        }

        const tabs = [{ key: 'all', label: '全部', count: apps.length }]
        for (let i = 0; i < constants.STAGES.length; i += 1) {
          tabs.push({
            key: constants.STAGES[i].key,
            label: constants.STAGES[i].label,
            count: counts[constants.STAGES[i].key] || 0
          })
        }

        const filtered = that.data.stage === 'all'
          ? apps
          : apps.filter(function (a) { return a.stage === that.data.stage })

        const rows = filtered.map(function (a) {
          const last = lastContact[String(a.id)]
          return {
            id: a.id,
            company: a.company,
            title: a.title,
            city: a.city || '',
            stage: a.stage,
            stageLabel: constants.stageLabel(a.stage),
            stageColor: constants.stageColor(a.stage),
            channel: a.channel || '渠道未记',
            appliedText: format.fmtDate(a.applied_at),
            nextAction: a.next_action || '',
            nextAt: a.next_action_at ? format.fmtDate(a.next_action_at) : '',
            lastText: last
              ? pace.replyLabel(last.reply_status).text + ' · ' + format.fmtDate(last.sent_at || last.created_at)
              : '暂无沟通记录',
            lastCls: last ? pace.replyLabel(last.reply_status).cls : 'badge',
            staleDays: staleIds[String(a.id)] || 0,
            staleUrgent: (staleIds[String(a.id)] || 0) >= 14
          }
        })

        that.setData({
          loading: false,
          rows: rows,
          stageTabs: tabs,
          counts: counts,
          total: apps.length,
          staleCount: stale.length
        })
      })
      .catch(function (err) {
        that.setData({ loading: false })
        toastError(err)
      })
  },

  pickStageTab(e) {
    const that = this
    this.setData({ stage: e.currentTarget.dataset.key }, function () {
      that.load()
    })
  },

  changeStage(e) {
    const id = e.currentTarget.dataset.id
    const that = this
    const labels = constants.STAGES.map(function (s) { return s.label })
    wx.showActionSheet({
      itemList: labels,
      success(res) {
        const next = constants.STAGES[res.tapIndex]
        if (!next) return
        api.updateRow('applications', id, { stage: next.key, updated_at: new Date().toISOString() })
          .then(function () {
            wx.showToast({ title: '已移到「' + next.label + '」', icon: 'none' })
            that.load()
          })
          .catch(toastError)
      },
      fail() {}
    })
  },

  openConversation(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/conversation/conversation?id=' + id })
  },

  removeApp(e) {
    const id = e.currentTarget.dataset.id
    const that = this
    const row = this.data.rows.filter(function (r) { return r.id === id })[0]
    if (!row) return
    wx.showModal({
      title: '删除投递记录',
      content: '删除「' + row.company + ' · ' + row.title + '」？沟通流水不会被删除。',
      success(res) {
        if (!res.confirm) return
        api.deleteRow('applications', id)
          .then(function () {
            wx.showToast({ title: '已删除', icon: 'success' })
            that.load()
          })
          .catch(toastError)
      }
    })
  }
})
