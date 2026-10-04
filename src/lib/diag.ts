import { track } from './usage'
import { detectOs } from './usageEnv'

/**
 * 手机版式诊断（?diag=1）：把「页面比屏幕宽多少、是谁撑宽的」直接上报到库。
 *
 * 为什么这样做（2026-10-04 第三轮）：本机 dist 无登录态、Agent Window 也拿不到登录态，
 * 浏览器工具的快照又没有几何信息 ⇒ 我无法在真机上量 scrollWidth。改让页面自报一次，
 * 管理端（WorkBuddy）直接读 usage_events 就能看到元凶，不用 devtools。
 *
 * 隐私：只上报「元素名（标签+class）+ 整数宽度」，不含任何文本内容；仍受 ?nostat=1 / GPC / 关掉开关 约束。
 */
export function diagEnabled(search: string): boolean {
  return /[?&]diag=1(&|$)/.test(search)
}

/** 把测量结果压成一行短文本（纯函数，便于测试；上限 240 字符） */
export function formatOverflow(input: {
  viewport: number
  scroll: number
  os: string
  worst: { name: string; width: number }[]
}): string {
  const head = 'vw=' + input.viewport + ' sw=' + input.scroll + ' os=' + input.os
  const items = input.worst.slice(0, 5).map((w) => w.name + '(' + w.width + ')')
  const text = head + (items.length ? ' 超宽: ' + items.join(' ') : ' 无超宽元素')
  return text.slice(0, 240)
}

/** 找出比视口宽的元素（只看元素盒子，不读文本） */
export function collectOverflow(root: ParentNode, viewport: number): { name: string; width: number }[] {
  const out: { name: string; width: number }[] = []
  const nodes = root.querySelectorAll('*')
  for (let i = 0; i < nodes.length; i += 1) {
    const el = nodes[i] as HTMLElement
    const r = el.getBoundingClientRect()
    if (r.width <= viewport + 1) continue
    const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 2).join('.')
    const name = el.tagName.toLowerCase() + (cls ? '.' + cls : '')
    out.push({ name, width: Math.round(r.width) })
  }
  out.sort((a, b) => b.width - a.width)
  return out.slice(0, 8)
}

/** 在页面里跑一次并上报（失败静默；?nostat=1 时 track 自己会拦掉） */
export function reportDiag(): void {
  try {
    if (typeof window === 'undefined') return
    if (!diagEnabled(window.location.search)) return
    const viewport = Math.max(document.documentElement.clientWidth, 1)
    const scroll = document.documentElement.scrollWidth
    const worst = collectOverflow(document, viewport)
    const summary = formatOverflow({ viewport, scroll, os: detectOs(), worst })
    track('diag', { summary, over: worst.length, extra: String(scroll - viewport) })
  } catch {
    /* 诊断失败绝不影响功能 */
  }
}
