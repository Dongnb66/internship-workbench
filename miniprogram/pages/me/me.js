const api = require('../../utils/api')
const constants = require('../../utils/constants')
const pace = require('../../utils/pace')
const format = require('../../utils/format')
const { cloud } = require('../../utils/cloud')
const { ensureLogin, toastError } = require('../../utils/auth')

const BLANK = {
  full_name: '',
  grade: '',
  grad_year: '',
  major: '',
  school: '',
  phone: '',
  contact_email: '',
  github: '',
  portfolio: '',
  available_days: '',
  self_intro: '',
  expect_city: '',
  expect_type: '',
  expect_daily: '',
  skills: '',
  directions: '',
  resume_summary: '',
  daily_greet_limit: '',
  greet_window: '',
  min_interval_min: ''
}

Page({
  data: {
    identity: '',
    loginWay: '',
    form: Object.assign({}, BLANK),
    counts: [],
    checklist: pace.GREET_CHECKLIST,
    busy: false,
    savedAt: ''
  },

  onShow() {
    const that = this
    ensureLogin().then(function (session) {
      if (!session) return
      // 不同登录方式返回的会话结构不完全一致，能取到什么就显示什么
      const user = session.user || session
      const phone = user.phone || ''
      const email = user.email || session.email || ''
      that.setData({
        identity: phone || email || '已登录',
        loginWay: phone ? '手机号登录' : '微信 / 邮箱登录'
      })
      that.loadProfile()
      that.loadCounts()
    })
  },

  loadProfile() {
    const that = this
    return api.getProfile()
      .then(function (p) {
        if (!p) return
        that.setData({
          form: {
            full_name: p.full_name || '',
            grade: p.grade || '',
            grad_year: p.grad_year || '',
            major: p.major || '',
            school: p.school || '',
            phone: p.phone || '',
            contact_email: p.contact_email || '',
            github: p.github || '',
            portfolio: p.portfolio || '',
            available_days: p.available_days || '',
            self_intro: p.self_intro || '',
            expect_city: (p.expect_city || []).join('、'),
            expect_type: (p.expect_type || []).join('、'),
            expect_daily: p.expect_daily ? String(p.expect_daily) : '',
            skills: (p.skills || []).join('、'),
            directions: (p.directions || []).join('、'),
            resume_summary: p.resume_summary || '',
            daily_greet_limit: p.daily_greet_limit ? String(p.daily_greet_limit) : '',
            greet_window: p.greet_window || '',
            min_interval_min: p.min_interval_min ? String(p.min_interval_min) : ''
          }
        })
      })
      .catch(function () {})
  },

  loadCounts() {
    const that = this
    const tables = [
      { key: 'jobs', label: '岗位池' },
      { key: 'applications', label: '投递记录' },
      { key: 'messages', label: '沟通流水' },
      { key: 'ai_reports', label: '评估历史' },
      { key: 'tasks', label: '待办' }
    ]
    return Promise.all(
      tables.map(function (t) {
        return api.countRows(t.key)
          .then(function (n) { return { key: t.key, label: t.label, count: n } })
          .catch(function () { return { key: t.key, label: t.label, count: 0 } })
      })
    ).then(function (list) {
      that.setData({ counts: list })
    })
  },

  onField(e) {
    const key = e.currentTarget.dataset.key
    const patch = {}
    patch['form.' + key] = e.detail.value
    this.setData(patch)
  },

  fillTemplate() {
    const t = constants.PROFILE_TEMPLATE
    this.setData({
      form: Object.assign({}, this.data.form, {
        full_name: t.full_name,
        grade: t.grade,
        grad_year: t.grad_year,
        major: t.major,
        school: t.school,
        github: 'https://github.com/Dongnb66',
        portfolio: 'https://github.com/Dongnb66/vibe-portfolio',
        available_days: t.available_days,
        self_intro: t.self_intro,
        expect_city: t.expect_city.join('、'),
        expect_type: t.expect_type.join('、'),
        expect_daily: String(t.expect_daily),
        skills: t.skills.join('、'),
        directions: t.directions.join('、'),
        resume_summary: t.resume_summary,
        daily_greet_limit: String(pace.DEFAULT_PACE.dailyLimit),
        greet_window: pace.DEFAULT_PACE.window,
        min_interval_min: String(pace.DEFAULT_PACE.minIntervalMin)
      })
    })
    wx.showToast({ title: '已填入模板，请核对后保存', icon: 'none', duration: 2200 })
  },

  resetPace() {
    const patch = {
      'form.daily_greet_limit': String(pace.DEFAULT_PACE.dailyLimit),
      'form.greet_window': pace.DEFAULT_PACE.window,
      'form.min_interval_min': String(pace.DEFAULT_PACE.minIntervalMin)
    }
    this.setData(patch)
    wx.showToast({ title: '已恢复默认节奏', icon: 'none' })
  },

  save() {
    const f = this.data.form
    const that = this
    this.setData({ busy: true })
    api.saveProfile({
      full_name: f.full_name || null,
      grade: f.grade || null,
      grad_year: f.grad_year || null,
      major: f.major || null,
      school: f.school || null,
      phone: f.phone || null,
      contact_email: f.contact_email || null,
      github: f.github || null,
      portfolio: f.portfolio || null,
      available_days: f.available_days || null,
      self_intro: f.self_intro || null,
      expect_city: format.textToArray(f.expect_city),
      expect_type: format.textToArray(f.expect_type),
      expect_daily: f.expect_daily ? Number(f.expect_daily) : null,
      skills: format.textToArray(f.skills),
      directions: format.textToArray(f.directions),
      resume_summary: f.resume_summary || null,
      daily_greet_limit: f.daily_greet_limit ? Number(f.daily_greet_limit) : null,
      greet_window: f.greet_window || null,
      min_interval_min: f.min_interval_min ? Number(f.min_interval_min) : null
    })
      .then(function () {
        that.setData({ busy: false, savedAt: format.fmtDateTime(new Date().toISOString()) })
        wx.showToast({ title: '已保存', icon: 'success' })
      })
      .catch(function (err) {
        that.setData({ busy: false })
        toastError(err)
      })
  },

  signOut() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新登录才能看到自己的数据。',
      success(res) {
        if (!res.confirm) return
        cloud.auth.signOut().then(function () {
          getApp().globalData.session = null
          wx.reLaunch({ url: '/pages/login/login' })
        })
      }
    })
  }
})
