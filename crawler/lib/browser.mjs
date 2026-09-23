/**
 * 浏览器启动。抽成独立模块，让 run.mjs（自动抓取）和 login.mjs（手动登录一次）
 * 用同一份启动参数 —— 两边必须共用一个档案目录，否则登录态同步不过来。
 *
 * 刻意不下载 Playwright 自带浏览器：直接驱动系统已装的 Edge / Chrome，
 * 既省几百 MB，也让页面表现和用户手动打开时完全一致（换 UA、换内核都会让反爬更敏感）。
 */

import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const HERE = path.dirname(fileURLToPath(import.meta.url))
export const CRAWLER_DIR = path.join(HERE, '..')
export const OUT_DIR = path.join(CRAWLER_DIR, 'output')
export const PROFILE_DIR = path.join(CRAWLER_DIR, '.profile')
export const COLLECTOR = path.join(CRAWLER_DIR, '..', 'extension', 'collector.js')

export function msgOf(error) {
  if (!error) return '未知错误'
  if (typeof error === 'string') return error
  return String(error.message ?? error).split('\n')[0].slice(0, 220)
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, Math.round(ms))))

/** 随机抖动，别让请求间隔变成可识别的机械节拍 */
export const politeDelay = (base) => sleep(base + Math.random() * base * 0.4)

export async function launchBrowser({ headless, args = [], profileDir = PROFILE_DIR }) {
  const { chromium } = await import('playwright-core')
  await mkdir(profileDir, { recursive: true })

  const attempts = [
    { channel: 'msedge', label: 'Microsoft Edge' },
    { channel: 'chrome', label: 'Google Chrome' },
    { channel: undefined, label: 'Playwright 自带 Chromium' },
  ]

  const failures = []
  for (const attempt of attempts) {
    try {
      const context = await chromium.launchPersistentContext(profileDir, {
        channel: attempt.channel,
        headless,
        args,
        viewport: { width: 1440, height: 900 },
        locale: 'zh-CN',
        acceptDownloads: false,
        // 少数企业招聘门户的证书配置有毛病（如 job.htsc.com.cn 的证书 CN 与域名不符），
        // 会以 ERR_CERT_COMMON_NAME_INVALID 直接拦掉。抓取器只**读公开页面**、
        // 不提交任何表单、不传任何凭据，跳过证书校验不会泄密；
        // 不这么做就只能手工把这类站点一个个删掉，反而丢公司。
        ignoreHTTPSErrors: true,
      })
      return { context, label: attempt.label, channel: attempt.channel ?? '' }
    } catch (error) {
      failures.push(`${attempt.label}：${msgOf(error)}`)
    }
  }

  // 三种内核全失败时，「档案目录被占用」和「根本没装浏览器」的表现一模一样 ——
  // 但处置方式完全相反（一个要去关进程，一个要去装浏览器）。之前一律报
  // 「没有可用的浏览器」，把上一种情况指向了错误的排查方向。这里按 lockfile 存在与否分开报。
  const locked = await hasLockfile(profileDir)
  if (locked) {
    throw new Error(
      [
        `浏览器档案目录被占用：${profileDir}`,
        '通常是上一次抓取没正常结束（超时、Ctrl+C、进程被强杀）留下的 --user-data-dir 锁。',
        '处置（任选其一）：',
        `  1) 关掉所有由本抓取器打开的 Edge/Chrome 窗口，然后删掉 ${path.join(profileDir, 'lockfile')}`,
        '  2) 换个目录跑，绕开占用：node run.mjs --site xxx --profile .profile2',
        '注意：换目录会丢掉已保存的登录态（BOSS 等需要登录的站点要重新 node login.mjs）。',
        ...failures.map((f) => `  - ${f}`),
      ].join('\n'),
    )
  }

  throw new Error(
    [
      '没有可用的浏览器。抓取器需要 Edge、Chrome 或 Playwright 自带的 Chromium 之一。',
      ...failures.map((f) => `  - ${f}`),
      '装一个即可（任选其一）：',
      '  npx playwright install chromium',
      '  （或直接装 Microsoft Edge / Google Chrome，抓取器会自动用它）',
    ].join('\n'),
  )
}

/** 档案目录里是否有 Chromium 的 lockfile —— 有就说明被另一个进程占着 */
async function hasLockfile(profileDir) {
  try {
    const { access } = await import('node:fs/promises')
    await access(path.join(profileDir, 'lockfile'))
    return true
  } catch {
    return false
  }
}
