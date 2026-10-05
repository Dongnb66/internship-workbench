#!/usr/bin/env node

/**
 * README 的 `tests-N passed` 徽章 —— **由测试结果派生，不许手写**。
 *
 * ## 为什么要有这个脚本
 *
 * 2026-10-05 实测：README 徽章写的是 `779 passed`，而 `npm test` 实际跑出 **900** 条
 * （新增本仓第一条源码派生守卫后为 904）。**差了 121 条，而且没有任何东西会报警** ——
 * 因为它是一个纯手写的字面量，写在 README 里，没有任何断言盯着它。
 *
 * 这个问题比"数字不准"更严重的地方在于：徽章上的测试数是**对外声称**，
 * 会被写进简历、作品集、答辩稿。一个能被面试官一条命令打穿的数字，比一个小的真数字危险得多。
 *
 * ## 做法（对标 archify 的生成物纪律）
 *
 * 权威源是**跑出来的结果**，不是任何文档：
 *   vitest --reporter=json --outputFile=.test-report.json  →  numTotalTests
 * 然后本脚本负责「写」或「校验」：
 *
 *   npm run test:badge         # 先真跑测试，再把徽章改成真实数字（--write）
 *   npm run test:badge:check   # 先真跑测试，再校验徽章是否过期；过期退出 1（CI 用）
 *
 * 与 archify 的 `generate-*` + `--check` 同构：**生成物过期 = 失败**，
 * 而不是"下次想起来再改"。区别只是它的生成物是一个 .mjs 文件，我们的是一个徽章数字。
 *
 * ## 边界
 *
 * - 只改徽章里的**数字**，不动颜色与链接；找不到徽章就**退出 2**（不静默什么都不做——
 *   静默 no-op 是这类脚本最经典的坏法：看着绿，其实一个字都没检查）。
 * - 测试有失败时不写徽章（不许把红灯的数字盖上去）。
 * - 只读报告，不自己起 vitest：谁跑测试谁负责产报告，脚本保持可单测。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))

/** 徽章承载在哪些文件里。目前只有 README；多语言 README 出现时在这里加一行即可。 */
const TARGETS = [{ file: 'README.md', label: '中文 README' }]

/** `https://img.shields.io/badge/tests-904%20passed-12a150.svg` */
const BADGE_RE = /tests-(\d+)%20passed/g

/**
 * 从 vitest 的 json 报告里取真实用例数。
 * @param {string} reportPath
 */
export function readTestCount(reportPath) {
  let raw
  try {
    raw = readFileSync(reportPath, 'utf-8')
  } catch (error) {
    const hint = `找不到测试报告 ${reportPath}（${error.code}）。先跑一次测试产出报告：\n` +
      '  npm run test:badge:check    # 会先跑测试，再校验徽章'
    throw new Error(hint)
  }
  const report = JSON.parse(raw)
  if (typeof report.numTotalTests !== 'number') {
    throw new Error(`报告里没有 numTotalTests 字段 —— vitest 的 json reporter 输出形态变了，先修这个脚本`)
  }
  if (report.numFailedTests > 0) {
    throw new Error(`本次测试有 ${report.numFailedTests} 条失败，拒绝把红灯的数字写进徽章`)
  }
  return report.numTotalTests
}

/**
 * 算出每个目标文件的期望内容。找不到徽章即抛错（宁可红，不要静默跳过）。
 * @returns {{file: string, label: string, before: string, after: string, found: number}[]}
 */
export function planRewrites(count) {
  return TARGETS.map(({ file, label }) => {
    const path = join(repoRoot, file)
    let text
    try {
      text = readFileSync(path, 'utf-8')
    } catch (error) {
      throw new Error(`读不到 ${file}（${error.code}）`)
    }
    const found = (text.match(BADGE_RE) || []).length
    if (found === 0) {
      throw new Error(
        `${file} 里找不到 tests 徽章（期望形如 tests-<数字>%20passed）。` +
        '要么徽章被删了、要么格式变了 —— 这个脚本的职责就是盯住它，所以这里必须失败而不是跳过。',
      )
    }
    return { file, label, before: text, after: text.replace(BADGE_RE, `tests-${count}%20passed`), found }
  })
}

function currentCountIn(text) {
  const m = text.match(/tests-(\d+)%20passed/)
  return m ? Number(m[1]) : null
}

export function run({ mode, reportPath }) {
  const actual = readTestCount(reportPath)
  const plans = planRewrites(actual)
  let stale = 0

  for (const plan of plans) {
    const declared = currentCountIn(plan.before)
    const fresh = declared === actual
    if (fresh) {
      console.log(`ok    ${plan.label}：tests 徽章 = ${actual}，与实测一致`)
      continue
    }
    stale += 1
    if (mode === 'write') {
      writeFileSync(join(repoRoot, plan.file), plan.after)
      console.log(`改写  ${plan.label}：${declared} → ${actual}`)
    } else {
      console.error(`FAIL  ${plan.label}：徽章写的是 ${declared}，实测是 ${actual}（差 ${Math.abs(actual - declared)} 条）`)
    }
  }

  if (stale > 0 && mode === 'check') {
    console.error(
      `\n${stale} 个文件的 tests 徽章已过期。这是手写数字必然的结果 —— 修复只需一条命令：\n` +
      '  npm run test:badge\n' +
      '（它会先真跑测试，再把徽章改成真实数字；不要手工改，手工改就是这次漂移 121 条的起因）',
    )
    return 1
  }
  return 0
}

// Windows 上 process.argv[1] 是 `C:\...`，手拼 `file://${argv[1]}` 会少一道斜杠从而静默不执行。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const mode = args.includes('--write') ? 'write' : 'check'
  const reportArg = args.find((a) => a.startsWith('--report='))
  const reportPath = join(repoRoot, reportArg ? reportArg.slice('--report='.length) : '.test-report.json')
  try {
    process.exit(run({ mode, reportPath }))
  } catch (error) {
    console.error(`testBadge 失败：${error.message}`)
    process.exit(2)
  }
}
