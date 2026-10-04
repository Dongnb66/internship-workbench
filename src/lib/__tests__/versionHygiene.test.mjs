import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 版本号卫生：任何源码都不许给"版本号"写死字面量。
 *
 * 为什么单独立一条（2026-10-04 真实事故）：usageEnv.ts 里曾写死一个版本字面量，新版本上线后
 * 线上埋点把每一批都报成上一版 —— 页面上的 app-version meta 是对的、埋点里的版本是错的，
 * 同一页面两套版本号；而四件套、发布判别器、逐字节核验全都发现不了（构建不报错、哈希也对）。
 * appVersionPlugin.mjs 的头注释早写了「写死的标记在升级后会变成假话，而假话比没标记更坏」，
 * 这条测试就是把那句话变成会红的断言。
 *
 * 判据刻意收窄：只抓"给版本语义的常量赋值一个字面量"。注释里的历史版本叙述不算违规，
 * 127.0.0.1 这类 IP 也不能被误伤。
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SCAN_DIRS = ['src', 'scripts']

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs|js|jsx)$/.test(name)) out.push(p)
  }
  return out
}

const VIOLATION = /(APP_VERSION|appVersion|VERSION)\s*[:=]\s*['"]\d+\.\d+\.\d+['"]/

describe('版本号卫生：不许写死', () => {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))).filter(
    (f) => !f.includes('__tests__') && !/\.test\./.test(f),
  )

  it('扫到的文件数正常（防止扫描自己悄悄失效）', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('没有任何文件给版本号写死字面量', () => {
    const bad = []
    for (const f of files) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (VIOLATION.test(line)) bad.push(f.replace(ROOT, '') + ':' + (i + 1) + '  ' + line.trim())
        })
    }
    expect(bad, '版本号必须从 package.json 注入（见 scripts/appVersionPlugin.mjs 头注释）').toEqual([])
  })

  it('埋点版本走构建期注入，不是字面量', () => {
    const src = readFileSync(join(ROOT, 'src/lib/usageEnv.ts'), 'utf8')
    expect(src).toContain('__APP_VERSION__')
    expect(src).not.toMatch(VIOLATION)
  })

  it('注入通道是通的：插件把版本号 define 进去，配置文件不写死', () => {
    const plugin = readFileSync(join(ROOT, 'scripts/appVersionPlugin.mjs'), 'utf8')
    expect(plugin).toContain('__APP_VERSION__')
    expect(plugin).toContain('app-version')
    const vite = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')
    expect(vite).toContain('appVersionPlugin')
    expect(vite).not.toMatch(VIOLATION)
  })
})
