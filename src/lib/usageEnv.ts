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

export const USAGE_OS =
  typeof navigator === 'undefined'
    ? 'unknown'
    : /Win/i.test(navigator.userAgent)
      ? 'win'
      : /Mac/i.test(navigator.userAgent)
        ? 'mac'
        : /Linux|Android/i.test(navigator.userAgent)
          ? 'linux'
          : 'other'
