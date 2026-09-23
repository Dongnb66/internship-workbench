const { cloud } = require('./utils/cloud')

App({
  globalData: {
    session: null,
    profile: null
  },

  onLaunch() {
    this.refreshSession()
  },

  /** 缓存当前会话，供页面判断是否已登录 */
  refreshSession() {
    const that = this
    return cloud.auth.getSession()
      .then(function (res) {
        that.globalData.session = (res && res.data) || null
        return that.globalData.session
      })
      .catch(function () {
        that.globalData.session = null
        return null
      })
  }
})
