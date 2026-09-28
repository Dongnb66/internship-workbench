import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 用户可见的「失败原因」不许撒谎（源码级守卫）。
 *
 * 由来（2026-09-28 线上截图实测）：同一张卡片里同时出现两句话 ——
 *   停止原因：模型调用中断（多半是今天的 AI 额度用完了）
 *   行动清单：AI 功能需要自备模型 Key（…花你自己账户的余额）
 * 前者是假的。在「AI 只走使用者自备 Key」的口径下（见 billing.ts），使用者名下
 * **根本没有可用的应用额度**，所以那句话把一个不存在的可能性说成了默认原因。
 * 代价不只是措辞难看：它把人往"要充值 / 这产品收费"的方向推，而真实断点是"还没接上"。
 *
 * 三条约束，前两条负向、第三条正向：
 *   ① 停止原因标签不许把某一种可能写成默认原因（点名"额度用完"）；
 *   ② 空步骤标签不许读成"是用户没说清楚"；
 *   ③ 正向兜底 —— 必须指向一个用户真能动手的地方（自检 / AI 通道）。
 *      少了 ③，"整段删掉"也能让负向断言通过。
 *
 * 注意断言只检查**字符串字面量**，不检查注释：注释里要引用旧文案做对照，
 * 那是有意保留的历史，不该被自己的守卫拦下。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const src = (rel) => readFileSync(path.resolve(here, '..', '..', rel), 'utf8')

/** STOP_LABEL 那一整块（到第一个右花括号），避免误判文件别处的同名词 */
function stopLabelBlock() {
  const text = src('pages/Overview.tsx')
  const i = text.indexOf('const STOP_LABEL')
  expect(i, 'Overview.tsx 里找不到 STOP_LABEL —— 改名或搬走都要同步本断言').toBeGreaterThan(-1)
  return text.slice(i, text.indexOf('}', i) + 1)
}

/** 取某个停止原因对应的那一条文案（只取单引号里的字面量） */
function labelOf(key) {
  const m = stopLabelBlock().match(new RegExp(`${key}:\\s*'([^']*)'`))
  return m ? m[1] : ''
}

const ALL_REASONS = ['final_answer', 'max_steps', 'tool_retries_exhausted', 'model_error', 'aborted']

describe('失败原因文案：不许把一种可能说成默认原因', () => {
  it('STOP_LABEL 覆盖了全部停止原因（缺一个就会在界面上显示 undefined）', () => {
    for (const k of ALL_REASONS) {
      expect(labelOf(k), `STOP_LABEL 缺 ${k}`).not.toBe('')
    }
  })

  it('没有哪条停止原因把「额度用完」当成解释——使用者名下没有可用的应用额度', () => {
    for (const k of ALL_REASONS) {
      expect(labelOf(k), `${k} 又写成额度用完了`).not.toMatch(/额度用完|额度已用尽/)
    }
  })

  it('model_error 指向用户能动手的地方（自检 / AI 通道），而不是只描述故障', () => {
    const text = labelOf('model_error')
    expect(text, 'model_error 标签取不到').toBeTruthy()
    expect(text).toMatch(/自检|AI 通道/)
  })

  it('智能体空步骤的标签不许读成「用户的错」', () => {
    // 只看那行代码，不看注释 —— 文件里的注释有意保留了旧文案做对照，
    // 拿整份文件去 not.toMatch，守卫会被自己的注释绊倒（本次真踩过一次）。
    const line = src('components/AgentSteps.tsx').split('\n').find((l) => l.includes('s.tool ?')) || ''
    expect(line, '找不到那行三分支代码 —— 结构变了要同步本断言').not.toBe('')
    expect(line, '空步骤标签又在怪用户').not.toMatch(/没识别出指令/)
    // 正向：三分支结构仍在，别用"删掉分支"的方式让上面那条通过
    expect(line, '三分支被拆掉了').toMatch(/s\.thought \?/)
  })
})
