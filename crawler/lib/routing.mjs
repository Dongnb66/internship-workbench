/**
 * 抓取任务的引擎路由 —— 纯函数，不碰浏览器、不碰 Python、不碰网络。
 *
 * 为什么单独成模块：(A)「引擎由站点表决定」是一次**行为变更**，必须被测试钉住，
 * 否则它就是没验证就固化进站点表的承诺。做成纯函数就能离线覆盖每条分支，
 * 不必为了验一条错误路径去真打一次 BOSS 再冷却 90 秒。
 */

export const DEFAULT_ENGINE = ''

/**
 * 给每个目标定引擎并分组。三条规则都是刻意的：
 *
 *  1. **只有站点表显式声明了 engine 才自动选引擎。** 没声明 = 走默认内核。
 *     不许出现「这站历史上需要别的引擎，所以给它加条隐式路由」——
 *     一旦允许隐式声明，就退回「靠人记得」，(A) 的价值当场消失。
 *  2. `--engine` 是**覆盖开关**：明传明用（含故意拿引擎去跑没声明的站点，调试用），结果自负。
 *     但「这个引擎能不能解析那个站点」是能力事实：`sites.mjs` 用 `engine` 字段表达它，
 *     对不上就判停，不假装跑成功。
 *  3. 传了不认识的引擎名（如 `--engine playwright`）⇒ 落进 `unknownEngine`，调用方必须硬失败。
 *     「不认识就回落默认内核」正是被禁止的假成功形态。
 */
export function routeTargets({ targets = [], requestedEngine = '', engineNames = [] }) {
  const requested = String(requestedEngine || '').trim().toLowerCase()

  if (requested && !engineNames.includes(requested)) {
    return { unknownEngine: requested, groups: [], unsupported: [] }
  }

  const routed = targets.map((target) => ({
    ...target,
    engine: requested || String(target.site?.engine || '').trim().toLowerCase() || DEFAULT_ENGINE,
  }))

  const byEngine = new Map()
  for (const target of routed) {
    const key = target.engine
    if (!byEngine.has(key)) byEngine.set(key, [])
    byEngine.get(key).push(target)
  }

  // 默认内核批先跑：它不依赖 Python，装没装 Python 的人都能先看到前一半结果。
  const names = [...byEngine.keys()].sort((a, b) => {
    if (a === DEFAULT_ENGINE) return -1
    if (b === DEFAULT_ENGINE) return 1
    return a < b ? -1 : 1
  })

  return {
    unknownEngine: '',
    groups: names.map((name) => ({ engine: name, targets: byEngine.get(name) })),
    // 被 --engine 套到「站点表没声明该引擎」的目标上：能力对不上，调用方按站点判停。
    unsupported: routed.filter((t) => t.engine !== DEFAULT_ENGINE && t.site?.engine !== t.engine),
  }
}

/**
 * 汇总行 + 整轮计数。**「部分成功」是最容易被读成「全成功」的形状**，
 * 所以这里强制写清：哪一站判停、原因是什么、成功几站失败几站、每站用的什么引擎。
 */
export function summarizeRun({ results = [], engineLabels = {} }) {
  const lines = []
  let total = 0
  let okCount = 0

  for (const result of results) {
    const count = result.jobs?.length ?? 0
    total += count
    if (result.ok) okCount += 1
    const via = engineLabels[result.engine] ?? '默认内核'
    const status = result.ok ? `${count} 条` : `失败（${result.reason ?? '见下面的原因清单'}）`
    lines.push(`${result.ok ? '✓' : '✗'} ${result.label}：${status} · 引擎：${via}`)
    for (const error of result.errors ?? []) lines.push(`    · ${error}`)
  }

  // 默认值不需要解释，偏离默认才需要 —— 不逐站打「本站走默认内核」，
  // 但汇总要一眼看出这一轮有几个站不是默认，否则"哪几个不是默认"没有入口。
  const offDefault = results.filter((r) => r.engine && r.engine !== DEFAULT_ENGINE)
  if (offDefault.length) {
    const byEngine = new Map()
    for (const r of offDefault) byEngine.set(r.engine, (byEngine.get(r.engine) ?? 0) + 1)
    const parts = [...byEngine.entries()].map(([name, n]) => `${n} 走 ${name}`).join(' / ')
    lines.push('')
    lines.push(`引擎构成：${results.length} 个目标中 ${results.length - offDefault.length} 个走默认内核，${parts}`)
  }

  const stops = results.filter((r) => r.stopped)
  if (stops.length) {
    lines.push('')
    lines.push(`⚠ ${stops.length} 个目标判停（其余照常跑完）：`)
    for (const r of stops) lines.push(`    · ${r.label} —— ${r.stoppedReason ?? '原因未记录'}`)
  }

  return { lines, total, okCount, stoppedCount: stops.length, failedCount: results.length - okCount }
}

/**
 * 整轮退出码：**只要有目标判停或失败就非零**，哪怕别的站点产出了岗位。
 * 全成功时沿用原规则：读到过但全与去重历史重复 ⇒ 0（0.7.6 的教训）；一条都没有 ⇒ 1。
 *
 * 故意**不接受** anyStopped 这种外部旗标：它和 results 是同一件事的两份记录，
 * 迟早会不一致（wall 命中时置了 stopped 却忘了置旗标，汇总写着判停而退出码是 0，真就这么错过一次）。
 * 事实源只留 results。
 */
export function computeExitCode({ total, results = [] }) {
  if (results.some((r) => r.stopped || !r.ok)) return 1
  if (!total && results.some((r) => r.ok && (r.read ?? 0) > 0)) return 0
  if (!total) return 1
  return 0
}
