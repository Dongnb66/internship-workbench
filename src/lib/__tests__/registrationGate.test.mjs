import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 注册门真的挂在登录页上（源码级，推导式）。
 *
 * 为什么要这一条：`registration.ts` 的判定本身测过了，但**门装在哪儿**没人管就会漂——
 * 将来有人加第四个登录入口、或者把 `verifyOtp` 挪到别处先调用，判定照样全绿，
 * 而账号已经在门外面被创建出来了。
 *
 * 口径改过一次（见 `registration.test.ts` 开头那段）：默认从"要邀请码"改成"开放注册"，
 * 所以这里不再断言"界面不许宣传开号"，改成断言两件仍然成立的事：
 * ① `verifyOtp` 之前先问门、被拒就 return；② 邀请码那一栏只在**上了锁**的时候出现
 * （开放状态下还写着"需要邀请码"，就是在骗人）。
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

  it('邀请码那一栏由模式决定，不是无条件摆出来', () => {
    expect(login, '没问 registrationMode：开放注册时界面还会写着要邀请码').toMatch(/registrationMode\(/)
    const atMode = login.search(/registrationMode\(/)
    const atField = login.search(/label="邀请码"/)
    expect(atField, '找不到邀请码那一栏（锁上门时用户拿什么填？）').toBeGreaterThanOrEqual(0)
    expect(atMode, '模式判定写在栏位之后：已经摆出来了再判断就晚了').toBeLessThan(atField)
    expect(login, '那一栏没有被模式包住').toMatch(/\{inviteNeeded \? \(/)
    // 光有 registrationMode( 这个词不够：`const inviteNeeded = isNewEmail` 那种写法
    // 照样留著它、照样有 `{inviteNeeded ? (`，而开放状态下页面已经不再问码了还会拦人。
    expect(login, 'inviteNeeded 不是从注册模式算出来的').toMatch(/registrationMode\(\)\s*===\s*'invite'/)
  })

  it('界面上关于钱的那句还在（开放注册不代表开放创建者的额度）', () => {
    expect(login).toMatch(/自备|自己的.*Key/)
  })

  it('发码与验码之外没有第二条创建账号的路（signUp / signInWithOtp 都不许出现）', () => {
    expect(login, '出现了别的注册入口，门就漏了').not.toMatch(/cloud\.auth\.(signUp|signInWithOtp)\s*\(/)
  })
})
