/**
 * 安全停止清单 —— 把「遇到就停，不尝试绕过」从文档承诺升级为代码约束
 * （AGENTS.md §2.3 的硬约束；对标 BossHunter 的安全停止设计）。
 *
 * run.mjs 在每个页面采集前跑 detectStopWall：命中任何一条规则就停止
 * 当前站点（break 翻页循环），并把原因写进 errors——不重试、不换姿势、
 * 不尝试绕过。风控页上的「再多翻一页」就是封号倒计时。
 *
 * 岗位日报也在这里：一次运行产出一份 markdown（campus-radar 的思路——
 * 「今天新出了什么」比全量列表重要），写进 output/daily-YYYY-MM-DD.md。
 */

export const STOP_RULES = [
  {
    id: 'captcha',
    label: '验证码/安全验证',
    patterns: [/验证码/i, /安全验证/i, /人机验证/i, /滑动验证/i, /captcha/i],
  },
  {
    id: 'login_wall',
    label: '登录墙',
    patterns: [/请登录/i, /立即登录/i, /扫码登录/i, /登录后查看/i, /sign\s*in\s*to\s*continue/i],
  },
  {
    id: 'risk_control',
    label: '风控拦截',
    patterns: [/访问异常/i, /请求过于频繁/i, /操作过于频繁/i, /暂时无法访问/i, /访问被拒绝/i, /请求被拦截/i],
  },
]

/** 检测页面文本是否命中安全停止规则；命中即停当前站点，不重试不绕过 */
export function detectStopWall(pageText) {
  const text = String(pageText ?? '')
  if (!text) return { hit: false }
  for (const rule of STOP_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) return { hit: true, id: rule.id, label: rule.label, pattern: String(pattern) }
    }
  }
  return { hit: false }
}

/**
 * 生成岗位日报 markdown。sites: [{label, channel, count, titles, stopped?}]，
 * total 为全部站点新增合计。空运行也要可读，不产生空标题。
 */
export function dailyReportMd({ dateLabel, sites, total }) {
  const lines = [`# 岗位日报 ${dateLabel}`, '', `合计新增 ${total} 条。`]
  if (!sites.length) {
    lines.push('', '今天没有抓到新岗位。可能是：站点无更新、关键词太窄，或被安全停止清单拦下（见运行日志）。')
    lines.push('', '> 本日报由本地抓取器在每次运行结束时自动生成，只覆盖**本轮新增**；已在池中的岗位不重复出现。')
    return lines.join('\n')
  }
  lines.push('')
  for (const s of sites) {
    lines.push(`## ${s.label}（${s.channel}）— 新增 ${s.count} 条`)
    if (s.stopped) lines.push(`> ⚠ 命中安全停止清单（${s.stopped}），该站点提前停止，未抓完整。`)
    if (s.titles?.length) {
      lines.push('')
      for (const t of s.titles) lines.push(`- ${t}`)
    }
    lines.push('')
  }
  lines.push('> 本日报由本地抓取器在每次运行结束时自动生成，只覆盖**本轮新增**；已在池中的岗位不重复出现。')
  return lines.join('\n')
}
