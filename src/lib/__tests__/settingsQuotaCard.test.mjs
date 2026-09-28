import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 「AI 模型」这张卡的三个不变量，源码级钉住。
 *
 * 起因：这张卡原先无条件渲染，可它配的那道开关（「用本应用的额度试用」）只在
 * 创建者本人登录时才出现。`OWNER_EMAIL` 留空时谁都看不到那道开关，这张卡却照样
 * 摆着一整套可点可存的控件，配的是一个打不开的档；而「AI 通道」卡底部正明说
 * 「还没有这一档可用」。同一屏上自相矛盾。
 *
 * 三条最容易退回：
 *  1. 门控被去掉或挪走，那张卡又对所有人可见 —— 界面照样能跑，问题悄悄回来；
 *  2. 与「AI 通道」卡重复的两句话被后续改动抄回去 —— 重复感正是这次要修的东西；
 *  3. 会话消耗统计被一起挪进被门控的卡里 —— 它统计的不只是额度档，藏起来就看不到了。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const src = (rel) => readFileSync(path.resolve(here, '..', '..', rel), 'utf8')

describe('「AI 模型」卡只在额度档真的可用时才出现', () => {
  it('门控紧贴在这张卡上方，而不是更早那张卡里留下的判定', () => {
    const settings = src('pages/Settings.tsx')
    const at = settings.indexOf('<h3>AI 模型</h3>')
    expect(at, '找不到「AI 模型」这张卡').toBeGreaterThan(-1)

    const before = settings.slice(0, at)
    const gate = before.lastIndexOf('{isOwner ? (')
    const lastSectionEnd = before.lastIndexOf('</section>')
    // 「AI 通道」卡里也有一处 isOwner 判定（那道开关），但它在自己的 section 之内。
    // 只有位置晚于最后一个 </section>，才说明这道门控罩住的是下面这张卡。
    expect(gate, '「AI 模型」卡没有 isOwner 门控').toBeGreaterThan(-1)
    expect(gate, '门控被挪走了（那是更早那张卡的判定）').toBeGreaterThan(lastSectionEnd)
  })

  it('条件表达式有收尾，不能把后面几张卡一起吃掉', () => {
    const after = src('pages/Settings.tsx').slice(src('pages/Settings.tsx').indexOf('<h3>AI 模型</h3>'))
    expect(after).toMatch(/\n\s*\) : null\}/)
  })

  it('看不到这张卡的人，不白拉一次模型目录', () => {
    const settings = src('pages/Settings.tsx')
    const i = settings.indexOf('listUsableModels()')
    expect(i, '模型目录调用被删了').toBeGreaterThan(-1)
    expect(settings.slice(Math.max(0, i - 400), i), '模型目录又在无条件拉取').toMatch(/if \(!isOwner\) return/)
  })
})

describe('两张卡不再互指位置，也不再说两遍同一件事', () => {
  it('不靠方位词互相指认（卡片换个位置就错）', () => {
    const settings = src('pages/Settings.tsx')
    expect(settings, '还在用「上面那张卡」指代').not.toMatch(/上面那张卡/)
    expect(settings, '还在用「下面这个」指代').not.toMatch(/下面这个「本应用的额度」/)
  })

  it('额度档卡不再重复「账单记在创建者账号上」与「不是默认通道」', () => {
    const settings = src('pages/Settings.tsx')
    expect(settings, '付费方说明又被抄了一份').not.toMatch(/账单记在应用创建者账号上/)
    expect(settings, '「不是默认通道」又被抄了一份').not.toMatch(/不是默认通道/)
  })

  it('但「AI 通道」卡里那份唯一的付费方说明还在（别两处一起删）', () => {
    const settings = src('pages/Settings.tsx')
    expect(settings, '付费方说明被删干净了').toMatch(/「用本应用的额度」那一档记在/)
    expect(settings, '「不会替使用者垫钱」这句承诺没了').toMatch(/不会替使用者垫钱/)
  })
})

describe('会话消耗统计对所有人可见（它统计的不只是额度档）', () => {
  it('这段统计留在「AI 通道」卡里，而不是跑进被门控的额度档卡', () => {
    const settings = src('pages/Settings.tsx')
    const at = settings.indexOf('本次会话（当前标签页，关闭即归零）')
    expect(at, '会话统计被删掉了').toBeGreaterThan(-1)
    expect(at, '会话统计跑进了被门控的额度档卡里').toBeLessThan(settings.indexOf('<h3>AI 模型</h3>'))
    expect(at, '会话统计不在「AI 通道」卡里').toBeGreaterThan(settings.indexOf('<h3>AI 通道</h3>'))
  })
})
