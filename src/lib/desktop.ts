/**
 * 桌面壳（Electron）能力探测。
 *
 * 为什么靠运行时探测而不是两套构建：网页与壳跑的是同一份前端代码。
 * 打成两个版本意味着两份产物、两处回归；而 window.iwbDesktop 只可能由壳的
 * preload 注入，浏览器里读到 undefined，界面据此不渲染桌面按钮。
 */
export interface DesktopState {
  /** 是否处于置顶浮窗模式 */
  float: boolean
  pinned: boolean
  platform: string
  version: string
}

interface DesktopBridge {
  platform: string
  getState(): Promise<DesktopState>
  setFloat(on: boolean): Promise<DesktopState>
  toggleFloat(): Promise<DesktopState>
}

declare global {
  interface Window {
    iwbDesktop?: DesktopBridge
  }
}

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = window.iwbDesktop
  if (!bridge || typeof bridge.getState !== 'function' || typeof bridge.toggleFloat !== 'function') return null
  return bridge
}
