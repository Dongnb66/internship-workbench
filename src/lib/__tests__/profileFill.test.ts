import { describe, expect, it } from 'vitest'

import { templateToForm, TEMPLATE_FORM_KEYS, type TemplateForm } from '../profileFill'
import { PROFILE_TEMPLATE } from '../constants'

/**
 * 「一键填入模板」映射成表单状态这一步，必须能被断言**产出对象**，
 * 而不是像在 `profileTemplate.test.mjs` 里那样只对 `Settings.tsx` 的源码做正则。
 *
 * 源码正则证明的是「那串字还在文件里」，证明不了产出的表单里没夹带别人的身份。
 * 这里把映射抽成纯函数，于是能直接检查输出：21 个键齐全、身份字段是占位符、
 * 联系类字段一律空、数字字段落成空串而不是 `String(null)` 造出的字面量 `"null"`。
 */

const IDENTITY = ['杨运栋', '吉首大学', '张家界', 'Dongnb66', 'vibe-portfolio']

describe('templateToForm', () => {
  const form = templateToForm()

  it('产出 21 个键，与设置页表单的初始状态一一对应', () => {
    expect(Object.keys(form).sort()).toEqual([...TEMPLATE_FORM_KEYS].sort())
    expect(TEMPLATE_FORM_KEYS.length).toBe(21)
  })

  it('产出的每一个值都不含发起人的身份', () => {
    const leaked = Object.entries(form)
      .filter(([, v]) => IDENTITY.some((token) => v.includes(token)))
      .map(([k, v]) => `${k}=${v}`)
    expect(leaked, `这些字段还带着身份：${leaked.join(' ｜ ')}`).toEqual([])
  })

  it('身份类字段填的是【】占位符，而不是别人的真信息', () => {
    for (const field of ['full_name', 'school', 'major', 'grade', 'grad_year', 'self_intro', 'resume_summary', 'available_days'] as (keyof TemplateForm)[]) {
      expect(form[field], `${field} 不是占位符：「${form[field]}」`).toMatch(/【.+】/)
    }
  })

  it('联系类字段一律留空，由用户自己填', () => {
    for (const field of ['phone', 'contact_email', 'github', 'portfolio', 'available_from'] as (keyof TemplateForm)[]) {
      expect(form[field], `${field} 不该被模板预填`).toBe('')
    }
  })

  it('数字字段落成空串：不能是 String(null) 造出的字面量 "null"，也不能是 NaN 的入口', () => {
    expect(form.expect_daily).toBe('')
    expect(form.expect_daily).not.toBe(String(PROFILE_TEMPLATE.expect_daily))
    // 保存路径是 `form.expect_daily ? Number(form.expect_daily) : null`，
    // 空串走 falsy 分支存 null；换成占位文本就会存进 NaN。
    expect(Number(form.expect_daily || 0)).not.toBeNaN()
  })

  it('打招呼节奏用的是出厂默认，不是模板内容', () => {
    expect(form.daily_greet_limit).toBe('8')
    expect(form.greet_window).toBe('09:00-21:00')
    expect(form.min_interval_min).toBe('30')
  })

  it('数组字段按顿号拼接成一行可编辑文本', () => {
    expect(form.expect_city).toBe(PROFILE_TEMPLATE.expect_city.join('、'))
    expect(form.skills).toBe(PROFILE_TEMPLATE.skills.join('、'))
    expect(form.directions).toBe(PROFILE_TEMPLATE.directions.join('、'))
  })
})
