/**
 * 渠道能力边界矩阵的契约测试 —— constants.ts 里的 CHANNELS ↔ CHANNEL_CAPABILITIES ↔ UI 显示。
 *
 * 为什么要有这张表：docs/BENCHMARK.md 的 P0 缺口 —— 渠道目前只是个字符串标签，
 * 用户抓完 60 条岗位后无从知道「哪些环节工具替我做、哪些必须我自己动手」，
 * 最危险的误会是把「能采集」推断成「也能自动投递」。矩阵把四个环节（采集 / AI 处理 /
 * 投递 / 回填）写成常量并在岗位池页展示，投递一列恒为「人工」。
 *
 * 断言分四层，全部从源码推导，不维护手写清单：
 * 1. 钉住扫描本身 —— CHANNELS 解析不出来时，后面的断言全是假绿，所以先断言扫描是活的；
 * 2. 双射 —— CHANNELS 里每个渠道恰有一条能力行（新增渠道忘了写 → 红），
 *    矩阵里也不许有渠道清单之外的陈旧行（改名后忘删 → 红）；
 * 3. 投递列恒为「人工」—— 不自动投递是产品承诺（AGENTS.md §2.3），矩阵里出现
 *    「自动」字样直接红，且失败信息点名渠道；
 * 4. UI 消费 —— 矩阵必须是「有人在页面上渲染的常量」，不许变成下一份死代码
 *    （APPLY_KIT_FIELDS 当过整整一段时间的死代码，这里不再重演）。
 *
 * 写成 .mjs 而不是 .ts：要用 node:fs 读源码，app 的 tsconfig 只给 DOM 类型；
 * 与 crawler/gateway/extension 的契约测试及 aiPromptCoverage.test.mjs 一致。
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(here, '..', '..')

function read(rel) {
  return readFileSync(path.join(SRC, rel), 'utf8')
}

/** 从 `export const NAME … = [` 开始做括号配对，取出完整数组文本（跳过字符串字面量里的括号） */
function extractArrayBlock(source, name) {
  const declStart = source.search(new RegExp(`export const ${name}\\b`))
  if (declStart === -1) return null
  // 类型注解（如 `: ChannelCapability[]`）里也有方括号，所以从「=」之后找数组开头
  const eq = source.indexOf('=', declStart)
  if (eq === -1) return null
  const open = source.indexOf('[', eq)
  if (open === -1) return null
  let depth = 0
  let inString = false
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    if (inString) {
      if (ch === "'") inString = false
      continue
    }
    if (ch === "'") inString = true
    else if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  return null
}

/** 拆出对象数组里每个对象的指定字符串字段；字段缺失返回 null，让断言显式失败 */
function fieldOf(block, key) {
  const m = block.match(new RegExp(`\\b${key}:\\s*'([^']*)'`))
  return m ? m[1] : null
}

const constants = read(path.join('lib', 'constants.ts'))

// —— 先解析，后面的断言依赖这两个结果 ——
const channelsMatch = constants.match(/export const CHANNELS = \[([^\]]*)\]/)
const channels = channelsMatch ? [...channelsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : []
const matrixBlock = extractArrayBlock(constants, 'CHANNEL_CAPABILITIES')
const rows = matrixBlock
  ? [...matrixBlock.matchAll(/\{[^{}]*\}/g)].map((obj) => ({
      channel: fieldOf(obj[0], 'channel'),
      collect: fieldOf(obj[0], 'collect'),
      ai: fieldOf(obj[0], 'ai'),
      apply: fieldOf(obj[0], 'apply'),
      backfill: fieldOf(obj[0], 'backfill'),
    }))
  : []

describe('渠道能力边界矩阵（推导式契约）', () => {
  it('先钉住扫描本身：CHANNELS 能从 constants.ts 源码里解析出来', () => {
    // 扫描一失效，后面的双射断言就会变成假绿（空对空），所以先断言扫描是活的
    expect(channels.length, 'CHANNELS 没解析出来，说明本测试的提取逻辑坏了').toBeGreaterThanOrEqual(8)
    expect(channels).toContain('BOSS直聘')
  })

  it('矩阵存在且解析得出：constants.ts 里有 CHANNEL_CAPABILITIES，字段齐全', () => {
    expect(matrixBlock, 'constants.ts 里没有 CHANNEL_CAPABILITIES —— 渠道能力边界矩阵还没实现').not.toBeNull()
    expect(rows.length, 'CHANNEL_CAPABILITIES 里一个对象都没解析出来，检查书写格式').toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.channel, `有一行的 channel 不是字符串字面量：${JSON.stringify(row)}`).not.toBeNull()
    }
  })

  it('双射：CHANNELS 里每个渠道恰有一条能力行，矩阵里没有渠道之外的陈旧行', () => {
    const matrixChannels = rows.map((r) => r.channel)
    const missing = channels.filter((c) => !matrixChannels.includes(c))
    expect(
      missing,
      `这些渠道在 CHANNELS 里但没有能力行，岗位池页上会缺一行：${missing.join('、')}`,
    ).toEqual([])
    const stale = matrixChannels.filter((c) => !channels.includes(c))
    expect(
      stale,
      `CHANNEL_CAPABILITIES 里有这些行，但它们不在 CHANNELS 里（多半是渠道改名后留下的旧行）：${stale.join('、')}`,
    ).toEqual([])
    const dup = matrixChannels.filter((c, i) => matrixChannels.indexOf(c) !== i)
    expect(dup, `这些渠道有多条能力行，UI 会渲染重复行：${dup.join('、')}`).toEqual([])
  })

  it('投递一列恒为「人工」：任何渠道出现自动投递的写法直接红（产品承诺，不是暂未实现）', () => {
    const offenders = rows
      .filter((r) => r.channel !== null)
      .filter((r) => r.apply !== '人工')
      .map((r) => `${r.channel}(apply=${JSON.stringify(r.apply)})`)
    expect(
      offenders,
      `投递一列必须是字面量「人工」—— 本工作台不登录平台、不自动发送（AGENTS.md §2.3）。违规：${offenders.join('、')}`,
    ).toEqual([])
  })

  it('四项能力单元格全部非空：空白单元格等于把「要不要人工」这个问题糊弄过去', () => {
    const blanks = rows
      .flatMap((r) =>
        ['collect', 'ai', 'backfill'].map((k) => (r[k] ? null : `${r.channel ?? '?'}#${k}`)),
      )
      .filter(Boolean)
    expect(blanks, `这些单元格是空的：${blanks.join('、')}`).toEqual([])
  })

  it('矩阵被 UI 真实渲染：src/pages 下至少有一个页面消费它，不许是死代码', () => {
    const pages = readdirSync(path.join(SRC, 'pages')).filter((f) => f.endsWith('.tsx'))
    const consumers = pages.filter((f) => read(path.join('pages', f)).includes('CHANNEL_CAPABILITIES'))
    expect(
      consumers,
      '没有任何页面引用 CHANNEL_CAPABILITIES —— 矩阵定义了却不显示，等于没做这个 P0',
    ).not.toEqual([])
  })
})
