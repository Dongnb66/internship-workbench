import { describe, expect, it } from 'vitest'

/**
 * 注册口径的断言。
 *
 * **这一条被改过一次，改的原因是账算错了，值得留在文件里。**
 * 第一版（同一天早些时候）是「新邮箱一律要邀请码」，理由是"陌生人注册进来就能烧创建者的额度"。
 * 但自备 Key 与计费门落地之后那句话不成立了：AI 默认花使用者自己的钱，创建者那一档
 * 既默认关着、开关又只认创建者账号 —— 一个陌生人注册进来，他在 AI 上花这个站 0 元。
 * 邀请码买到的东西变了（只剩验证邮件额度、公共库脏数据、以及"每加一个用户我要亲自发一次码"），
 * 而最后那条正好砸在做这个产品的目的上。所以默认改成**开放注册**。
 *
 * 只有一个旋钮，不留两个会互相矛盾的开关：
 * `INVITE_CODES` 里**有真码 = 上锁**，只有占位符 = **开放**。
 * 想彻底不让人进，填一枚只有你自己知道的码即可（不需要额外模式位）。
 */
import {
  INVITE_CODES,
  PLACEHOLDER_CODE,
  codesAreConfigured,
  normalizeCode,
  registrationMode,
  signupGate,
} from '../registration'

/** 一份「已经配好码」的名单 = 上锁状态 */
const LOCKED = ['WB-2026-ab12', 'WB-2026-cd34']

describe('出厂状态：开放注册', () => {
  it('名单里只有占位符 → 模式是 open，新邮箱不需要码', () => {
    expect(INVITE_CODES).toEqual([PLACEHOLDER_CODE])
    expect(registrationMode()).toBe('open')
    const g = signupGate({ isExistingUser: false, code: '' })
    expect(g.allowed).toBe(true)
    // 放行且**明说这一步会创建账号**：不许悄悄建号，这条从第一版留着没动
    expect(g.createsAccount).toBe(true)
  })

  it('开放模式下提交的码一律不参与判定（半截的锁比没锁更误导人）', () => {
    expect(signupGate({ isExistingUser: false, code: '随便什么' }).allowed).toBe(true)
    expect(signupGate({ isExistingUser: false, code: PLACEHOLDER_CODE }).allowed).toBe(true)
  })
})

describe('老用户从来不该被门挡', () => {
  for (const list of [LOCKED, [PLACEHOLDER_CODE], []]) {
    it(`名单是 ${JSON.stringify(list)} 时，已存在的账号都能登录`, () => {
      const g = signupGate({ isExistingUser: true, code: '', list })
      expect(g.allowed).toBe(true)
      expect(g.createsAccount).toBe(false)
    })
  }
})

describe('填了真码 = 上锁（这就是"随时锁回去"那一行）', () => {
  it('有真码时模式变 invite，没码的新邮箱被拒', () => {
    expect(registrationMode(LOCKED)).toBe('invite')
    const g = signupGate({ isExistingUser: false, code: '', list: LOCKED })
    expect(g.allowed).toBe(false)
    expect(g.reason).toMatch(/邀请码/)
    expect(g.reason).toMatch(/创建者|要/)
  })

  it('锁上之后码按全等比：猜短码、加后缀、都不算通过', () => {
    expect(signupGate({ isExistingUser: false, code: LOCKED[0], list: LOCKED }).allowed).toBe(true)
    expect(signupGate({ isExistingUser: false, code: `  ${LOCKED[0].toLowerCase()}  `, list: LOCKED }).allowed).toBe(true)
    expect(signupGate({ isExistingUser: false, code: `${LOCKED[0]}EXTRA`, list: LOCKED }).allowed).toBe(false)
    expect(signupGate({ isExistingUser: false, code: LOCKED[0].slice(0, 6), list: LOCKED }).allowed).toBe(false)
    expect(signupGate({ isExistingUser: false, code: 'WB', list: LOCKED }).allowed).toBe(false)
  })

  it('占位符永远不算可用码（它写在源码里，公开可读）', () => {
    // 只有占位符 = 没上锁 = 开放（这是出厂状态，不是"码错了"）
    expect(registrationMode([PLACEHOLDER_CODE])).toBe('open')
    // 上锁之后拿占位符来当码，必须被拒 —— 这才是这条守卫真正管的东西
    expect(signupGate({ isExistingUser: false, code: PLACEHOLDER_CODE, list: [PLACEHOLDER_CODE, ...LOCKED] }).allowed).toBe(false)
  })

  it('空名单不等于"什么码都行"：那还是没锁', () => {
    expect(codesAreConfigured([])).toBe(false)
    expect(registrationMode([])).toBe('open')
  })

  it('拒绝理由里不回显提交上来的码（截图与日志会留下它）', () => {
    const g = signupGate({ isExistingUser: false, code: 'some-guessed-code', list: LOCKED })
    expect(g.reason).not.toContain('some-guessed-code')
  })

  it('两种拒绝要分得清：没填码 vs 码不对（合并成一句会让人重复试）', () => {
    expect(signupGate({ isExistingUser: false, code: '', list: LOCKED }).reason).toMatch(/向应用创建者要/)
    expect(signupGate({ isExistingUser: false, code: '瞎猜的', list: LOCKED }).reason).toMatch(/邀请码不对/)
  })
})

describe('归一化', () => {
  it('只做去空格与小写', () => {
    expect(normalizeCode('  A-B1 ')).toBe('a-b1')
    expect(normalizeCode(null)).toBe('')
  })
})
