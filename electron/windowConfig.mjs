/**
 * 桌面壳的纯配置逻辑（不 import electron）。
 *
 * 为什么单独一个文件：壳的坏法几乎都是「静默跑偏」——浮窗被拖到屏幕外、
 * 启动地址被误配成 file:// 导致登录态失效。把这几条规则抽成纯函数，
 * 才能在 node 里单测，而不是只能靠人肉点一遍窗口。
 */

/** 主窗口最小尺寸：再窄侧栏与内容区就挤在一起，不如让用户放大 */
export const MIN_MAIN_SIZE = { width: 1024, height: 640 }

/** 浮窗尺寸：够放下一屏提词，又不至于盖住会议画面 */
export const FLOAT_SIZE = { width: 420, height: 360 }

/** 浮窗贴边留白 */
export const FLOAT_MARGIN = 16

/** 全局快捷键：切换浮窗置顶。刻意避开常见输入法/截图快捷键 */
export const TOGGLE_ACCELERATOR = 'CommandOrControl+Shift+Space'

/** 开发模式的默认地址：与 vite.config.ts 的 server.port 对齐 */
export const DEV_URL = 'http://localhost:5173'

/**
 * 线上应用地址（与 src/cloud.ts 的 endpoint 同域）。
 *
 * 为什么默认加载线上而不是本地 dist：云 SDK 的 Origin 校验与 RLS 都按发布域判断，
 * 换成本地 file:// 或 127.0.0.1 会让登录与写操作直接失败。
 * 壳只负责「窗口」，不搬应用。
 *
 * 为什么地址上带 `?sharecode=`：2026-11-15 起裸域返回 403「链接不完整」，只有带分享码的
 * 完整链接能进（实测 403 → 200）。分享码只影响访问，不影响 Origin（Origin 不含查询参数），
 * 所以云 SDK 的校验照旧按 `https://<host>` 精确匹配。分享码一旦轮换，这里要跟着改。
 */
export const ONLINE_URL = 'https://internship-workbench-47024.app.workbuddy.host/?sharecode=R6PQHLIZUV'

/**
 * 只允许 http / https / file 三种协议。
 * 放行 `javascript:` 或 `data:` 等于把 main 进程的 loadURL 变成任意代码入口。
 */
export function isAllowedStartUrl(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return false
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:'
  } catch {
    return false
  }
}

/**
 * 启动地址的优先级：显式覆盖 > 开发模式 > 线上地址。
 *
 * 覆盖项存在但不合法时**直接回退**而不是抛错：壳打不开比地址写错更难排查，
 * 回退后至少还能进到页面。
 */
export function resolveStartUrl({ env = {}, dev = false } = {}) {
  const override = String(env.IWB_DESKTOP_URL ?? '').trim()
  if (override && isAllowedStartUrl(override)) return override
  if (dev) return DEV_URL
  return ONLINE_URL
}

/**
 * 把期望的窗口矩形夹回工作区。
 *
 * 真实场景：浮窗外接显示器拔掉后，旧坐标落在不存在的屏幕上——
 * 不做夹取的话窗口「还在」，但用户永远看不到它。
 */
export function clampBounds(desired, workArea) {
  const area = {
    x: Number(workArea?.x ?? 0),
    y: Number(workArea?.y ?? 0),
    width: Math.max(1, Number(workArea?.width ?? 0)),
    height: Math.max(1, Number(workArea?.height ?? 0)),
  }
  const width = Math.min(Math.max(1, Number(desired?.width ?? FLOAT_SIZE.width)), area.width)
  const height = Math.min(Math.max(1, Number(desired?.height ?? FLOAT_SIZE.height)), area.height)
  const x = Math.min(Math.max(Number(desired?.x ?? area.x), area.x), area.x + area.width - width)
  const y = Math.min(Math.max(Number(desired?.y ?? area.y), area.y), area.y + area.height - height)
  return { x, y, width, height }
}

/** 浮窗默认落在工作区右上角：面试时人的视线习惯在右上方，也不挡输入框 */
export function defaultFloatBounds(workArea) {
  const area = workArea ?? { x: 0, y: 0, width: 0, height: 0 }
  return clampBounds(
    {
      x: Number(area.x ?? 0) + Number(area.width ?? 0) - FLOAT_SIZE.width - FLOAT_MARGIN,
      y: Number(area.y ?? 0) + FLOAT_MARGIN,
      width: FLOAT_SIZE.width,
      height: FLOAT_SIZE.height,
    },
    area,
  )
}
