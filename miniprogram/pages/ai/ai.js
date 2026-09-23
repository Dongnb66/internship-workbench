const api = require('../../utils/api')
const ai = require('../../utils/ai')
const score = require('../../utils/score')
const constants = require('../../utils/constants')
const { ensureLogin, toastError } = require('../../utils/auth')

Page({
  data: {
    company: '',
    title: '',
    jd: '',
    profile: null,
    busy: false,
    prefilter: null,
    result: null,
    dims: [],
    error: '',
    saved: false,
    recent: []
  },

  onShow() {
    const that = this
    ensureLogin().then(function (session) {
      if (!session) return
      that.loadProfile()
      that.loadRecent()
    })
  },

  loadProfile() {
    const that = this
    return api.getProfile().then(function (p) {
      that.setData({ profile: p })
      that.refreshPrefilter()
    }).catch(function () {})
  },

  loadRecent() {
    const that = this
    return api.listRows('ai_reports', { limit: 8 })
      .then(function (rows) {
        that.setData({
          recent: rows.map(function (r) {
            return {
              id: r.id,
              company: r.company || '未填公司',
              title: r.title || '',
              score: r.score,
              verdict: r.verdict || '',
              greeting: r.greeting || ''
            }
          })
        })
      })
      .catch(function () {})
  },

  onCompany(e) {
    this.setData({ company: e.detail.value })
  },

  onTitle(e) {
    this.setData({ title: e.detail.value })
    this.refreshPrefilter()
  },

  onJd(e) {
    this.setData({ jd: e.detail.value })
    this.refreshPrefilter()
  },

  /** 本地预筛分是免费的，输入时就给用户一个即时反馈 */
  refreshPrefilter() {
    const jd = this.data.jd
    if (!String(jd || '').trim()) {
      this.setData({ prefilter: null })
      return
    }
    const pre = score.prefilterJob(jd, this.data.title, this.data.profile)
    // 数组直接丢给 WXML 会被拼成一整串且不可控，先在这里拼好再渲染
    pre.hitsText = pre.hits.join('、')
    pre.missingText = pre.missing.join('、')
    this.setData({ prefilter: pre })
  },

  runEval() {
    const jd = String(this.data.jd || '').trim()
    if (!jd) {
      this.setData({ error: '先把 JD 原文粘进来' })
      return
    }
    this.setData({ busy: true, error: '', result: null, saved: false })
    const that = this
    ai.evaluateJD(jd, this.data.profile)
      .then(function (res) {
        that.setData({
          busy: false,
          result: res,
          dims: constants.DIMS.map(function (d) { return { name: d, value: res.dims[d] } })
        })
        wx.pageScrollTo({ scrollTop: 99999, duration: 250 })
      })
      .catch(function (err) {
        that.setData({ busy: false, error: typeof err === 'string' ? err : (err && err.message) || '评估失败，请重试' })
      })
  },

  copyGreeting() {
    if (!this.data.result || !this.data.result.greeting) return
    wx.setClipboardData({
      data: this.data.result.greeting,
      success() {
        wx.showToast({ title: '话术已复制', icon: 'success' })
      }
    })
  },

  /** 评估结果落库，之后可以在岗位池/历史里回看 */
  saveResult() {
    if (!this.data.result) return
    const that = this
    const res = this.data.result
    api.insertRow('ai_reports', {
      company: this.data.company || null,
      title: this.data.title || null,
      jd_text: this.data.jd,
      score: res.score,
      verdict: res.verdict,
      dims: res.dims,
      highlights: res.highlights.join('\n'),
      gaps: res.gaps.join('\n'),
      greeting: res.greeting,
      model: 'cloud-llm'
    })
      .then(function () {
        that.setData({ saved: true })
        wx.showToast({ title: '已留档', icon: 'success' })
        that.loadRecent()
      })
      .catch(toastError)
  },

  /** 评估完顺手加进岗位池，省一次重复录入 */
  addToJobs() {
    if (!this.data.result) return
    const res = this.data.result
    const that = this
    api.insertRow('jobs', {
      company: this.data.company || '未填公司',
      title: this.data.title || '未填岗位',
      jd_text: this.data.jd,
      match_score: res.score,
      priority: res.score >= 75 ? '高' : res.score >= 55 ? '中' : '低',
      source: 'AI 评估',
      notes: res.verdict
    })
      .then(function () {
        wx.showToast({ title: '已加入岗位池', icon: 'success' })
        setTimeout(function () {
          wx.switchTab({ url: '/pages/jobs/jobs' })
        }, 600)
      })
      .catch(toastError)
  },

  useRecent(e) {
    const id = e.currentTarget.dataset.id
    const row = this.data.recent.filter(function (r) { return r.id === id })[0]
    if (!row) return
    wx.setClipboardData({
      data: row.greeting || '',
      success() {
        wx.showToast({ title: '历史话术已复制', icon: 'success' })
      }
    })
  }
})
