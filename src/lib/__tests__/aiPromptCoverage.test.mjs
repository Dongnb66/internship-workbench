/**
 * 模型调用点的「外部文本隔离」覆盖率 —— **从源码推导，不维护手写清单**。
 *
 * 为什么必须是推导的：这个检查的前一版是一张手写的 7 条清单，跑起来全绿。
 * 而仓库里其实有第 8 个调用点（`src/lib/import.ts` 的岗位文本结构化），
 * 它把用户粘贴的招聘网站原文裸拼进了 prompt —— 手写清单不会有任何反应，
 * 因为它压根不知道有这么个调用点存在。
 *
 * 这个教训来自 career-ops（72k★）的 `validate-untrusted-content-coverage.mjs`：
 * 他们的注释里写着，硬编码的覆盖名单只能永远追着现实跑 ——
 * 有个 PR 排队期间又落了一个新的「摄取外部文本」的 mode，而校验器全程绿灯。
 * 所以他们最终把名单改成**派生**的：任何出现抓取原语的 mode 都被要求带标记，
 * 让新增调用点**默认失败**，而不是默认通过。
 *
 * 这里用同一招：扫描 src/ 下所有源码，凡是调用 `streamChat(` 的地方，
 * 其 user 载荷必须走 `wrapUntrusted(` 或 `build*UserMessage(`。
 * 新增调用点忘包装 → 本测试直接红，不需要任何人记得回来改测试。
 *
 * 写成 .mjs 而不是 .ts：本文件要用 node:fs/node:path，而 app 的 tsconfig
 * 只给了 DOM 类型（`"types": ["vite/client"]`）。仓库里 crawler/gateway 的
 * 契约测试也都是 .mjs，保持一致 —— 顺带获得「不参与 tsc 但参与 vitest」这一点。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(here, '..', '..')

/**
 * 允许不包装的调用点，每条必须写明理由。
 * 没有理由的例外清单只是换了个马甲的硬编码 —— 后来的人无从判断它是否还成立。
 */
const EXCLUSIONS = new Map([
  ['lib/ai.ts#0', 'streamChat 自身的定义处，不是调用点'],
])

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue
      sourceFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

/** 从 `(` 开始做括号配对，取出这次调用的完整实参文本（缩到 400 字防跨调用误判） */
function callText(source, openParen) {
  let depth = 0
  for (let i = openParen; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return source.slice(openParen, i + 1)
    }
  }
  return source.slice(openParen, Math.min(source.length, openParen + 400))
}

function findCallSites() {
  const sites = []
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8')
    const rel = path.relative(SRC, file).split(path.sep).join('/')
    let index = 0
    for (const m of source.matchAll(/\bstreamChat\s*\(/g)) {
      const before = source.slice(Math.max(0, m.index - 22), m.index)
      if (/function\s*$/.test(before)) continue
      const openParen = m.index + m[0].length - 1
      const text = callText(source, openParen)
      sites.push({
        file: rel,
        index,
        key: `${rel}#${index}`,
        text,
        guarded: /wrapUntrusted\(|build[A-Za-z]*UserMessage\(/.test(text),
      })
      index += 1
    }
  }
  return sites
}

const sites = findCallSites()

describe('模型调用点的外部文本隔离覆盖率（推导式）', () => {
  it('先钉住扫描本身：扫得到调用点，且扫得到那个历史漏网调用点', () => {
    // 扫描逻辑一旦失效（改目录、改调用写法），下面几条会变成假绿，所以先断言扫描是活的
    expect(sites.length, '一个 streamChat 调用点都没扫到，说明扫描逻辑坏了').toBeGreaterThanOrEqual(8)
    expect(sites.map((s) => s.file)).toContain('lib/import.ts')
    expect(sites.some((s) => s.text.includes('PARSE_JOBS_SYSTEM'))).toBe(true)
  })

  it('每个调用点的 user 载荷都走隔离包装（新增调用点忘包装会直接红）', () => {
    const unguarded = sites.filter((s) => !s.guarded && !EXCLUSIONS.has(s.key)).map((s) => s.key)
    expect(
      unguarded,
      `这些调用点把外部文本裸拼进了 prompt：${unguarded.join('、')}。` +
        '请改用 wrapUntrusted() 或 ai.ts 里的 build*UserMessage()。',
    ).toEqual([])
  })

  it('例外清单不许留尸体：写明的例外必须仍然存在', () => {
    const keys = new Set(sites.map((s) => s.key))
    const dead = Array.from(EXCLUSIONS.keys()).filter((k) => !keys.has(k))
    expect(dead, `这些例外已经不指向任何调用点了：${dead.join('、')}`).toEqual([])
  })

  it('包装函数本身确实产出边界（防止有人把它改成恒等函数后测试还绿）', () => {
    const untrusted = readFileSync(path.join(SRC, 'lib', 'untrusted.ts'), 'utf8')
    expect(untrusted).toContain('UNTRUSTED_OPEN')
    expect(untrusted).toContain('UNTRUSTED_CLOSE')
    expect(untrusted).toMatch(/split\(UNTRUSTED_(OPEN|CLOSE)\)/)
  })
})
