/**
 * 引擎路由的契约测试。
 *
 * 钉的是 DSH 第十轮那张行为表 —— 一次**行为变更**（引擎由站点表决定）必须有测试兜着，
 * 否则「(A) 已落地」这句话就只能靠人肉复述。全部是纯函数断言，不打站点、不起浏览器、不要 Python。
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_ENGINE, computeExitCode, routeTargets, summarizeRun } from '../lib/routing.mjs'
import { findSite } from '../sites.mjs'

const ENGINES = ['scrapling']

const site = (id) => {
  const s = findSite(id)
  if (!s) throw new Error(`站点表里没有 ${id}`)
  return s
}
const target = (id, kw = '实习') => ({ kind: 'site', site: site(id), kw, urls: [] })

describe('引擎路由：只有站点表显式声明才自动选引擎', () => {
  it('声明了 scrapling 的站点（boss）不带 --engine 也自动走 scrapling', () => {
    expect(site('boss').engine, '前提：站点表确实声明了').toBe('scrapling')
    const r = routeTargets({ targets: [target('boss')], engineNames: ENGINES })
    expect(r.unknownEngine).toBe('')
    expect(r.groups.map((g) => g.engine)).toEqual(['scrapling'])
    expect(r.groups[0].targets[0].engine).toBe('scrapling')
  })

  it('没声明引擎的站点绝不因为「以前用过引擎」被隐式路由', () => {
    const r = routeTargets({ targets: [target('tencent')], engineNames: ENGINES })
    expect(r.groups.map((g) => g.engine)).toEqual([DEFAULT_ENGINE])
    expect(r.groups[0].targets[0].engine).toBe('')
    expect(r.unsupported).toEqual([])
  })

  it('混合一轮：默认内核批在前、引擎批在后，两批各拿到自己的目标', () => {
    const r = routeTargets({ targets: [target('boss'), target('tencent')], engineNames: ENGINES })
    const shape = r.groups.map((g) => [g.engine, g.targets.map((t) => t.site.id)])
    expect(shape).toEqual([
      ['', ['tencent']],
      ['scrapling', ['boss']],
    ])
  })

  it('同引擎的多个目标合并进一批，不被拆开', () => {
    const r = routeTargets({
      targets: [target('boss', 'AI Agent'), target('boss', '后端')],
      engineNames: ENGINES,
    })
    expect(r.groups.length).toBe(1)
    expect(r.groups[0].targets.length).toBe(2)
  })
})

describe('引擎路由：显式 --engine 是覆盖开关', () => {
  it('明传的引擎盖到没声明的站点上 ⇒ 记为能力对不上，由调用方判停（不是悄悄跑）', () => {
    const r = routeTargets({ targets: [target('tencent')], requestedEngine: 'scrapling', engineNames: ENGINES })
    expect(r.groups.map((g) => g.engine)).toEqual(['scrapling'])
    expect(r.unsupported.map((t) => t.site.id)).toEqual(['tencent'])
  })

  it('值不认识（如 --engine playwright）⇒ unknownEngine 非空且不出任何分组，调用方必须硬失败', () => {
    const r = routeTargets({ targets: [target('boss')], requestedEngine: 'playwright', engineNames: ENGINES })
    expect(r.unknownEngine).toBe('playwright')
    expect(r.groups).toEqual([])
  })

  it('不认识的值也**不会**回落到默认内核 —— 回落就是那条被禁止的假成功', () => {
    const r = routeTargets({ targets: [target('boss'), target('tencent')], requestedEngine: 'nope', engineNames: ENGINES })
    expect(r.groups.flatMap((g) => g.targets)).toEqual([])
  })
})

describe('汇总与退出码：部分成功不能被读成全成功', () => {
  const results = [
    { label: '腾讯招聘 · 实习', engine: '', ok: true, jobs: [1, 2, 3], read: 3 },
    {
      label: 'BOSS直聘 · AI Agent',
      engine: 'scrapling',
      ok: false,
      jobs: [],
      stopped: true,
      stoppedReason: '本机没有可用的 Python + scrapling 环境',
      errors: ['装法见 crawler/README.md'],
    },
  ]

  it('汇总逐条标注所用引擎，并单列判停清单与原因', () => {
    const s = summarizeRun({ results, engineLabels: { scrapling: 'scrapling（patchright）' } })
    expect(s.total).toBe(3)
    expect(s.stoppedCount).toBe(1)
    expect(s.failedCount).toBe(1)
    const text = s.lines.join('\n')
    expect(text).toContain('引擎：默认内核')
    expect(text).toContain('引擎：scrapling（patchright）')
    expect(text).toContain('1 个目标判停')
    expect(text).toContain('本机没有可用的 Python + scrapling 环境')
  })

  it('有产出但有一站判停 ⇒ 整轮仍非零退出', () => {
    expect(computeExitCode({ total: 3, results })).toBe(1)
  })

  it('全成功且有产出 ⇒ 0', () => {
    const ok = [{ label: 'a', ok: true, jobs: [1], read: 1 }]
    expect(computeExitCode({ total: 1, results: ok })).toBe(0)
  })

  it('读到过但全与去重历史重复 ⇒ 0（这是正常结果，不是进程出错，0.7.6 的教训）', () => {
    const dup = [{ label: 'a', ok: true, jobs: [], read: 5 }]
    expect(computeExitCode({ total: 0, results: dup })).toBe(0)
  })

  it('一条都没有、也没读到过 ⇒ 1', () => {
    const none = [{ label: 'a', ok: false, jobs: [], read: 0 }]
    expect(computeExitCode({ total: 0, results: none })).toBe(1)
  })
})
