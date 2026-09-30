import type { Profile } from '../types'

/**
 * 「简历体检」的纯逻辑层（学牛客求职 Skill 的「简历体检」设计）。
 *
 * 规则版，不调模型：只查**事实层面的完整性**与**口径层面的表达问题**，
 * 每条不过都给一个可执行的修复动作。体检结果是给用户自己看的，
 * 所以可以列出「学校未填」这类事实 —— 但修复提示里仍然遵守打招呼纪律：
 * 校名只进网申表单，不进任何触达话术。
 */

export interface HealthItem {
  ok: boolean
  /** 检查项名称 */
  label: string
  /** 不过时的修复动作 */
  fix?: string
}

function has(v: string | null | undefined): boolean {
  return Boolean(String(v ?? '').trim())
}

export function profileHealth(profile: Profile | null, resumeCount: number): HealthItem[] {
  const p = profile ?? {}
  const skills = (p.skills ?? []).filter(Boolean)
  const cities = (p.expect_city ?? []).filter(Boolean)
  const directions = (p.directions ?? []).filter(Boolean)
  const selfIntro = String(p.self_intro ?? '').trim()
  const summary = String(p.resume_summary ?? '').trim()

  return [
    {
      ok: has(p.full_name),
      label: '姓名已填',
      fix: '网申「姓名」栏会直接取这个字段',
    },
    {
      ok: has(p.phone),
      label: '手机号已填',
      fix: '网申自动填表和浏览器扩展都依赖它，网申前务必补上',
    },
    {
      ok: has(p.contact_email),
      label: '常用邮箱已填',
      fix: 'HR 笔面试通知一般发邮箱，建议用最常查的那个',
    },
    {
      ok: has(p.github),
      label: 'GitHub 已填',
      fix: '这是「能力可 clone 验证」的锚点，打招呼说服力的一半在这里',
    },
    {
      ok: has(p.portfolio),
      label: '作品集 / 在线简历已填',
      fix: '没有在线作品集的话，可以直接填 GitHub 主页',
    },
    {
      ok: cities.length > 0,
      label: '期望城市已填',
      fix: '影响岗位匹配分的「城市符合期望」判定',
    },
    {
      ok: skills.length >= 5,
      label: `技能关键词 ≥ 5 个（当前 ${skills.length}）`,
      fix: '太少会让本地匹配分失真：关键词命中率是打分的主要来源',
    },
    {
      ok: directions.length > 0,
      label: '目标方向已填',
      fix: '目标方向会参与岗位匹配，也在 AI 评估时当上下文',
    },
    {
      ok: selfIntro.length >= 50,
      label: `一句话自我介绍 ≥ 50 字（当前 ${selfIntro.length}）`,
      fix: '太短的话，网申「自我介绍 / 你为什么适合」栏会显得单薄',
    },
    {
      ok: summary.length >= 40 && /\d/.test(summary),
      label: '项目数字口径已写入「项目与可验证事实」',
      fix: '把「5 个项目 / 6 个仓库 / 518 条测试」这类可 clone 核对的数字写进去。AI 话术只引用这里的事实',
    },
    {
      ok: has(p.available_days),
      label: '可实习时长已填',
      fix: '实习岗 JD 普遍卡每周天数与总时长，这栏是硬门槛',
    },
    {
      ok: resumeCount > 0,
      label: '简历库至少有 1 份简历',
      fix: '投递时需要关联具体简历版本，先去「简历库」录一条',
    },
  ]
}

/** 汇总：x/y 通过；全部通过时给一句「可以放心投」 */
export function healthSummary(items: HealthItem[]): { passed: number; total: number; allOk: boolean } {
  const passed = items.filter((i) => i.ok).length
  return { passed, total: items.length, allOk: passed === items.length }
}
