import { track } from './usage'
import { detectOs } from './usageEnv'

/**
 * 上报体的两道门（都在 src/lib/usage.ts 的 sanitizeDetail）：
 *   ① 字符串只保留 <= 40 字符；② **只保留前 6 个键**（Object.entries(...).slice(0, 6)）。
 *
 * ⚠️ 2026-10-04 我在这里连着错两次（WorkBuddy 跑真实调用链查出来的）：
 *   第一次：把结果压成一整行 240 字符的 summary ⇒ 被 ① 整条丢，而「无超宽」那种短文本反而能过，
 *           **页面没超宽时报得全、真超宽时什么都报不出来**；
 *   第二次：拆成短字段后放了 8 个键 ⇒ 被 ② 砍掉 e1/e2，**元凶元素名正好进不了库**。
 * 现在只放 6 个键，并优先保证「元凶元素名」在里面。
 */
export const DIAG_STR_MAX = 40
export const DIAG_MAX_KEYS = 6

export function diagEnabled(search: string): boolean {
  return /[?&]diag=1(&|$)/.test(search)
}

export interface DiagDetail {
  [k: string]: number | string
}

/**
 * 组装上报体（最多 6 个键，全部过得了 sanitizeDetail）：
 *   d    横向溢出多少 px（>0 就是「能横滑」的量级）
 *   vw   视口宽（能看出是否被浏览器放大）
 *   os   detectOs(UA) 的当场判定（顺带验手机识别）
 *   page 当前页（#jobs / #pipeline …）
 *   e1/e2 最宽的两个元素「标签.class(整数宽)」
 */
export function buildDiagDetail(input: {
  viewport: number
  scroll: number
  os: string
  page: string
  worst: { name: string; width: number }[]
}): DiagDetail {
  const items = input.worst.slice(0, 2).map((w) => (w.name + '(' + w.width + ')').slice(0, DIAG_STR_MAX))
  const out: DiagDetail = {
    d: input.scroll - input.viewport,
    vw: input.viewport,
    os: input.os.slice(0, DIAG_STR_MAX),
    page: input.page.slice(0, DIAG_STR_MAX),
  }
  if (items[0]) out.e1 = items[0]
  if (items[1]) out.e2 = items[1]
  return out
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
    const page = (window.location.hash || '#top').replace(/^#/, '').split(/[?&]/)[0] || 'top'
    track('diag', buildDiagDetail({ viewport, scroll, os: detectOs(), page, worst }))
  } catch {
    /* 诊断失败绝不影响功能 */
  }
}
