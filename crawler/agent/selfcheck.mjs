/**
 * 本地助手 · 自检（agent 启动横幅、CLI、打包脚本共用）
 *
 * 为什么要有：助手能不能干活只取决于三样东西在不在 ——
 *   ① extension/collector.js（采集脚本；crawler/lib/browser.mjs 硬指向这个相对路径）
 *   ② playwright-core（驱动系统浏览器，crawler 的 npm 依赖）
 *   ③ 系统里已装的 Edge / Chrome（刻意不下载 Playwright 自带浏览器，见 browser.mjs 的注释）
 * 缺任一样，「开始抓取」都必然失败，而失败现场（退出码 2 / ENOENT）对用户毫无指向。
 *
 * 2026-10-03 用用户视角实测：桌面包把 crawler/ 打了进去，却既没带 extension/、也没装依赖 ——
 * 用户点一次就是 0 条，界面还写着「常见的是站点改版或需要登录」，方向完全相反。
 * 所以这个判定必须**在用户点按钮之前**就能看到：/health 回传，卡片上显示，打包脚本拿它当闸门。
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_CRAWLER_DIR = path.join(HERE, '..')

/** 系统已装浏览器：与 crawler/lib/browser.mjs 的 channel 顺序一致（msedge → chrome） */
const BROWSER_CANDIDATES = [
  { label: 'Microsoft Edge', envs: ['ProgramFiles(x86)', 'ProgramFiles', 'LOCALAPPDATA'], rel: ['Microsoft', 'Edge', 'Application', 'msedge.exe'] },
  { label: 'Google Chrome', envs: ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'], rel: ['Google', 'Chrome', 'Application', 'chrome.exe'] },
]

export function findSystemBrowser(env = process.env) {
  for (const c of BROWSER_CANDIDATES) {
    for (const key of c.envs) {
      const base = env[key]
      if (!base) continue
      const p = path.join(base, ...c.rel)
      if (existsSync(p)) return { label: c.label, path: p }
    }
  }
  return null
}

/**
 * 自检。返回 { ready, crawlerDir, collector, browser, problems[] }。
 * problems 每一项都是「缺什么 + 怎么补」，文案可以直接贴到卡片上给用户看。
 */
export function checkInstall({ crawlerDir = DEFAULT_CRAWLER_DIR, findBrowser = findSystemBrowser } = {}) {
  const problems = []
  const root = path.join(crawlerDir, '..')
  const collector = path.join(root, 'extension', 'collector.js')

  if (!existsSync(collector)) {
    problems.push({
      code: 'missing-collector',
      message: '缺采集脚本 extension/collector.js（抓取器靠它从页面里提取岗位）',
      fix: '把仓库的 extension/ 整个目录复制到 ' + root + ' 下 —— 本地助手安装包应当自带它',
    })
  }

  try {
    createRequire(path.join(crawlerDir, 'run.mjs')).resolve('playwright-core')
  } catch {
    problems.push({
      code: 'missing-deps',
      message: '缺依赖 playwright-core（抓取器用它驱动你系统里的 Edge / Chrome）',
      fix: '在 ' + crawlerDir + ' 目录里执行 npm install',
    })
  }

  const browser = findBrowser()
  if (!browser) {
    problems.push({
      code: 'missing-browser',
      message: '没找到系统已装的 Edge / Chrome',
      fix: '装一个 Edge 或 Chrome 再试（抓取器刻意不下载自带浏览器，用的就是你平时那个）',
    })
  }

  return { ready: problems.length === 0, crawlerDir, collector, browser, problems }
}

/** 人话格式：CLI 输出与 server 启动横幅共用 */
export function formatProblems(problems) {
  return problems.map((p) => '· ' + p.message + '\n  修：' + p.fix).join('\n')
}

// 直接跑（node crawler/agent/selfcheck.mjs）时当 CLI 用；打包脚本拿退出码当闸门
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--crawler')
  const crawlerDir = i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? path.resolve(process.argv[i + 1])
    : DEFAULT_CRAWLER_DIR
  const r = checkInstall({ crawlerDir })
  if (r.ready) {
    console.log('✅ 自检通过：采集脚本在、依赖在、浏览器在（' + (r.browser ? r.browser.label : '?') + '）')
    process.exit(0)
  }
  console.error('❌ 自检没过：' + r.problems.length + ' 项要补')
  console.error(formatProblems(r.problems))
  process.exit(1)
}
