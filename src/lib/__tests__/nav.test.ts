import { describe, expect, it } from 'vitest'
import { HUB_TABS, NAV_MAIN, REDIRECTS, TITLES } from '../nav'

/**
 * 导航收敛的守卫断言。变异验证：把 REDIRECTS 里任意 target 改成不存在的页
 * 或不存在的 tab，对应条目立即红——重定向指错地方比不重定向更伤用户。
 */
describe('nav 信息架构', () => {
  it('顶层导航收敛为 7 区且 key 唯一', () => {
    expect(NAV_MAIN).toHaveLength(7)
    const keys = NAV_MAIN.map((n) => n.key)
    expect(new Set(keys).size).toBe(7)
  })

  it('每个导航区都有标题（顶栏不留空）', () => {
    for (const n of NAV_MAIN) {
      expect(TITLES[n.key], `缺标题: ${n.key}`).toBeTruthy()
    }
  })

  it('REDIRECTS 的每个目标页都是真实导航区', () => {
    const pages = new Set(NAV_MAIN.map((n) => n.key))
    for (const [oldKey, { page }] of Object.entries(REDIRECTS)) {
      expect(pages.has(page), `旧 key ${oldKey} 指向不存在的页 ${page}`).toBe(true)
    }
  })

  it('REDIRECTS 的每个目标 tab 都真实存在', () => {
    for (const [oldKey, { page, tab }] of Object.entries(REDIRECTS)) {
      if (!tab) continue
      const tabs = HUB_TABS[page] ?? []
      expect(tabs.some((t) => t.key === tab), `旧 key ${oldKey} 的 tab ${tab} 在 ${page} 里不存在`).toBe(true)
    }
  })

  it('REDIRECTS 覆盖全部 7 个被合并的旧 key', () => {
    expect(Object.keys(REDIRECTS).sort()).toEqual(
      ['ai', 'applykit', 'calendar', 'coach', 'crawler', 'knowledge', 'square'].sort(),
    )
  })
})
