import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PROFILE_TEMPLATE } from '../constants'
import { profileHealth } from '../healthCheck'

/**
 * 出厂默认值不得携带发起人的身份。
 *
 * 「一键填入模板」是产品功能，任何注册用户都能点，点完的提示还叫人直接保存。
 * 模板里写着发起人的真实姓名、学校、GitHub 与自我介绍时，陌生人保存下来的画像
 * 就是发起人的画像 —— 之后的打招呼话术、AI 分析、简历生成全部以他的身份输出。
 * 这条与仓库公不公开无关：线上站点现在就能点到。
 *
 * 用 .mjs 是因为要读仓库里的源码文件，而 src 的 tsconfig 不带 node 类型；
 * 同类断言（registrationGate / aiPromptCoverage / ownerAccount）都在这里。
 */

/**
 * 发起人邮箱 @ 前那一段。拼开写是为了不在仓库里再留下完整串 ——
 * 0.8.5 的示例文案里写过它，等于把个人信息编进前端产物（线上 bundle 可 grep），
 * 加进 IDENTITY 之后，下面那条「产品代码里不得出现身份标记」会顺手守住它。
 */
const OWNER_MAIL_LOCAL = ['2088', '417049'].join('')

const IDENTITY = ['杨运栋', '吉首大学', '张家界', 'Dongnb66', 'vibe-portfolio', OWNER_MAIL_LOCAL]

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** 产品代码（src 与 miniprogram，测试夹具除外）里出现身份标记的文件 */
function productFilesWithIdentity() {
  const hits = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === '__tests__' || name === 'node_modules') continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(ts|tsx|js|jsx)$/.test(name)) continue
      if (IDENTITY.some((token) => readFileSync(full, 'utf8').includes(token))) hits.push(relative(ROOT, full))
    }
  }
  walk(join(ROOT, 'src'))
  walk(join(ROOT, 'miniprogram'))
  return hits
}

function templateStrings(tpl) {
  const out = []
  for (const value of Object.values(tpl)) {
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) out.push(...value.map((v) => String(v)))
  }
  return out
}

describe('出厂画像模板', () => {
  it('不含发起人的任何身份标记', () => {
    const leaked = templateStrings(PROFILE_TEMPLATE).filter((s) => IDENTITY.some((token) => s.includes(token)))
    expect(leaked, `模板里还留着发起人的身份：${leaked.join(' ｜ ')}`).toEqual([])
  })

  it('身份字段是一眼可见的占位符，不会被当成真数据保存下去', () => {
    const fields = ['full_name', 'school', 'major', 'grade', 'grad_year', 'self_intro', 'resume_summary', 'available_days']
    for (const field of fields) {
      const value = String(PROFILE_TEMPLATE[field] ?? '')
      expect(value, `${field} 既不是占位符也没留空：「${value}」`).toMatch(/【.+】/)
    }
  })

  it('数字字段留空：不替别人填期望日薪，也不会被 Number("【】") 变成 NaN', () => {
    expect(PROFILE_TEMPLATE.expect_daily).toBeNull()
  })

  it('小程序那份模板同样不含身份标记（两端各一份，容易只改一边）', () => {
    const src = read('miniprogram/utils/constants.js')
    const leaked = IDENTITY.filter((token) => src.includes(token))
    expect(leaked, `miniprogram/utils/constants.js 还留着：${leaked.join('、')}`).toEqual([])
  })

  it('模板的示例值不带任何具体届数（发起人自己那届曾经就是示例）', () => {
    // 0.8.11 补漏：上面那条 IDENTITY 扫描的词表是「姓名 / 学校 / 张家界 / GitHub / 作品集 / 邮箱本地段」，
    // **年份不在里面**，于是 `grad_year: '【毕业届，如 2028 届】'` 一直没被任何断言看见 ——
    // 而 2028 正是发起人自己的届数，这个串也确实编进了线上 bundle（实测 offset 296070）。
    // 它不像 gapPlan 那句是「对读者断言」，只是个格式示例，但标准是同一条（HANDOFF §11b）。
    const bad = templateStrings(PROFILE_TEMPLATE).filter((s) => /20\d{2}\s*届/.test(s))
    expect(bad, `模板示例里写了具体届数：${bad.join(' ｜ ')}`).toEqual([])
    const mp = read('miniprogram/utils/constants.js')
    expect(/20\d{2}\s*届/.test(mp), '小程序那份模板里还写着具体届数').toBe(false)
  })

  it('模板必须停在「骨架」状态：填了它不等于画像齐全，体检要还能报出缺项', () => {
    const items = profileHealth(
      {
        ...PROFILE_TEMPLATE,
        phone: '13800000000',
        contact_email: 'me@example.com',
        github: 'https://github.com/someone',
        portfolio: 'https://example.com',
      },
      1,
    )
    expect(
      items.filter((i) => !i.ok).length,
      '模板已经能被当成一份完整画像直接保存了 —— 出厂默认值不该替用户把内容写好',
    ).toBeGreaterThan(0)
  })
})

describe('产品代码的身份清理边界', () => {
  it('src 与 miniprogram 的产品代码里不出现发起人身份（测试夹具与文档除外）', () => {
    expect(productFilesWithIdentity()).toEqual([])
  })

  it('填入模板后的提示要求替换全部占位符，而不是只提醒补手机号邮箱', () => {
    expect(/notifyOk\([^)]*【[^)]*替换/s.test(read('src/pages/Settings.tsx')), 'fillTemplate 的提示没要求替换占位符').toBe(true)
  })

  it('作者署名不动：清理只针对出厂默认值，LICENSE 与 README 仍归发起人', () => {
    expect(read('LICENSE')).toContain('杨运栋')
    expect(read('README.md')).toContain('Dongnb66')
  })

  it('发起人邮箱那串数字在**整个工作树**里 0 命中（不限 src/miniprogram）', () => {
    // 为什么单独扫它而不并入上面那条产品代码扫描：姓名与学校在 LICENSE / README / docs / 测试夹具里
    // 有正当出现处，必须留白名单；而这一串数字**没有任何正当用途**，所以可以要求全树 0 命中。
    // 触发这条的实证：2026-09-28 我为了"记录一处泄露"把完整串写进了 INBOX 与 CHANGELOG 两处，
    // 而我当时自称"全仓唯一一处"的那条 grep 只扫了 docs src miniprogram crawler —— 范围写窄了。
    const mailLocal = ['2088', '417049'].join('')
    const skip = new Set(['.git', 'node_modules', 'dist', '.venv', 'output'])
    const hits = []
    const walk = (dir, depth) => {
      if (depth > 8) return
      for (const name of readdirSync(dir)) {
        if (skip.has(name)) continue
        const full = join(dir, name)
        if (statSync(full).isDirectory()) {
          walk(full, depth + 1)
          continue
        }
        if (!/\.(md|json|txt|ts|tsx|js|jsx|mjs|cjs|sql|yml|yaml|html|css|py|java)$/.test(name)) continue
        if (readFileSync(full, 'utf8').includes(mailLocal)) hits.push(relative(ROOT, full))
      }
    }
    walk(ROOT, 0)
    expect(hits, `这串数字出现在不该出现的地方：${hits.join('、')}`).toEqual([])
  })
})
