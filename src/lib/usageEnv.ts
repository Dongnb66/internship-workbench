/** 计数要带的两个环境字段：应用版本、操作系统（只到 win/mac/linux 这个粒度，不采集指纹） */

/**
 * 版本号只有一个来源：package.json（构建期由 scripts/appVersionPlugin.mjs 注入）。
 *
 * ⚠️ 这里不许出现版本字面量。2026-10-04 的真实事故：这个文件当初被写成了固定值，
 * 于是新版本上线后，线上这批计数记录全部报成上一版 —— 同一个页面上出现了两套版本号，
 * 其中一套是假的；而且四件套、判别器、逐字节核验全都发现不了（构建不报错、哈希也对）。
 * 假话比没标记更坏：以后按版本聚合会一直算错。所以：注入 + 下面这条 typeof 兜底。
 *
 * typeof 兜底是给 vitest 用的（测试直跑源码、不过 vite build，注入的全局不存在）。
 * 兜底值写 dev 而不是某个版本号 —— 不知道就说不知道。
 */
declare const __APP_VERSION__: string | undefined

export const USAGE_APP_VERSION =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'dev'

/**
 * 上报用的系统字段（只到 win/mac/linux/mobile/other，不采集指纹）。
 *
 * ⚠️ 手机必须最先判：iPhone/iPad 的 UA 里含 'Mac OS X'、Android 的 UA 里含 'Linux' ⇒
 * 放在后面会把手机记成 mac/linux。2026-10-04 真机踩到：发起人用手机打开线上站，
 * 库里那台会被记成 mac/linux，按系统分布从此失真（显示路径的 hostOs 先前已修，上报路径这里补齐）。
 */
export function detectOs(ua?: string): 'win' | 'mac' | 'linux' | 'mobile' | 'other' | 'unknown' {
  const s = ua ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent)
  if (!s) return 'unknown'
  if (/iPhone|iPad|iPod|Android|Mobile/i.test(s)) return 'mobile'
  if (/Win/i.test(s)) return 'win'
  if (/Mac/i.test(s)) return 'mac'
  if (/Linux/i.test(s)) return 'linux'
  return 'other'
}

export const USAGE_OS = detectOs()
