import { PROFILE_TEMPLATE } from './constants'

/**
 * 设置页「一键填入模板」的映射逻辑，单独放这里是为了能被断言**产出的对象**。
 *
 * 这段映射原先内联在 `Settings.tsx` 的 `fillTemplate()` 里，于是它只能被源码正则
 * 覆盖（证明文件里那串提示语还在），证明不了产出的表单里没夹带别人的身份。
 * 抽成纯函数后，输出可以直接逐字段断言 —— 包括那个最容易错的数字字段：
 * 保存路径是 `form.expect_daily ? Number(form.expect_daily) : null`，
 * 所以模板必须落成**空串**（走 falsy 分支存 null）。填占位文本会存进 NaN，
 * 填 `String(null)` 会存进字面量 `"null"`，两种都不会有人当场发现。
 */

export const TEMPLATE_FORM_KEYS = [
  'full_name',
  'grade',
  'grad_year',
  'major',
  'school',
  'phone',
  'contact_email',
  'github',
  'portfolio',
  'available_from',
  'available_days',
  'self_intro',
  'expect_city',
  'expect_type',
  'expect_daily',
  'skills',
  'directions',
  'resume_summary',
  'daily_greet_limit',
  'greet_window',
  'min_interval_min',
] as const

export type TemplateForm = { [K in (typeof TEMPLATE_FORM_KEYS)[number]]: string }

/** 打招呼节奏的出厂默认（与小程序端 `pace.DEFAULT_PACE` 同一口径） */
const PACE_DEFAULTS = {
  daily_greet_limit: '8',
  greet_window: '09:00-21:00',
  min_interval_min: '30',
}

export function templateToForm(): TemplateForm {
  return {
    full_name: PROFILE_TEMPLATE.full_name,
    grade: PROFILE_TEMPLATE.grade,
    grad_year: PROFILE_TEMPLATE.grad_year,
    major: PROFILE_TEMPLATE.major,
    school: PROFILE_TEMPLATE.school,
    // 联系类字段刻意留空：模板不该替用户决定手机号、邮箱，更不该预填发起人的主页
    phone: '',
    contact_email: '',
    github: '',
    portfolio: '',
    available_from: '',
    available_days: PROFILE_TEMPLATE.available_days,
    self_intro: PROFILE_TEMPLATE.self_intro,
    expect_city: PROFILE_TEMPLATE.expect_city.join('、'),
    expect_type: PROFILE_TEMPLATE.expect_type.join('、'),
    expect_daily: PROFILE_TEMPLATE.expect_daily ? String(PROFILE_TEMPLATE.expect_daily) : '',
    skills: PROFILE_TEMPLATE.skills.join('、'),
    directions: PROFILE_TEMPLATE.directions.join('、'),
    resume_summary: PROFILE_TEMPLATE.resume_summary,
    ...PACE_DEFAULTS,
  }
}
