import { describe, expect, it } from 'vitest'

/**
 * 小程序端那道计费门的断言。
 *
 * 两端共用一条规则，但**可达通道不一样**，这件事必须写在代码与文案里：
 * - 网页端能浏览器直发（实测四家厂商带 ACAO），所以用户可以自备 Key 花自己的钱。
 * - 小程序端做不到：`wx.request` 的域名要在小程序后台逐个白名单，而厂商域名不归我们所有，
 *   也过不了审核。所以这一端**只有「创建者试用」一条路**，默认关闭。
 *
 * 于是这里钉三件事：
 * 1. 默认关闭：没读到开关、存储坏掉、抛异常，一律按关处理（宁可 AI 不能用）。
 * 2. 判定的形状与网页端**逐字一致**——同一个仓库里「谁能用 AI」写两遍，迟早一处严一处松。
 *    所以有一条跨端契约测试，把两端的 `decideAccess` 摆在同一张真值表上比。
 * 3. 拒绝时给的那句话必须说清是"这一端没有自备 Key 这条路"，
 *    而不是让用户在小程序里找一个根本不存在的输入框。
 */

const { decideAccess, currentAccess, createMiniStorage, TRIAL_KEY } = require('../utils/billing')

function memStorage(initial) {
  const mem = new Map(Object.entries(initial || {}))
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
    raw: mem,
  }
}

describe('小程序端的判定（默认拒绝）', () => {
  it('什么都没开 → 拒绝，paidBy 不是 creator，也不许提"填 Key"', () => {
    const a = decideAccess({ ownerTrial: false, byoAvailableHere: false })
    expect(a.allowed).toBe(false)
    expect(a.paidBy).not.toBe('creator')
    expect(a.reason).toMatch(/试用|创建者/)
    expect(a.reason).not.toMatch(/粘贴|输入框/)
  })

  it('这一端没有自备 Key 这条路：就算别处配了也不放行（诚实的边界）', () => {
    const a = decideAccess({ ownerTrial: false, byoAvailableHere: false, hasUserKeyAnywhere: true })
    expect(a.allowed).toBe(false)
    expect(a.reason).toMatch(/小程序.*(直发|自备|没有.*路)|域名/)
  })

  it('只有创建者显式开了试用才放行，并且明说是创建者付', () => {
    const a = decideAccess({ ownerTrial: true, byoAvailableHere: false })
    expect(a.allowed).toBe(true)
    expect(a.paidBy).toBe('creator')
    expect(a.access).toBe('owner-trial')
  })
})

describe('开关的读法：坏掉就当关', () => {
  it('没设置过 = 关', () => {
    const s = memStorage()
    expect(currentAccess(s).allowed).toBe(false)
  })

  it('显式开了才放行，值是写在设备存储里的字符串', () => {
    const s = memStorage()
    s.setItem(TRIAL_KEY, '1')
    expect(currentAccess(s).allowed).toBe(true)
    expect(currentAccess(s).paidBy).toBe('creator')
  })

  it('存储抛异常 → 按关处理，不炸也不猜（宁可不能用，不可悄悄花钱）', () => {
    const broken = {
      getItem() {
        throw new Error('storage unavailable')
      },
      setItem() {
        throw new Error('storage unavailable')
      },
    }
    expect(currentAccess(broken).allowed).toBe(false)
  })

  it('值是 "0" 或别的什么都算关（只有显式 "1" 开门）', () => {
    for (const v of ['0', 'true', '', '  ']) {
      expect(currentAccess(memStorage({ [TRIAL_KEY]: v })).allowed).toBe(false)
    }
    expect(currentAccess(memStorage({ [TRIAL_KEY]: '1' })).allowed).toBe(true)
  })

  it('createMiniStorage 在没有 wx 的运行时就是一份内存存储，而不是抛错', () => {
    const s = createMiniStorage(undefined)
    s.setItem('k', 'v')
    expect(s.getItem('k')).toBe('v')
  })
})

describe('跨端契约：同一条规则不许两端各写一遍', () => {
  const truthTable = [
    // [ownerTrial, 这一端有没有自备 Key 通路, 别处配了 Key 吗]
    [false, false, false],
    [false, false, true],
    [true, false, false],
    [true, false, true],
  ]

  it('小程序端与网页端在同输入下给出同样的 allowed / access / paidBy', async () => {
    const web = await import('../../src/lib/billing')
    for (const [ownerTrial, byoAvailableHere, hasUserKeyAnywhere] of truthTable) {
      const mini = decideAccess({ ownerTrial, byoAvailableHere, hasUserKeyAnywhere })
      // 网页端那份：小程序没有自备通路 ⇒ byoConfigured 必为 false，只剩试用档与拒绝
      const web_ = web.decideAccess({ byoConfigured: false, byoSendable: false, ownerTrial })
      expect(
        { mini: [mini.allowed, mini.access, mini.paidBy], web: [web_.allowed, web_.access, web_.paidBy] },
        `ownerTrial=${ownerTrial} 时两端结论不同`,
      ).toEqual({ mini: [mini.allowed, mini.access, mini.paidBy], web: [web_.allowed, web_.access, web_.paidBy] })
    }
  })

  it('两端拒绝时都写成"不是创建者付"（这句话本身就是承诺）', async () => {
    const web = await import('../../src/lib/billing')
    expect(decideAccess({ ownerTrial: false, byoAvailableHere: false }).paidBy).toBe('nobody')
    expect(web.decideAccess({ byoConfigured: false, byoSendable: false, ownerTrial: false }).paidBy).toBe('nobody')
  })
})
