import { describe, expect, it } from 'vitest'
import { crawlFailureHint } from '../crawlTask'

/**
 * 失败提示的分派判据。
 *
 * 起因（2026-10-03 用户视角实测）：桌面包缺 extension/collector.js 与 playwright-core，
 * 用户点一次「开始抓取」必失败，而卡片统一说「常见的是站点改版或需要登录」——
 * 把**本地缺件**指成了站点问题。这里按日志签名一条条钉住，别让那句话再回来。
 */
describe('抓取失败提示按日志分派', () => {
  it('缺依赖 → 去 crawler 目录 npm install', () => {
    const hint = crawlFailureHint({
      log: ["Cannot find package 'playwright-core' imported from C:\\x\\crawler\\lib\\browser.mjs"],
      error: 'run.mjs 退出码 2',
    })
    expect(hint).toContain('npm install')
  })

  it('缺采集脚本 → 说本地助手装得不完整', () => {
    const hint = crawlFailureHint({
      log: ["ENOENT: no such file or directory, open 'C:\\x\\extension\\collector.js'"],
      error: 'run.mjs 退出码 2',
    })
    expect(hint).toContain('extension/collector.js')
    expect(hint).toContain('装得不完整')
  })

  it('档案目录被占用 → 让用户关掉抓取器开的浏览器', () => {
    const hint = crawlFailureHint({ log: ['浏览器档案目录被占用：C:\\x\\crawler\\.profile'], error: null })
    expect(hint).toContain('档案目录')
  })

  it('需要登录 → 给出 login.mjs', () => {
    expect(crawlFailureHint({ log: ['这站需要登录'], error: null })).toContain('login.mjs')
  })

  it('认不出来时才退回原来那句', () => {
    expect(crawlFailureHint({ log: ['第 1 页读到 0 条'], error: null })).toContain('站点改版或需要登录')
  })

  it('空任务也不炸', () => {
    expect(typeof crawlFailureHint({})).toBe('string')
    expect(typeof crawlFailureHint({ log: [], error: null })).toBe('string')
  })
})
