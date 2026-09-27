import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 「谁能打开创建者试用」这件事的断言。
 *
 * 起因是一个我自己做出来的洞：计费门默认不花创建者的钱，可试用开关原先摆在设置页里，
 * **任何登录进来的使用者都能勾上它**——门就等于没关。所以这道开关的可见性本身要有人守。
 *
 * 三条判定：
 * 1. 出厂 `OWNER_EMAIL` 是空串 → **谁都不算创建者**（默认关闭，与邀请码同一套做法）。
 * 2. 比对按邮箱全等（去空格 + 忽略大小写），不按包含/前缀——`a@b.com` 不该匹配 `a@b.com.evil.cn`。
 * 3. 平台没把 email 放进会话时（SDK 里 `email?: string` 是可缺省的），一律按"不是创建者"处理，
 *    不猜。界面上那句话必须说明"看不到开关不等于坏了"，否则用户会以为是 bug。
 */
import { OWNER_EMAIL, isOwnerAccount, normalizeEmail } from '../ownerAccount'

describe('创建者身份的判定', () => {
  it('出厂是空值：谁都不算创建者（连填了邮箱的人也不算）', () => {
    expect(OWNER_EMAIL).toBe('')
    expect(isOwnerAccount('someone@example.com')).toBe(false)
    expect(isOwnerAccount('')).toBe(false)
    expect(isOwnerAccount(undefined)).toBe(false)
  })

  it('配好之后按全等比：大小写与前后空格不影响，包含关系不算', () => {
    expect(isOwnerAccount('  Boss@Example.COM ', 'boss@example.com')).toBe(true)
    expect(isOwnerAccount('boss@example.com.evil.cn', 'boss@example.com')).toBe(false)
    expect(isOwnerAccount('iboss@example.com', 'boss@example.com')).toBe(false)
    expect(isOwnerAccount('boss@example.org', 'boss@example.com')).toBe(false)
  })

  it('两边都为空 = 不算创建者（空邮箱不能把这道门自己打开）', () => {
    expect(isOwnerAccount('', '')).toBe(false)
    expect(isOwnerAccount('   ', '  ')).toBe(false)
  })

  it('归一化只做去空格与小写', () => {
    expect(normalizeEmail('  A@B.Com ')).toBe('a@b.com')
    expect(normalizeEmail(null)).toBe('')
  })
})

describe('设置页上那道开关', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const settings = readFileSync(path.resolve(here, '..', '..', 'pages', 'Settings.tsx'), 'utf8')

  it('扫到了内容，并且找得到试用开关', () => {
    expect(settings.length).toBeGreaterThan(500)
    expect(settings).toMatch(/type="checkbox"[^>]*checked=\{trial\}/)
  })

  it('开关由创建者身份决定，不是无条件摆出来', () => {
    const atOwner = settings.search(/isOwnerAccount\(/)
    const atToggle = settings.search(/type="checkbox"[^>]*checked=\{trial\}/)
    expect(atOwner, '设置页没问 isOwnerAccount：任何人都能打开创建者的钱包').toBeGreaterThanOrEqual(0)
    expect(atOwner, '身份判定写在开关之后：JSX 里已经摆出来了再判断就晚了').toBeLessThan(atToggle)
    expect(settings, '开关没有被创建者身份包住（查了身份却照摆）').toMatch(/\{isOwner \? \(/)
    // 这一条是变异检查逼出来的：`const isOwner = true` 那种写法既留着 isOwnerAccount 的调用，
    // 也照样有 `{isOwner ? (`，上面三条全是绿的——可见性其实已经没人守了。
    expect(settings, 'isOwner 不是从身份判定算出来的').toMatch(/const isOwner = isOwnerAccount\(/)
  })

  it('写存储那一处之前也再过一次身份判定（开关只是入口，不是授权）', () => {
    const atWriter = settings.search(/function toggleTrial\(/)
    const atGuard = settings.indexOf('isOwnerAccount(', atWriter)
    expect(atWriter).toBeGreaterThanOrEqual(0)
    expect(atGuard, 'toggleTrial 不再问身份：从控制台或别处调用就能绕过界面').toBeGreaterThan(atWriter)
    expect(atGuard).toBeLessThan(atWriter + 600)
  })

  it('非创建者看不到开关时，页面说明为什么（免得当成 bug）', () => {
    expect(settings).toMatch(/不是创建者账号|创建者账号才能/)
  })
})
