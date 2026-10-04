/**
 * 本地助手侧 · 「桥接页」的逻辑（/bridge 页用它）。
 *
 * 为什么需要它：线上 https 页面 fetch http://127.0.0.1 要过浏览器「本地网络访问」（LNA）权限，
 * 没授权时请求既不 resolve 也不 reject，界面只能超时。**但顶层导航到 127.0.0.1 是豁免的** ——
 * 所以可以让工作台开一个小窗到这个桥接页，由桥接页（与助手同源）替工作台调接口，
 * 再用 postMessage 把结果送回去。这条路完全不需要用户去翻浏览器设置。
 *
 * 安全边界：
 *   · 只认白名单里的 origin（server 在路由层就挡了），消息里再校验 origin + nonce；
 *   · 只转发助手自己的路径（isAllowedBridgePath），不能被当成任意代理；
 *   · 不回传任何凭据 —— 助手本来也不碰凭据。
 */

export const BRIDGE_READY = 'iw-bridge-ready'
export const BRIDGE_REQUEST = 'iw-bridge-request'
export const BRIDGE_RESPONSE = 'iw-bridge-response'

/** 只允许转发助手自己的路径：必须以单个 / 开头、不能是 //、不能有 .. */
export function isAllowedBridgePath(p) {
  return typeof p === 'string' && p.length > 1 && p.charAt(0) === '/' && p.charAt(1) !== '/' && p.indexOf('..') < 0
}

/**
 * 桥接协议实现（把依赖都传进来，方便 Node 里单测）。
 * deps: { openerOrigin, nonce, postToOpener(msg), fetchImpl(path, init) }
 */
export function createBridge(deps) {
  const openerOrigin = deps.openerOrigin || ''
  const nonce = deps.nonce || ''
  const postToOpener = deps.postToOpener
  const fetchImpl = deps.fetchImpl

  function post(msg) {
    try { postToOpener(msg) } catch { /* 窗口没了就算了 */ }
  }

  post({ type: BRIDGE_READY, nonce: nonce })

  function onMessage(ev) {
    if (!ev || ev.origin !== openerOrigin) return
    const d = ev.data || {}
    if (d.type !== BRIDGE_REQUEST) return
    if (d.nonce !== nonce) return
    if (!isAllowedBridgePath(d.path)) {
      post({ type: BRIDGE_RESPONSE, nonce: nonce, id: d.id, error: '桥接只转发助手自己的路径' })
      return
    }
    const init = { method: d.method || 'GET' }
    if (d.headers) init.headers = d.headers
    if (d.body !== undefined && d.body !== null) init.body = d.body
    Promise.resolve()
      .then(function () { return fetchImpl(d.path, init) })
      .then(function (r) {
        return Promise.resolve(r.text()).then(function (text) {
          post({ type: BRIDGE_RESPONSE, nonce: nonce, id: d.id, status: r.status, body: text })
        })
      })
      .catch(function (e) {
        post({ type: BRIDGE_RESPONSE, nonce: nonce, id: d.id, error: String((e && e.message) || e) })
      })
  }

  return { onMessage: onMessage, post: post }
}
