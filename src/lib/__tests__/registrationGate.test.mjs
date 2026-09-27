import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 注册收口真的挂在登录页上（源码级，推导式）。
 *
 * 为什么要这一条：`registration.ts` 的判定本身已经测过了，但**门装在哪儿**没人管就会漂——
 * 将来有人加第四个登录入口（比如 OAuth 回调页），或者把 `verifyOtp` 挪到别处先调用，
 * 判定照样全绿，站点却重新变成开放注册。
 * 而账号只在 `verifyOtp({ isExistingUser: false })` 那一步产生，所以必须钉住：
 * **调用点之前先问门，被拒就 return**。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(here, '..', '..') // src/

const login = readFileSync(path.join(SRC, 'pages', 'Login.tsx'), 'utf8')

describe('登录页上的注册门', () => {
  it('扫到了内容：文件不空，否则下面的断言都是假的', () => {
    expect(login.length).toBeGreaterThan(500)
    expect(login).toMatch(/verifyOtp\s*\(/)
  })

  it('唯一会产生新账号的那一步，前面先问了门', () => {
    const atGate = login.search(/signupGate\s*\(/)
    const atVerify = login.search(/cloud\.auth\.verifyOtp\s*\(/)
    expect(atGate, '登录页没问 signupGate：门没装').toBeGreaterThanOrEqual(0)
    expect(atVerify, '登录页找不到 verifyOtp 调用点：扫描假设变了，请同步改这条检查').toBeGreaterThanOrEqual(0)
    expect(atGate, '门问在 verifyOtp 之后：账号已经建好了才拦，晚了').toBeLessThan(atVerify)
  })

  it('被门拒了是真的 return，不是查完照发', () => {
    expect(login, '查了 gate 却没拦住请求').toMatch(/if \(!gate\.allowed\)\s*\{[\s\S]{0,120}?\breturn\b/)
  })

  it('界面不再宣传「自动为你创建账号」（那句话现在是真的不成立）', () => {
    expect(login).not.toMatch(/自动为你创建账号|无需单独注册/)
    // 光测「不许出现哪句」挡不住换一种说法重新开放：承诺本身也要钉住
    expect(login, '界面上的那句话没在说「新邮箱要凭邀请码」').toMatch(/新邮箱不再自行注册/)
    expect(login).toMatch(/邀请码/)
  })

  it('发码与验码之外没有第二条创建账号的路（signUp / signInWithOtp 都不许出现）', () => {
    expect(login, '出现了别的注册入口，收口就漏了').not.toMatch(/cloud\.auth\.(signUp|signInWithOtp)\s*\(/)
  })
})
