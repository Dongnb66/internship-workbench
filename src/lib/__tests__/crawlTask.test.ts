import { describe, expect, it } from 'vitest'
import { hostOs, nonWindowsGuide, crawlFailureHint } from '../crawlTask'

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

describe('本地助手只有 Windows 版：非 Windows 的引导', () => {
  it('UA 认到系统（只看粒度，不采集指纹）', () => {
    expect(hostOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('win')
    expect(hostOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac')
    expect(hostOs('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux')
    expect(hostOs('')).toBe('other')
  })

  it('手机/平板必须先认出来 —— iPhone 的 UA 里含 Mac OS X，顺序错了会误报 macOS', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'
    expect(hostOs(iphone)).toBe('mobile')
    expect(hostOs('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36')).toBe('mobile')
    expect(nonWindowsGuide('mobile')!.osLabel).toBe('手机/平板')
    expect(nonWindowsGuide('mobile')!.why).toContain('电脑上的程序')
    expect(nonWindowsGuide('mac')!.why).toContain('只有 Windows 版')
  })

  it('Windows 不给多余提示', () => {
    expect(nonWindowsGuide('win')).toBe(null)
  })

  it('mac / linux / 未知都给四条替代路径与系统名', () => {
    for (const os of ['mac', 'linux', 'other'] as const) {
      const g = nonWindowsGuide(os)
      expect(g).not.toBe(null)
      expect(g!.lanes.length).toBe(4)
      expect(g!.lanes.map((l) => l.name)).toContain('岗位广场')
      expect(g!.lanes.map((l) => l.name)).toContain('批量导入')
      expect(g!.lanes.map((l) => l.name)).toContain('AI 评估')
      expect(g!.osLabel.length).toBeGreaterThan(0)
    }
    expect(nonWindowsGuide('mac')!.osLabel).toBe('macOS')
    expect(nonWindowsGuide('linux')!.osLabel).toBe('Linux')
  })
})
