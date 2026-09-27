/**
 * 模型调用点的「额度归属」覆盖率 —— **从源码推导，不维护手写清单**。
 *
 * 与 aiPromptCoverage.test.mjs 同一招、同一个理由：护栏接在 streamChat 里之后，
 * 每次调用必须带上**任务名**，否则 quota.ts 的每任务熔断（maxCallsPerTask）就没有
 * 分组依据，agent 循环失控时没人知道是哪件事在转圈。
 *
 * 如果只靠手写清单，将来新增一个调用点（或把某处改成新函数）时清单不会报警——
 * 本项目真实踩过这个坑（手写清单漏了第 8 个调用点）。所以这里同样是
 * 「凡出现某特征就必须带某标记」，让**新增点默认失败**。
 *
 * 写成 .mjs：要用 node:fs/node:path，而 app 的 tsconfig 只给 DOM 类型。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(here, '..', '..')

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

/** 从 `(` 起做括号配对，取这次调用的完整实参文本 */
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
      // 定义处（export async function streamChat(...)）不是调用点
      if (/function\s*$/.test(before)) continue
      const openParen = m.index + m[0].length - 1
      const text = callText(source, openParen)
      sites.push({ file: rel, key: `${rel}#${index}`, text, labelled: /\btask\s*:/.test(text) })
      index += 1
    }
  }
  return sites
}

const sites = findCallSites()

describe('模型调用点的额度归属标记覆盖率（推导式）', () => {
  it('先钉住扫描本身：扫得到调用点，且扫得到已知的那几个文件', () => {
    expect(sites.length, '一个 streamChat 调用点都没扫到，说明扫描逻辑坏了').toBeGreaterThanOrEqual(8)
    expect(sites.map((s) => s.file)).toContain('lib/import.ts')
    expect(sites.map((s) => s.file)).toContain('lib/ai.ts')
  })

  it('每个调用点都带 task 标签（新增调用点漏标会直接红）', () => {
    const missing = sites.filter((s) => !s.labelled).map((s) => s.key)
    expect(
      missing,
      `这些调用点没有 task 标签，额度没法归到任务上：${missing.join('、')}。` +
        '请传 task: 「JD 评估」这类用户能看懂的任务名。',
    ).toEqual([])
  })

  it('任务名必须是非空中文/字面量，不能是空串或变量兜底成空', () => {
    const empty = sites
      .filter((s) => /task\s*:\s*(''|"")/.test(s.text))
      .map((s) => s.key)
    expect(empty, `这些调用点的 task 是空串：${empty.join('、')}`).toEqual([])
  })

  it('页面问额度时必须用同一个标签来源（自己拼一遍就会问错桶）', () => {
    // 护栏按「任务名」计数：页面预检用的标签和 streamChat 记账用的标签
    // 只要是各拼一次，迟早对不上——症状是「明明提示还能用，一调就被熔断」。
    const pagesDir = path.join(SRC, 'pages')
    const offenders = []
    for (const name of readdirSync(pagesDir)) {
      if (!name.endsWith('.tsx')) continue
      const source = readFileSync(path.join(pagesDir, name), 'utf8')
      for (const m of source.matchAll(/getQuotaSnapshot\s*\(/g)) {
        const openParen = m.index + m[0].length - 1
        const text = callText(source, openParen)
        // 两种写法合法：不带参数 = 问整体剩余额度（设置页那种汇总视图）；
        // 带参数则必须用共享标签来源，否则预检查的那一桶和记账的那一桶不是同一个
        if (/^\(\s*\)/.test(text)) continue
        if (!/DAILY_TASK_LABEL|decisionLabel\(/.test(text)) offenders.push(`${name}：${text.slice(0, 60)}`)
      }
    }
    expect(offenders, `这些页面自己拼了额度标签：${offenders.join('　')}`).toEqual([])
  })

  it('智能体循环的调用点必须走便宜档（§3.4：一圈一次调用，默认档是思考型）', () => {
    // 循环是唯一「一件事打多次模型」的调用方，所以它每次调用都该带 cheap: true。
    // 这条检查是推导式的：将来新增一个循环场景（投递决策之外的），漏标就红。
    const runFile = path.join(SRC, 'lib', 'agentRun.ts')
    const source = readFileSync(runFile, 'utf8')
    const missing = []
    let index = 0
    for (const m of source.matchAll(/\bstreamChat\s*\(/g)) {
      const openParen = m.index + m[0].length - 1
      const text = callText(source, openParen)
      if (!/cheap:\s*true/.test(text)) missing.push(`agentRun.ts#${index}`)
      index += 1
    }
    expect(index, 'agentRun.ts 里没扫到 streamChat 调用点，说明接线被改掉了').toBeGreaterThan(0)
    expect(missing, `这些循环调用点没走便宜档：${missing.join('、')}`).toEqual([])
  })

  it('streamChat 自己内部真的查了额度闸（否则调用点标了名也没人挡）', () => {
    const ai = readFileSync(path.join(SRC, 'lib', 'ai.ts'), 'utf8')
    // 三件事缺一不可：拿到 store、问额度、被拒时**抛错**、花过就记账
    expect(ai).toMatch(/createQuotaStore\(/)
    expect(ai).toMatch(/\.status\(/)
    expect(ai, '额度不足时必须抛出，不能查了却照发').toMatch(/if \(!gate\.allowed\) throw/)
    expect(ai).toMatch(/store\.record\(/)
  })
})
