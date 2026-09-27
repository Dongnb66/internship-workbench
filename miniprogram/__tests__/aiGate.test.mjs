import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 小程序那道门真的挂在唯一的调用入口上（源码级检查）。
 *
 * 为什么是扫源码而不是 import：`miniprogram/utils/cloud.js` 在模块加载时就要读全局 `wx`
 * （`createMiniProgramWorkBuddyCloud({ wx: ... })`），node 里没有那个运行时，import 直接炸。
 * 而这里要钉的恰好是"门挂在哪儿"这件事——判定本身已由 `billing.test.mjs` 从行为上测过。
 *
 * 三件事缺一不可：问了门、被拒时**真的抛**、抛在**挑模型之前**
 * （`models.list()` 也是一次云端请求，被挡住时连它都不该发）。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const aiSource = readFileSync(path.join(here, '..', 'utils', 'ai.js'), 'utf8')

describe('小程序 streamChat 上的计费门', () => {
  it('扫到了内容，并且找得到唯一的模型入口', () => {
    expect(aiSource.length).toBeGreaterThan(500)
    expect(aiSource).toMatch(/async function streamChat/)
    expect((aiSource.match(/cloud\.llm\.chat\.completions\.create\(/g) || []).length).toBe(1)
  })

  it('问了门，被拒时真的抛出去（查了不抛等于没门）', () => {
    expect(aiSource, 'streamChat 没问 currentAccess：这一端又能白烧创建者额度了').toMatch(/currentAccess\(/)
    expect(aiSource, '查了状态却没拦住请求').toMatch(/if\s*\(!access\.allowed\)\s*throw/)
  })

  it('门在挑模型之前：被挡住时连目录请求都不该发出去', () => {
    const atGate = aiSource.search(/currentAccess\(/)
    const atPick = aiSource.search(/await pickModel\(\)/)
    const atCreate = aiSource.search(/cloud\.llm\.chat\.completions\.create\(/)
    expect(atGate).toBeGreaterThanOrEqual(0)
    expect(atGate, '门挂在 pickModel 之后：白跑一次目录请求').toBeLessThan(atPick)
    expect(atGate).toBeLessThan(atCreate)
  })

  it('这一端不许出现"用户自己填 Key"的假承诺（没有那条通路）', () => {
    // 网页端那套 byoConfigured 搬过来就是说谎：小程序没有浏览器直发那条路
    expect(aiSource).not.toMatch(/streamByoChat|readUserKey|byoSend/)
  })

  it('抛出去的就是门给的那句话（页面直接把 errText(error) 显示给用户）', () => {
    expect(aiSource).toMatch(/throw new Error\(\s*access\.reason\s*\)/)
  })
})
