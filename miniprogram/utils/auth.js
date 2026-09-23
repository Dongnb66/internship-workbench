const { cloud } = require('./cloud')

/**
 * 数据页的登录闸门：没有会话就回登录页。
 * 受保护的数据一律先过这里 —— 不靠 localStorage 造一个假身份。
 */
function ensureLogin() {
  return cloud.auth
    .getSession()
    .then(function (res) {
      const session = res && res.data
      if (!session) {
        wx.reLaunch({ url: '/pages/login/login' })
        return null
      }
      getApp().globalData.session = session
      return session
    })
    .catch(function () {
      wx.reLaunch({ url: '/pages/login/login' })
      return null
    })
}

/** 失败提示：把服务端错误原样透出，避免"操作失败"这种没法排查的文案 */
function toastError(error) {
  const text = typeof error === 'string' ? error : (error && error.message) || '操作失败，请重试'
  wx.showToast({ title: text.length > 30 ? text.slice(0, 30) + '…' : text, icon: 'none', duration: 2500 })
}

module.exports = { ensureLogin: ensureLogin, toastError: toastError }
