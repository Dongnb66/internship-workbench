import { describe, expect, it } from 'vitest'

/**
 * 邀请码生成的断言（生成器与判定必须咬合，否则发出去的码进不了门）。
 *
 * 为什么单独有这个模块：`registration.ts` 的名单是源码常量，创建者要自己造码、
 * 粘进去、再发布。手搓的码会踩两类坑：
 * 1. **用了易混字符**——邀请码要人抄、人念（`0/O`、`1/I/L`），抄错就是"你给的码不对"；
 * 2. **生成的码与门认的不是同一套归一规则**——比如生成器输出小写、判定读到大写，
 *    或者生成的码恰好等于占位符。这种错位不会报错，只会让人当面进不来。
 * 所以有一条跨模块断言：把 `renderSourceLine` 的输出喂回 `signupGate`，必须放行。
 */
import { ALPHABET, formatCode, generateCodes, renderSourceLine } from '../invites'
import { PLACEHOLDER_CODE, codesAreConfigured, normalizeCode, signupGate } from '../registration'

/** 确定性随机源：循环出 a…z 的字符，便于断言"码长什么样"而不是"随便一个什么" */
function fakeRand(): () => number {
  let i = 0
  return () => {
    const v = i / ALPHABET.length
    i = (i + 1) % ALPHABET.length
    return v
  }
}

describe('码的形状', () => {
  it('字符集去掉了会念混的那些（邀请码要人抄、人念）', () => {
    for (const bad of ['0', 'O', '1', 'I', 'L']) {
      expect(ALPHABET, `字符集里不该有 ${bad}`).not.toContain(bad)
    }
    expect(ALPHABET.length).toBeGreaterThanOrEqual(20)
  })

  it('固定形状 WB-<年>-<体>，体长度一致且全在字符集内', () => {
    const code = formatCode('abcdefgh', 2026)
    expect(code).toBe('WB-2026-ABCDEFGH')
    for (const c of generateCodes(5, fakeRand())) {
      // 码体 = 字符集本身（含 2-9，不含 0/1），不是纯字母
      expect(c).toMatch(/^WB-\d{4}-[A-Z2-9]{8}$/)
      expect(c.slice(-8).split('').every((ch) => ALPHABET.includes(ch))).toBe(true)
    }
  })

  it('一批里不重复，且数量就是要求的数量', () => {
    const list = generateCodes(20)
    expect(list.length).toBe(20)
    expect(new Set(list).size).toBe(20)
  })

  it('乱要求的数量直接拒（0 个、负数、一次要一百万个都不该生成）', () => {
    for (const n of [0, -3, 1001, 2.5, NaN]) {
      expect(() => generateCodes(n as number), `n=${n} 不该被接受`).toThrow(/数量/)
    }
    expect(generateCodes(1).length).toBe(1)
    expect(generateCodes(200).length).toBe(200)
  })
})

describe('生成器与注册门必须咬合', () => {
  it('生成的码本身没被归一成占位符（空、纯空格都不许）', () => {
    for (const c of generateCodes(3, fakeRand())) {
      expect(normalizeCode(c)).not.toBe('')
      expect(normalizeCode(c)).not.toBe(normalizeCode(PLACEHOLDER_CODE))
    }
  })

  it('把生成的名单粘回源码后，`codesAreConfigured` 就该说"配置好了"', () => {
    const list = generateCodes(2, fakeRand())
    expect(codesAreConfigured(list)).toBe(true)
    expect(signupGate({ isExistingUser: false, code: list[0], list }).allowed).toBe(true)
  })

  it('renderSourceLine 输出的就是能直接替换的那一行，且逐字包含每个码', () => {
    const list = generateCodes(2, fakeRand())
    const line = renderSourceLine(list)
    expect(line).toMatch(/^export const INVITE_CODES: string\[\] = \[/)
    expect(line.trimEnd().endsWith(']')).toBe(true)
    for (const c of list) expect(line).toContain(`'${c}'`)
    // 占位符不该混进去：留着它就等于名单里躺着一个公开可读的"可用码"
    expect(line).not.toContain(PLACEHOLDER_CODE)
  })

  it('随机源坏了（一直给同一个值）时报撞码，而不是悄悄发一批重复的码', () => {
    // 去重那一步被拿掉时，这里会返回 3 枚一模一样的码——发出去就是三个人共用一个码，
    // 而且没人会察觉。所以宁可抛。
    expect(() => generateCodes(3, () => 0)).toThrow(/撞码/)
  })

  it('随机源给出 NaN 也要产出形状合法的码（不能拼出 undefined）', () => {
    const [code] = generateCodes(1, () => NaN)
    expect(code).toMatch(/^WB-\d{4}-[A-Z2-9]{8}$/)
    expect(code).not.toMatch(/undefined/i)
  })

  it('空名单不渲染那一行（把 INVITE_CODES 换成 [] 等于把门关死还以为开了）', () => {
    expect(() => renderSourceLine([])).toThrow(/没有可写的邀请码/)
    expect(() => renderSourceLine(['   '])).toThrow(/没有可写的邀请码/)
  })

  it('跨模块契约：从那一行里反解出名单，喂回门还是同一个结论', () => {
    const list = generateCodes(3, fakeRand())
    const parsed = [...renderSourceLine(list).matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(parsed).toEqual(list)
    for (const code of parsed) {
      expect(signupGate({ isExistingUser: false, code, list: parsed }).allowed).toBe(true)
    }
    expect(signupGate({ isExistingUser: false, code: '不是名单里的', list: parsed }).allowed).toBe(false)
  })
})
