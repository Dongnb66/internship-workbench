const api = require('../../utils/api')
const score = require('../../utils/score')
const ai = require('../../utils/ai')
const format = require('../../utils/format')
const constants = require('../../utils/constants')
const { ensureLogin, toastError } = require('../../utils/auth')

/**
 * 把某个字段值映射成 picker 的下标。
 *
 * picker 必须落在 0..options.length-1 之间，但**兜底值不能是 0** —— 从前写
 * `Math.max(0, indexOf(v))`，值不在选项里时静默变成第一项，用户一保存就把真实值
 * 覆盖了（岗位来源被改成「BOSS直聘」就是这么来的）。所以这里对未识别值追加一项，
 * 让它在 picker 里显式可见，用户能看到「这条记录的值不在选项里」而不是被悄悄改掉。
 */
function pickIndex(options, value, appendUnknown) {
  const i = options.indexOf(value)
  if (i >= 0) return { index: i, options: options }
  if (!appendUnknown) return { index: 0, options: options }
  const next = options.concat([value]) // 保真显示原值，保存时不会被改写
  return { index: next.length - 1, options: next }
}

const EMPTY_FORM = {
  id: null,
  company: '',
  title: '',
  city: '',
  job_type: '实习',
  salary: '',
  source: constants.CHANNELS[0],
  url: '',
  deadline: '',
  jd_text: '',
  notes: ''
}

