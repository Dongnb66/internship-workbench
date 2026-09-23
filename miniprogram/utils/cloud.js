const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram')
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics')

/**
 * 云服务公开配置（来自云服务开通时返回的 publicConfig）。
 *
 * endpoint 是小程序专用的固定网关，不是本应用自己的域名：
 * 小程序没有 Origin，服务端靠 publishableKey + 微信下发请求时的 Referer 识别应用，
 * 而微信的 request 合法域名白名单不接受通配符且有条数上限，所以所有小程序共用这一个网关。
 * 不要改成别的域名，也不要手工拼 /.cloud/** 请求。
 */
const publicConfig = {
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_5gjbFMxN0NBYiysW0uwtgh_7zj5R0UtUY8G7ei2NQ5xrCEr1G0MoteI',
}

const cloud = createMiniProgramWorkBuddyCloud({
  endpoint: publicConfig.endpoint,
  publishableKey: publicConfig.publishableKey,
  wx: createDiagnosticWx(wx),
})

/** 统一的错误文案：服务端返回的是对象，页面要的是能显示的字符串 */
function errText(error) {
  if (!error) return '未知错误'
  if (typeof error === 'string') return error
  if (typeof error.message === 'string' && error.message) return error.message
  if (error.error && typeof error.error.message === 'string') return error.error.message
  return '请求失败，请重试'
}

module.exports = { cloud, publicConfig, errText }
