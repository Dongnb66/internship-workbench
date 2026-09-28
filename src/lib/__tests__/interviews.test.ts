import { describe, expect, it } from 'vitest'

/**
 * 面试表单「关联投递」下拉的纯逻辑。
 *
 * 为什么必须有这个字段：AI 面试准备的三路自动带入（JD / 简历 / 历史复盘）
 * 全部沿 application_id 追溯——面试记录不挂到投递上，功能就只剩手动粘贴。
 * 这个下拉的选项文案要让人一眼认出「是哪次投递」，排序要最新投的在前。
 */

const { applicationOptions } = await import('../interviews')

describe('面试表单的关联投递选项', () => {
  it('文案 = 公司 · 岗位（投递日期），按投递时间最新在前', () => {
    // 夹具按**线上真实写入的形状**来：`applied_at` 全部由 <input type="date"> / todayISO()
    // 写入，是纯日期串。早先这里写的是 '2026-09-23T09:00:00Z'，在 UTC-11 会落到 09-22，
    // 「投递日期」这条断言就变成了"测时区"而不是测文案。
    const apps = [
      { id: 2, company: '腾讯', title: 'AI 全栈工程师', applied_at: '2026-09-20' },
      { id: 1, company: '同元软控', title: 'Agent 实习', applied_at: '2026-09-23' },
    ]
    const opts = applicationOptions(apps)
    expect(opts.map((o) => o.id)).toEqual([1, 2])
    expect(opts[0].label).toContain('同元软控')
    expect(opts[0].label).toContain('Agent 实习')
    expect(opts[0].label).toContain('2026-09-23')
    expect(opts[1].label).toContain('腾讯')
  })

  it('缺岗位、缺日期、空列表都不产生畸形文案', () => {
    const opts = applicationOptions([{ id: 5, company: '某公司', title: null, applied_at: null }])
    expect(opts).toHaveLength(1)
    expect(opts[0].label).toContain('某公司')
    expect(opts[0].label).toContain('未填岗位')
    expect(opts[0].label).not.toContain('（') // 没有日期就没有日期括号
    expect(applicationOptions([])).toEqual([])
  })

  it('没有 id 的行直接丢弃——下拉的 value 必须是可用的投递 id', () => {
    const opts = applicationOptions([{ company: '孤儿行', title: 'x' }, { id: 7, company: '正常', title: null, applied_at: null }])
    expect(opts.map((o) => o.id)).toEqual([7])
  })
})
