import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { BYO_PRESETS } from '../aiChannels'

/**
 * 模型名必须**能选**，不能只能手打。
 *
 * 起因（发起人 2026-09-28 指出的界面问题）：设置页「AI 通道」卡里，厂商是点选的，
 * 模型名却只有一个空输入框 —— 想知道 DeepSeek 有哪些模型，得自己离开这个页面去厂商文档里抄。
 * 而名单本来就在代码里：`aiChannels.ts` 那个 `models` 字段的注释写的就是「（前端下拉用…）」，
 * 只是界面从来没实现过它，只把名单拼进了提示文字里。**数据早就有了，缺的只是给人点的地方。**
 *
 * 三条最容易退回：
 *  1. 候选又被写回提示文字（看起来"也告诉用户名单了"，但用户还是得先选中再复制粘贴）；
 *  2. 候选改成 <select> 只读下拉 —— 那不是改进是倒退：新模型、预览版、自建别名、
 *     OpenRouter 那种 `vendor/model` 的组合名都不可能在名单里穷举，
 *     而模型名不影响请求发给谁（只有主机影响，见 aiChannels.ts 文件头第 1 条），手填是安全的；
 *  3. 只填草稿不落库 —— 点一下看着变了，刷新就没了，等于没选。
 *
 * 两条踩过的坑写在这里，免得下次照着抄：
 * `Settings.tsx` 是 **CRLF**（`\n  }\n` 这种收尾正则一条也匹配不上），所以要先把换行归一；
 * 这个文件里**本来就有**别的 `<select>`（额度档那张卡的模型目录），所以「不许是下拉」
 * 只能断言在「模型名」这一段里，扫全文件会把合法的那个一起判红。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const settingsSrc = readFileSync(path.resolve(here, '..', '..', 'pages', 'Settings.tsx'), 'utf8').replace(/\r\n/g, '\n')

/** 「模型名」这一个 Field 的 JSX（不含收尾标签），后面所有界面断言都只在这个范围内看 */
function modelField() {
  const at = settingsSrc.indexOf('label="模型名"')
  expect(at, '找不到「模型名」这个字段').toBeGreaterThan(-1)
  const end = settingsSrc.indexOf('</Field>', at)
  expect(end, '「模型名」字段没有收尾').toBeGreaterThan(at)
  return settingsSrc.slice(at, end)
}

/** 一个函数的源码片段：从 `function 名(` 到该函数顶层收尾 */
function fnBody(name) {
  const at = settingsSrc.indexOf(`  function ${name}(`)
  expect(at, `找不到 ${name}()`).toBeGreaterThan(-1)
  const end = settingsSrc.indexOf('\n  }\n', at)
  expect(end, `${name}() 没有收尾`).toBeGreaterThan(at)
  return settingsSrc.slice(at, end)
}

describe('模型名是选出来的，不是打出来的', () => {
  it('每个厂商的候选都渲染成可点按钮', () => {
    const field = modelField()
    const at = field.indexOf('{channel.models.map((m) => (')
    expect(at, '模型候选没有渲染在「模型名」字段里（名单又被留在提示文字里了）').toBeGreaterThan(-1)
    const block = field.slice(at, at + 400)
    expect(block, '候选渲染出来了但点了没反应').toMatch(/onClick=\{\(\) => pickByoModel\(m\)\}/)
    expect(block, '候选没做成按钮').toMatch(/<button/)
  })

  it('点一下即生效：落库 + 改写草稿，两件都必须做', () => {
    const body = fnBody('pickByoModel')
    expect(body, '点候选没落库 —— 刷新就丢，等于没选').toMatch(/setByoModel\(channel\.id, m\)/)
    // 这条是「界面自相矛盾」的守卫：modelInUse 是草稿优先的，
    // 只落库不写草稿时，输入框里那条旧文字会盖住刚选中的值。
    expect(body, '点候选没改写草稿 —— 输入框会盖住刚选的模型').toMatch(/setModelDraft\(m\)/)
  })

  it('每个厂商都有可点的候选（空名单等于这一档没得选）', () => {
    const bad = BYO_PRESETS.filter((p) => !Array.isArray(p.models) || p.models.length === 0).map((p) => p.id)
    expect(bad, `这些厂商一个候选模型都没有，界面上没有可点项：${bad.join('、')}`).toEqual([])
    for (const p of BYO_PRESETS) {
      for (const m of p.models) {
        expect(m, `${p.id} 的候选里有一个带空白/空串的名字`).toBe(m.trim())
        expect(m.length, `${p.id} 的候选里有一个空串`).toBeGreaterThan(0)
      }
      expect(new Set(p.models).size, `${p.id} 的候选有重复`).toBe(p.models.length)
    }
  })
})

describe('手填这条路不能被候选挤掉', () => {
  it('没有和平台档那个 pickModel 重名（重名会静默遮蔽它，只有类型检查看得见）', () => {
    // 这个坑是我自己踩的：第一版把新函数也叫 pickModel，而 `pickModel` 是从 `../lib/ai`
    // import 进来的（平台额度档选模型，`Promise<string | null>`）。局部同名声明把它整个遮蔽，
    // 于是第 130/321 行的调用点变成了「传 0 个参给一个必填 1 个参的函数」，
    // 而这 7 条源码级断言**一条都没红** —— 是 `npm run typecheck` 抓到的。
    // 所以这条断言守的不是重名本身，是「源码级断言看不见的那类错」。
    const decls = settingsSrc.match(/function pickModel\(/g) ?? []
    expect(decls.length, '有两处同名的 pickModel —— 局部那个会遮蔽 import 进来的那个').toBe(0)
    expect(settingsSrc, 'BYO 那一档的选择函数改回了会遮蔽 import 的名字').toMatch(/function pickByoModel\(/)
    expect(settingsSrc, 'import 里的 pickModel 被删了（平台档靠它选模型）').toMatch(/import \{[^}]*\bpickModel\b[^}]*\} from '\.\.\/lib\/ai'/)
  })

  it('输入框还在「模型名」字段里，且仍然绑着草稿', () => {
    expect(modelField(), '模型名输入框被删了（候选只是"常见"，不是"允许"）').toMatch(
      /value=\{modelDraft\} onChange=\{\(e\) => setModelDraft\(e\.target\.value\)\}/,
    )
  })

  it('模型名没有做成只读下拉：名单里没有的模型必须还能用', () => {
    expect(modelField(), '模型名被改成了 <select> 只读下拉 —— 表外的模型就填不进去了').not.toMatch(/<select/)
  })

  it('候选名单不再同时以文字形式抄一遍（同一件事说两处，改一处必错一处）', () => {
    expect(settingsSrc, '提示文字里又把候选名单拼了一遍').not.toMatch(/channel\.models\.join\(/)
  })
})

describe('「现在用的是哪个」只有一个来源', () => {
  it('高亮与「当前会用」共用 modelInUse，且它是草稿优先', () => {
    expect(settingsSrc, 'modelInUse 的定义变了或没了').toMatch(
      /const modelInUse = modelDraft\.trim\(\) \|\| getByoModel\(channel\)/,
    )
    expect(modelField(), '候选没按 modelInUse 高亮').toMatch(/className=\{modelInUse === m \? 'chip on' : 'chip'\}/)
    expect(settingsSrc, '「当前会用」又自己算了一遍（两处各算一遍迟早说不到一起）').toMatch(/当前会用：\{modelInUse\}/)
  })
})
