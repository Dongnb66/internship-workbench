import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { BYO_SETUP_STEPS } from '../billing'

/**
 * 「AI 未接上」那条指引的两端都不许漂（源码级）。
 *
 * 口径是发起人定的：AI 只走使用者自备的 Key，不默认花创建者的钱。于是这句话必须真的
 * 出现在**新用户看得见的地方**，而不是只在点了 AI 按钮之后以抛错形式出现。
 * 两条最容易出事：
 *  1. 首屏提示被改掉 / 删掉 —— `billing.ts` 的逻辑照样全绿，用户却仍然只看得到一句拒绝；
 *  2. 界面改了名字（「AI 通道」卡、「自检一下」按钮、导航里那栏「目标条件」），
 *     而指引还写着旧名字 —— 那等于让人去找一个不存在的地方。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const src = (rel) => readFileSync(path.resolve(here, '..', '..', rel), 'utf8')

describe('AI 接上指引：首屏有、入口名对得上界面', () => {
  it('总览页在未配置时渲染这份指引，并给出去设置页的入口', () => {
    const overview = src('pages/Overview.tsx')
    expect(overview).toMatch(/currentAccess\(\)\.access === 'none'/)
    expect(overview).toMatch(/BYO_SETUP_STEPS/)
    expect(overview).toMatch(/go\('settings'\)/)
  })

  it('指引里点名的界面元素，界面上真的存在', () => {
    const settings = src('pages/Settings.tsx')
    const app = src('App.tsx')
    expect(settings).toMatch(/<h3>AI 通道<\/h3>/)
    expect(settings).toMatch(/自检一下/)
    expect(app).toMatch(/label: '目标条件'/)
    // 反向也要成立：指引确实引用了这些名字，不是各写一套
    const all = BYO_SETUP_STEPS.join(' ')
    expect(all).toMatch(/目标条件/)
    expect(all).toMatch(/AI 通道/)
    expect(all).toMatch(/自检一下/)
  })

  it('拒绝文案与首屏指引同源（改了步骤，文案必须跟着改）', () => {
    const billing = src('lib/billing.ts')
    expect(billing).toMatch(/BYO_SETUP_STEPS\.map\(/)
  })
})
