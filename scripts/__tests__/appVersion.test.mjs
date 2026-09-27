/**
 * 构建标记的断言：线上跑的是哪个版本，必须能从外部一句话问出来。
 *
 * 为什么要有这一条（2026-09-27 真实踩到）：发布 5f2a30e 之后，前端源码一行没动，产物文件名、
 * 字节数、内容全部与上一次相同 —— 于是"已经发布新代码"和"还在跑旧代码"从线上**完全无法区分**。
 * 当时唯一能引用的"证据"是 ETag / Last-Modified，而我实测那 12 分钟里没有任何新提交，
 * mtime 照样被推前了一次（沙箱重启也会改它）。所以时间型证据不能当发布判别器。
 *
 * 内容型证据才是判别器：把 package.json 的版本号注进 index.html，发版后
 * `curl -s <站点>/ | grep app-version` 一次就能证明线上是哪一版。
 * 版本号**只能从 package.json 取**，不许在任何地方写死字面量 —— 否则版本一升，
 * 标记就变成假的，而假标记比没标记更坏。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { appVersionPlugin } from '../appVersionPlugin.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..', '..')
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version

const SAMPLE = '<!doctype html>\n<html lang="zh-CN">\n  <head>\n    <meta charset="UTF-8" />\n    <title>实习管理工作台</title>\n  </head>\n  <body><div id="root"></div></body>\n</html>\n'

describe('app-version 构建标记', () => {
  it('构建时把版本号注进 index.html 的 meta', () => {
    const plugin = appVersionPlugin(version)
    const out = plugin.transformIndexHtml(SAMPLE)
    expect(out).toContain(`<meta name="app-version" content="${version}" />`)
  })

  it('插件是 Vite 认识的形状（名字 + build 阶段生效）', () => {
    const plugin = appVersionPlugin(version)
    expect(plugin.name).toBe('iwb-app-version')
    expect(plugin.apply).toBe('build')
  })

  it('版本从 package.json 传进来，任何配置文件里都不许写死字面量', () => {
    for (const f of ['scripts/appVersionPlugin.mjs', 'vite.config.ts']) {
      const src = readFileSync(path.join(root, f), 'utf8')
      expect(src, `${f} 里写死了版本号，升级时标记会变成假的`).not.toContain(`"${version}"`)
    }
  })

  it('没给版本号时直接抛，而不是悄悄注一个空标记', () => {
    // 空标记最坏：curl 永远 grep 得到那行 meta，于是"验证通过"是假的
    expect(() => appVersionPlugin('')).toThrow()
    expect(() => appVersionPlugin(undefined)).toThrow()
  })

  it('版本号的唯一来源是 package.json：配置里既不能出现版本字面量，也不能有第二种取值路径', () => {
    const cfg = readFileSync(path.join(root, 'vite.config.ts'), 'utf8')
    // 只查"有没有写死当前版本"是弱的：写成 9.9.9 这种假字面量照样过。
    // 所以两头都钉：不许有任何版本形式的字面量，取值必须是从 package.json 读出来的那一行。
    expect(cfg).not.toMatch(/appVersion\s*=\s*['"][^'"]+['"]/)
    expect(cfg).toMatch(/appVersion\s*=\s*String\(JSON\.parse\(readFileSync\(new URL\(['"]\.\/package\.json['"]/)
    expect(cfg).toContain('appVersionPlugin(appVersion)')
  })

  it('模板里没有 </head> 时直接抛，而不是悄悄返回原文（那样标记就永远不在，没人知道）', () => {
    const plugin = appVersionPlugin(version)
    expect(() => plugin.transformIndexHtml('<html><body>没有 head</body></html>')).toThrow('</head>')
  })

  it('vite.config 真的挂了这个插件（没挂上等于标记永远不进产物）', () => {
    const cfg = readFileSync(path.join(root, 'vite.config.ts'), 'utf8')
    expect(cfg).toContain('appVersionPlugin')
    expect(cfg).toMatch(/plugins:\s*\[[^\]]*appVersionPlugin/)
  })
})
