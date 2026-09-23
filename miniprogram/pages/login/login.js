const { cloud, errText } = require('../../utils/cloud')

// 验证码挑战存在事件处理函数之外：发码与验码是两个独立动作。
// 重试填错的验证码时只读这里存下的结果，绝不重新发码 —— 否则会重复计费并让旧码失效。
let pendingPhone = null
let countdownTimer = null

Page({
  data: {
    tab: 'wechat',
    phone: '',
    code: '',
    password: '',
    countdown: 0,
    codeSent: false,
    busy: false,
    error: '',
    info: ''
  },

  onUnload() {
    if (countdownTimer) clearInterval(countdownTimer)
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab, error: '', info: '' })
  },

  onPhoneInput(e) {
    pendingPhone = null
    this.setData({ phone: e.detail.value, codeSent: false, error: '' })
  },

  onCodeInput(e) {
    this.setData({ code: e.detail.value })
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value })
  },

  startCountdown() {
    const that = this
    this.setData({ countdown: 60 })
    if (countdownTimer) clearInterval(countdownTimer)
    countdownTimer = setInterval(function () {
      const next = that.data.countdown - 1
      if (next <= 0) {
        clearInterval(countdownTimer)
        countdownTimer = null
        that.setData({ countdown: 0 })
        return
      }
      that.setData({ countdown: next })
    }, 1000)
  },

  /** 微信一键登录 */
  loginWechat() {
    if (this.data.busy) return
    this.setData({ busy: true, error: '', info: '' })
    const that = this
    wx.login({
      success(res) {
        if (!res.code) {
          that.setData({ busy: false, error: '微信未返回登录凭证，请重试' })
          return
        }
        const appid = wx.getAccountInfoSync().miniProgram.appId
        cloud.auth
          .signInWithWechat(res.code, appid)
          .then(function (r) {
            if (r.error) {
              that.setData({ busy: false, error: errText(r.error) })
              return
            }
            that.afterLogin()
          })
          .catch(function (err) {
            console.error('[WorkBuddy Cloud] login failed', JSON.stringify({
              stage: 'wechat-login-handler',
              message: (err && err.message) || '微信登录失败，请重试'
            }))
            that.setData({ busy: false, error: errText(err) })
          })
      },
      fail(err) {
        console.error('[WorkBuddy Cloud] login failed', JSON.stringify({
          stage: 'wx.login',
          message: err.errMsg
        }))
        that.setData({ busy: false, error: err.errMsg || '微信登录失败，请重试' })
      }
    })
  },

  /** 获取手机验证码：新号与老号都允许发码，走登录还是注册由发码结果决定 */
  sendPhoneCode() {
    const phone = String(this.data.phone || '').trim()
    if (!phone) {
      this.setData({ error: '请先填写手机号' })
      return
    }
    this.setData({ busy: true, error: '', info: '' })
    const that = this
    cloud.auth
      .sendOtp({ phone: phone })
      .then(function (res) {
        if (res.error) {
          that.setData({ busy: false, error: errText(res.error) })
          return
        }
        pendingPhone = {
          phone: phone,
          verificationId: res.data.verificationId,
          isExistingUser: res.data.isExistingUser
        }
        that.setData({
          busy: false,
          codeSent: true,
          info: '验证码已发送到 ' + phone + '，请查收短信'
        })
        that.startCountdown()
      })
      .catch(function (err) {
        that.setData({ busy: false, error: errText(err) })
      })
  },

  /** 验码即登录；这个手机号第一次用时同时完成注册 */
  submitPhone() {
    const current = pendingPhone
    if (!current || current.phone !== String(this.data.phone || '').trim()) {
      this.setData({ error: '请先为当前手机号获取验证码' })
      return
    }
    if (!String(this.data.code || '').trim()) {
      this.setData({ error: '请填写短信验证码' })
      return
    }
    this.setData({ busy: true, error: '' })
    const that = this
    cloud.auth
      .verifyOtp({
        phone: current.phone,
        verificationId: current.verificationId,
        isExistingUser: current.isExistingUser,
        token: String(this.data.code).trim(),
        password: current.isExistingUser ? undefined : (this.data.password || undefined)
      })
      .then(function (res) {
        if (res.error) {
          that.setData({ busy: false, error: '验证码不正确或已过期，可重新获取' })
          return
        }
        pendingPhone = null
        that.afterLogin()
      })
      .catch(function (err) {
        that.setData({ busy: false, error: errText(err) })
      })
  },

  afterLogin() {
    getApp().refreshSession()
    wx.reLaunch({ url: '/pages/index/index' })
  }
})
