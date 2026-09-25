/**
 * 契约测试：填写包导出的字段，浏览器扩展必须都能填。
 *
 * 为什么必须有这组测试：填写包页面和扩展是两份独立实现，它们之间只有一个接口 ——
 * `applykit.json`（键名就是字段标签）。这个接口错位的症状是**静默的**：
 * 导出成功、填充也提示完成，但某几个字段页面上压根没被填上，用户看到的是空格子，
 * 不会报错，也不知道少了什么。真实踩过：`性别` 与 `技能关键词` 在页面里导出了，
 * 扩展里却没有对应匹配规则，于是永远填不进去。
 *
 * 检查两个方向：
 * - 正向：清单里每个 fillable 字段，扩展都得有一条规则（漏了就填不上）
 * - 反向：扩展的规则不能对着清单里不存在的键（改名后留下的孤儿规则）
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { APPLY_KIT_FIELDS, APPLY_KIT_HINTS } from '../../src/lib/constants.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const contentSource = readFileSync(path.join(here, '..', 'content.js'), 'utf8')

/**
 * 抽出 FIELD_RULES 数组字面量。用文本解析而不是 import：content.js 依赖 window/document，
 * 在 node 里跑不起来，而这里要校验的本来就是"源码里写了什么"。
 * 块边界取到独占一行的 `]`，不能取"第一个 ]"—— rules 内部每个 key/patterns/ignore
 * 都是数组，取第一个会把整块截断，症状是最后一条规则永远被判成缺失。
 */
function rulesBlock(source = contentSource) {
  const start = source.indexOf('const FIELD_RULES')
  const end = source.indexOf('\n]', start)
  return source.slice(start, end)
}

export function ruleEntries(source = contentSource) {
  const body = rulesBlock(source)
  const out = []
  for (const m of body.matchAll(/\{\s*key:\s*\[([^\]]*)\],\s*patterns:\s*\[([^\]]*)\],\s*ignore:\s*\[([^\]]*)\]/g)) {
    const list = (s) =>
      s
        .split(',')
        .map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    out.push({ keys: list(m[1]), patterns: list(m[2]), ignore: list(m[3]) })
  }
  return out
}

const entries = ruleEntries()
const keys = entries.flatMap((e) => e.keys)
const canonicalKeys = entries.map((e) => e.keys[0])
const fillable = APPLY_KIT_FIELDS.filter((f) => f.fillable).map((f) => f.label)
const allLabels = APPLY_KIT_FIELDS.map((f) => f.label)

describe('填写包 ↔ 扩展 字段契约', () => {
  it('能解析出规则（解析失败会让下面几条变成假绿，所以先钉住）', () => {
    expect(entries.length).toBeGreaterThanOrEqual(17)
    expect(keys).toContain('姓名')
    expect(keys).toContain('项目经历')
  })

  it('清单里每个可填字段，扩展都有匹配规则', () => {
    const missing = fillable.filter((label) => !keys.includes(label))
    expect(missing, `这些字段导出了却填不进去：${missing.join('、')}`).toEqual([])
  })

  it('每条规则的首个键必须是清单里的字段（别名可以额外有，但主键不能对着已改名的旧值）', () => {
    const orphans = canonicalKeys.filter((k) => !allLabels.includes(k))
    expect(orphans, `这些规则的主键已不在清单里：${orphans.join('、')}`).toEqual([])
  })

  it('规则条数与可填字段数一致：杜绝"字段删了、规则还在"的另一半情形', () => {
    // 上一条保证每条规则的主键都在清单里，这一条保证清单里没有字段被漏掉或重复建规则。
    // 两条合起来是双射——不再额外维护"别名白名单"，那种测试只会变成维护负担：
    // `真实姓名`/`手机号` 这类中文别名天然不在标签清单里，靠字符串无法与"改名后的旧标签"区分。
    expect(entries.length).toBe(fillable.length)
    expect(new Set(canonicalKeys).size).toBe(canonicalKeys.length)
  })

  it('只提示不填充的字段必须显式标成 fillable:false，且不给它写规则', () => {
    const notFillable = APPLY_KIT_FIELDS.filter((f) => !f.fillable).map((f) => f.label)
    expect(notFillable).toContain('简历文件名')
    for (const label of notFillable) {
      expect(keys, `${label} 标了不可填充，扩展里不该有它的规则`).not.toContain(label)
    }
  })

  it('清单里字段标签不重复（重复会让导出的 JSON 后一个覆盖前一个）', () => {
    expect(new Set(allLabels).size).toBe(allLabels.length)
  })

  it('每个可填字段的匹配规则都不为空，且忽略词不与匹配词自相矛盾', () => {
    for (const e of entries) {
      const label = e.keys[0]
      expect(e.patterns.length, `${label} 没有匹配词`).toBeGreaterThan(0)
      // 同一个词既是匹配词又是忽略词 = 这条规则永远不会命中，属于写错了
      const conflict = e.patterns.filter((p) => e.ignore.includes(p))
      expect(conflict, `${label} 的匹配词与忽略词冲突：${conflict.join('、')}`).toEqual([])
    }
  })

  it('提示文案只挂在本清单里存在的字段上', () => {
    for (const label of Object.keys(APPLY_KIT_HINTS)) {
      expect(allLabels).toContain(label)
    }
  })
})
