import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Key 的可见性：推导式源码检查，不靠人记得住。
 *
 * 「Key 不进界面、不进日志、不进 URL」这三条，单元测试只能证明**发送器**这一侧做对了。
 * 但泄露更常发生在没人盯的地方：某人在页面里顺手 `value={key}` 回填了一下，
 * 或者调试时 `console.log(key)` 一行——代码照样全绿，Key 却已经躺在 DOM、截图与录屏里了。
 * 所以这里从源码目录**推导**出该管的文件集合，而不是手写一份清单（手写清单会腐烂）。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(here, '..', '..') // src/

function filesIn(dir, re) {
  const out = []
  for (const name of readdirSync(path.join(SRC, dir))) {
    if (!re.test(name)) continue
    out.push({ rel: `${dir}/${name}`, text: readFileSync(path.join(SRC, dir, name), 'utf8') })
  }
  return out
}

const viewFiles = [...filesIn('pages', /\.(ts|tsx)$/), ...filesIn('components', /\.(ts|tsx)$/)]
const libFiles = filesIn('lib', /\.(ts|tsx)$/)

describe('Key 的可见性（源码级）', () => {
  it('扫到东西了：视图层与 lib 都扫得到，否则这条检查是空的', () => {
    expect(viewFiles.length, '一个页面/组件都没扫到，扫描逻辑坏了').toBeGreaterThanOrEqual(8)
    expect(libFiles.map((f) => f.rel)).toContain('lib/byoSend.ts')
  })

  it('视图层里没有一处能读到 Key 原文（只有一条发送路径 + 自检可以读）', () => {
    // `function readUserKey` 是定义那一处，不算读取点：只有被调用的地方才是
    const readers = [...viewFiles, ...libFiles].filter((f) => /(?<!function\s)readUserKey\s*\(/.test(f.text))
    expect(
      readers.map((f) => f.rel),
      'Key 原文的读取点必须只有两处，多一处就多一处泄露面',
    ).toEqual(['lib/ai.ts', 'lib/byoSetup.ts'])
  })

  it('界面不许绕过模块直接读存储里的 Key（那是把「只在本机」变成「随便读」）', () => {
    const offenders = viewFiles.filter((f) => /wb_byo_key|BYO_KEY_KEY/.test(f.text)).map((f) => f.rel)
    expect(offenders, `这些视图直接碰了 Key 的存储键：${offenders.join('、')}`).toEqual([])
  })

  it('Key 会流经的两个模块里一句 console 都没有', () => {
    for (const rel of ['lib/byoSend.ts', 'lib/byoSetup.ts', 'lib/billing.ts']) {
      const f = libFiles.find((x) => x.rel === rel)
      expect(f, `找不到 ${rel}`).toBeTruthy()
      expect(f.text, `${rel} 里有 console.*：调试语句会把 Key 留在控制台与日志里`).not.toMatch(/console\.(log|info|debug|warn|error)/)
    }
  })

  it('Key 只出现在鉴权头那一行：任何提到 url 的行里都不许出现 key', () => {
    const src = readFileSync(path.join(SRC, 'lib', 'byoSend.ts'), 'utf8')
    const lines = src
      .split(/\r?\n/)
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => /url/i.test(l) && /\bkey\b/i.test(l) && !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    expect(
      lines.map((x) => `${x.n}: ${x.l.trim()}`),
      'URL 与 Key 出现在同一行：Key 极可能被拼进了地址（地址会进日志、会出现在截图中）',
    ).toEqual([])
  })

  it('自备通道碰不到平台云服务（花不到创建者的钱）', () => {
    const src = readFileSync(path.join(SRC, 'lib', 'byoSend.ts'), 'utf8')
    expect(src, 'byoSend 引了 cloud SDK：自费通道就有了烧平台额度的路').not.toMatch(/from '\.\.\/cloud'/)
  })

  it('唯一入口只有两条去路：byo 发送器 或 平台 SDK，各一次', () => {
    const src = readFileSync(path.join(SRC, 'lib', 'ai.ts'), 'utf8')
    expect((src.match(/streamByoChat\(/g) ?? []).length).toBe(1)
    expect((src.match(/cloud\.llm\.chat\.completions\.create\(/g) ?? []).length).toBe(1)
  })
})
