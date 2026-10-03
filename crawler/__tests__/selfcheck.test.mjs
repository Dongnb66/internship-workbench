import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkInstall } from '../agent/selfcheck.mjs'

/**
 * 本地助手自检的判据。
 *
 * 起因（2026-10-03 用户视角实测）：桌面包把 crawler/ 打了进去，却没带
 * extension/collector.js、也没装 playwright-core —— 用户点一次「开始抓取」就是 0 条。
 * 这三项判定必须在**用户点按钮之前**就能看见，所以它自己也得被钉住。
 */

const fakeBrowser = () => ({ label: 'Fake Edge', path: 'C:/fake/msedge.exe' })

function makeInstall({ collector = false, deps = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'iwb-agent-'))
  const crawler = path.join(root, 'crawler')
  mkdirSync(path.join(crawler, 'lib'), { recursive: true })
  writeFileSync(path.join(crawler, 'run.mjs'), '// stub\n')
  if (collector) {
    mkdirSync(path.join(root, 'extension'), { recursive: true })
    writeFileSync(path.join(root, 'extension', 'collector.js'), '// stub\n')
  }
  if (deps) {
    const pkg = path.join(crawler, 'node_modules', 'playwright-core')
    mkdirSync(pkg, { recursive: true })
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'playwright-core', version: '0.0.0', main: 'index.js' }))
    writeFileSync(path.join(pkg, 'index.js'), 'module.exports = {}\n')
  }
  return { root, crawler, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

describe('本地助手自检', () => {
  it('缺采集脚本 + 缺依赖都报出来（这就是桌面包坏掉时的状态）', () => {
    const f = makeInstall()
    try {
      const r = checkInstall({ crawlerDir: f.crawler, findBrowser: fakeBrowser })
      expect(r.ready).toBe(false)
      expect(r.problems.map((p) => p.code)).toEqual(['missing-collector', 'missing-deps'])
      for (const p of r.problems) {
        expect(p.fix.length).toBeGreaterThan(6)
        expect(p.message.length).toBeGreaterThan(6)
      }
    } finally {
      f.cleanup()
    }
  })

  it('缺依赖那条的 fix 必须给绝对路径（用户才照做得了）', () => {
    const f = makeInstall({ collector: true })
    try {
      const r = checkInstall({ crawlerDir: f.crawler, findBrowser: fakeBrowser })
      expect(r.problems.map((p) => p.code)).toEqual(['missing-deps'])
      expect(r.problems[0].fix).toContain(f.crawler)
    } finally {
      f.cleanup()
    }
  })

  it('三样齐了才 ready', () => {
    const f = makeInstall({ collector: true, deps: true })
    try {
      const r = checkInstall({ crawlerDir: f.crawler, findBrowser: fakeBrowser })
      expect(r.ready).toBe(true)
      expect(r.problems).toEqual([])
      expect(r.browser.label).toBe('Fake Edge')
      expect(r.collector.endsWith(path.join('extension', 'collector.js'))).toBe(true)
    } finally {
      f.cleanup()
    }
  })

  it('没有系统浏览器也算缺件（抓取器刻意不下载自带浏览器）', () => {
    const f = makeInstall({ collector: true, deps: true })
    try {
      const r = checkInstall({ crawlerDir: f.crawler, findBrowser: () => null })
      expect(r.ready).toBe(false)
      expect(r.problems.map((p) => p.code)).toEqual(['missing-browser'])
    } finally {
      f.cleanup()
    }
  })
})
