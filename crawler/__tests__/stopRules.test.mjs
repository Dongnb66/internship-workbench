import { describe, expect, it } from 'vitest'

/**
 * 安全停止清单的契约测试 —— 把「遇到就停，不尝试绕过」（AGENTS.md §2.3 的
 * 文档承诺）从表述升级为代码约束。
 *
 * 规则本体在 crawler/lib/stopRules.mjs：验证码 / 登录墙 / 风控拦截三类，
 * 命中即让当前站点停止抓取（run.mjs 接线）。这个测试钉住三件事：
 * 1. 三类规则都能被命中（规则失效 = 抓取器可能在风控页上继续翻页）；
 * 2. 正常岗位页不误报；
 * 3. 岗位日报的 markdown 生成有稳定形状。
 */

const { STOP_RULES, detectStopWall, dailyReportMd } = await import('../lib/stopRules.mjs')

describe('安全停止清单（显式规则）', () => {
  it('三类规则齐全：验证码 / 登录墙 / 风控拦截', () => {
    const ids = STOP_RULES.map((r) => r.id)
    expect(ids).toEqual(expect.arrayContaining(['captcha', 'login_wall', 'risk_control']))
    for (const r of STOP_RULES) {
      expect(r.label.trim().length).toBeGreaterThan(0)
      expect(r.patterns.length).toBeGreaterThan(0)
    }
  })

  it('验证码页命中 captcha 规则', () => {
    const hit = detectStopWall('安全验证 请完成滑动验证后继续访问')
    expect(hit.hit).toBe(true)
    expect(hit.id).toBe('captcha')
  })

  it('登录墙命中 login_wall 规则', () => {
    const hit = detectStopWall('你好，请登录后查看更多职位')
    expect(hit.hit).toBe(true)
    expect(hit.id).toBe('login_wall')
  })

  it('风控拦截页命中 risk_control 规则', () => {
    const hit = detectStopWall('您的访问出现异常，请求过于频繁，请稍后再试')
    expect(hit.hit).toBe(true)
    expect(hit.id).toBe('risk_control')
  })

  it('正常岗位列表页不误报', () => {
    const normal = 'Python 后端工程师 深圳 15-25K·14薪 岗位描述：负责服务端开发'
    expect(detectStopWall(normal).hit).toBe(false)
    expect(detectStopWall('').hit).toBe(false)
    expect(detectStopWall(null).hit).toBe(false)
  })
})

describe('岗位日报（campus-radar 思路）', () => {
  it('按站点分组，含总数与条目标题', () => {
    const md = dailyReportMd({
      dateLabel: '2026-09-25',
      sites: [
        { label: '腾讯招聘', channel: '官网投递', count: 2, titles: ['后端开发工程师', '客户端开发'] },
        { label: '实习僧', channel: '实习僧', count: 1, titles: ['Python 实习'], stopped: '验证码/安全验证' },
      ],
      total: 3,
    })
    expect(md).toContain('# 岗位日报 2026-09-25')
    expect(md).toContain('合计新增 3 条')
    expect(md).toContain('## 腾讯招聘（官网投递）')
    expect(md).toContain('- 后端开发工程师')
    expect(md).toContain('⚠ 命中安全停止清单（验证码/安全验证），该站点提前停止')
  })

  it('空运行也有可读的日报，不产生空标题', () => {
    const md = dailyReportMd({ dateLabel: '2026-09-25', sites: [], total: 0 })
    expect(md).toContain('合计新增 0 条')
    expect(md).toContain('今天没有抓到新岗位')
  })
})