Page({
  data: {
    loading: true,
    keyword: '',
    rows: [],
    total: 0,
    profile: null,
    formOpen: false,
    form: EMPTY_FORM,
    jobTypes: constants.JOB_TYPES,
    channels: constants.CHANNELS,
    jobTypeIndex: 0,
    channelIndex: 0,
    busy: false,
    aiOpen: false,
    aiResult: null,
    aiDims: [],
    aiResultCompany: ''
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
    return Promise.all([api.listRows('jobs', { limit: 500 }), api.getProfile()])
      .then(function (res) {
        // 存一份原始列表：搜索只做本地过滤，不必每敲一个字就请求一次
        that._allRows = res[0]
        that.setData({ profile: res[1] })
        that.applyFilter(res[0], that.data.keyword)
        that.setData({ loading: false })
      })
      .catch(function (err) {
        that.setData({ loading: false })
        toastError(err)
      })
  },

  /** 列表项在 JS 里预先算好展示字段，WXML 里不做复杂表达式 */
  applyFilter(all, keyword) {
    const kw = String(keyword || '').trim().toLowerCase()
    const list = []
    for (let i = 0; i < all.length; i += 1) {
      const j = all[i]
      const hay = (String(j.company || '') + ' ' + String(j.title || '') + ' ' + String(j.city || '')).toLowerCase()
      if (kw && hay.indexOf(kw) < 0) continue
      const local = score.localScore(j.jd_text || '', j.title || '', this.data.profile)
      list.push({
        id: j.id,
        company: j.company,
        title: j.title,
        city: j.city || '',
        salary: j.salary || '',
        source: j.source || '',
        hasJd: !!(j.jd_text && String(j.jd_text).trim()),
        score: j.match_score === null || j.match_score === undefined ? null : j.match_score,
        localScore: local.score,
        priority: j.priority || '',
        deadlineText: j.deadline ? format.fmtDate(j.deadline) + ' · ' + format.leftText(j.deadline) : '未填截止',
        deadlineUrgent: format.daysLeft(j.deadline) !== null && format.daysLeft(j.deadline) <= 3
      })
    }
    list.sort(function (a, b) {
      return (b.score === null ? -1 : Number(b.score)) - (a.score === null ? -1 : Number(a.score))
    })
    this.setData({ rows: list, total: all.length })
  },

  onKeyword(e) {
    const kw = e.detail.value
    this.setData({ keyword: kw })
    this.applyFilter(this._allRows || [], kw)
  },

  clearKeyword() {
    this.setData({ keyword: '' })
    this.applyFilter(this._allRows || [], '')
  },

  openNew() {
    this.setData({
      formOpen: true,
      form: Object.assign({}, EMPTY_FORM),
      jobTypes: constants.JOB_TYPES,
      channels: constants.CHANNELS,
      jobTypeIndex: 0,
      channelIndex: 0
    })
  },

  openEdit(e) {
    const id = e.currentTarget.dataset.id
    const that = this
    api.listRows('jobs', { limit: 1, filters: [['id', id]] })
      .then(function (rows) {
        const j = rows[0]
        if (!j) return
        const type = pickIndex(constants.JOB_TYPES, j.job_type || '实习', false)
        const chan = pickIndex(constants.CHANNELS, j.source || EMPTY_FORM.source, true)
        that.setData({
          formOpen: true,
          form: {
            id: j.id,
            company: j.company || '',
            title: j.title || '',
            city: j.city || '',
            job_type: j.job_type || '实习',
            salary: j.salary || '',
            source: j.source || EMPTY_FORM.source,
            url: j.url || '',
            deadline: j.deadline ? format.dateOnly(j.deadline) : '',
            jd_text: j.jd_text || '',
            notes: j.notes || ''
          },
          jobTypes: type.options,
          channels: chan.options,
          jobTypeIndex: type.index,
          channelIndex: chan.index
        })
      })
      .catch(toastError)
  },

  closeForm() {
    this.setData({ formOpen: false })
  },

  onField(e) {
    const key = e.currentTarget.dataset.key
    const form = Object.assign({}, this.data.form)
    form[key] = e.detail.value
    this.setData({ form: form })
  },

  onJobType(e) {
    const i = Number(e.detail.value)
    const form = Object.assign({}, this.data.form)
    form.job_type = constants.JOB_TYPES[i]
    this.setData({ form: form, jobTypeIndex: i })
  },

  onChannel(e) {
    const i = Number(e.detail.value)
    const form = Object.assign({}, this.data.form)
    form.source = constants.CHANNELS[i]
    this.setData({ form: form, channelIndex: i })
  },

  onDeadline(e) {
    const form = Object.assign({}, this.data.form)
    form.deadline = e.detail.value
    this.setData({ form: form })
  },

  save() {
    const form = this.data.form
    if (!String(form.company || '').trim() || !String(form.title || '').trim()) {
      wx.showToast({ title: '公司与岗位名称为必填', icon: 'none' })
      return
    }
    const local = score.localScore(form.jd_text, form.title, this.data.profile)
    const payload = {
      company: String(form.company).trim(),
      title: String(form.title).trim(),
      city: form.city || null,
      job_type: form.job_type || null,
      salary: form.salary || null,
      source: form.source || null,
      url: form.url || null,
      deadline: form.deadline || null,
      jd_text: form.jd_text || null,
      notes: form.notes || null,
      match_score: local.score,
      updated_at: new Date().toISOString()
    }

    const that = this
    this.setData({ busy: true })
    const task = form.id
      ? api.updateRow('jobs', form.id, payload)
      : api.insertRow('jobs', payload)
    task
      .then(function () {
        that.setData({ busy: false, formOpen: false })
        wx.showToast({ title: form.id ? '已保存' : '已加入岗位池', icon: 'success' })
        that.load()
      })
      .catch(function (err) {
        that.setData({ busy: false })
        toastError(err)
      })
  },

  remove() {
    const form = this.data.form
    if (!form.id) return
    const that = this
    wx.showModal({
      title: '删除岗位',
      content: '确定删除「' + form.company + ' · ' + form.title + '」？已有的投递记录不受影响。',
      success(res) {
        if (!res.confirm) return
        api.deleteRow('jobs', form.id)
          .then(function () {
            that.setData({ formOpen: false })
            wx.showToast({ title: '已删除', icon: 'success' })
            that.load()
          })
          .catch(toastError)
      }
    })
  },

  /** 两段式评分的第一段 + 第二段：本地预筛不通过就直接跳过 AI，省额度 */
  aiScore(e) {
    const id = e.currentTarget.dataset.id
    const that = this
    const row = this.data.rows.filter(function (r) { return r.id === id })[0]
    if (!row) return

    api.listRows('jobs', { limit: 1, filters: [['id', id]] }).then(function (rows) {
      const job = rows[0]
      if (!job) return

      const pre = score.prefilterJob(job.jd_text || '', job.title || '', that.data.profile)
      if (!pre.pass) {
        wx.showModal({
          title: '先不送 AI',
          content: pre.reason + '。已把本地分写回岗位池。',
          showCancel: false
        })
        api.updateRow('jobs', id, { match_score: pre.score }).then(function () { that.load() }).catch(function () {})
        return
      }

      wx.showLoading({ title: 'AI 评估中…', mask: true })
      ai.evaluateJD(job.jd_text || '', that.data.profile)
        .then(function (result) {
          const priority = result.score >= 75 ? '高' : result.score >= 55 ? '中' : '低'
          return api
            .updateRow('jobs', id, { match_score: result.score, priority: priority })
            .then(function () {
              return api.insertRow('ai_reports', {
                company: job.company,
                title: job.title,
                jd_text: job.jd_text || '',
                score: result.score,
                verdict: result.verdict,
                dims: result.dims,
                highlights: result.highlights.join('\n'),
                gaps: result.gaps.join('\n'),
                greeting: result.greeting,
                model: 'cloud-llm'
              })
            })
            .then(function () {
              wx.hideLoading()
              that.setData({
                aiResult: result,
                aiDims: constants.DIMS.map(function (d) { return { name: d, value: result.dims[d] } }),
                aiResultCompany: job.company + ' · ' + job.title,
                aiOpen: true
              })
              that.load()
            })
        })
        .catch(function (err) {
          wx.hideLoading()
          toastError(err)
        })
    }).catch(toastError)
  },

  closeAi() {
    this.setData({ aiOpen: false, aiResult: null })
  },

  copyGreeting() {
    const result = this.data.aiResult
    if (!result || !result.greeting) return
    wx.setClipboardData({
      data: result.greeting,
      success() {
        wx.showToast({ title: '话术已复制', icon: 'success' })
      }
    })
  },

  /** 转入投递看板 */
  toPipeline(e) {
    const id = e.currentTarget.dataset.id
    const that = this
    const row = this.data.rows.filter(function (r) { return r.id === id })[0]
    if (!row) return
    api
      .insertRow('applications', {
        job_id: id,
        company: row.company,
        title: row.title,
        city: row.city || null,
        stage: 'applied',
        channel: row.source || null,
        applied_at: format.todayISO(),
        next_action: '复制打招呼话术发出去',
        next_action_at: format.todayISO()
      })
      .then(function () {
        wx.showToast({ title: '已转入投递', icon: 'success' })
        setTimeout(function () {
          wx.switchTab({ url: '/pages/pipeline/pipeline' })
        }, 600)
      })
      .catch(toastError)
  }
})
