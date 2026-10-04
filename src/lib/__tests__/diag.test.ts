import { describe, expect, it } from 'vitest'
import { diagEnabled, formatOverflow } from '../diag'

describe('?diag=1：把版式问题自报给库，省掉 devtools', () => {
  it('只认 ?diag=1，不误命中', () => {
    expect(diagEnabled('?diag=1')).toBe(true)
    expect(diagEnabled('?a=1&diag=1')).toBe(true)
    expect(diagEnabled('?diag=10')).toBe(false)
    expect(diagEnabled('?xdiag=1')).toBe(false)
    expect(diagEnabled('')).toBe(false)
  })
  it('摘要包含视口/滚动宽度/系统与最宽的几个元素，且有长度上限', () => {
    const s = formatOverflow({ viewport: 390, scroll: 430, os: 'mobile', worst: [
      { name: 'table.tbl', width: 420 },
      { name: 'div.card', width: 401 },
    ] })
    expect(s).toContain('vw=390')
    expect(s).toContain('sw=430')
    expect(s).toContain('os=mobile')
    expect(s).toContain('table.tbl(420)')
  })
  it('没有超宽元素时如实说明；元素多了会被截断', () => {
    expect(formatOverflow({ viewport: 390, scroll: 390, os: 'mobile', worst: [] })).toContain('无超宽元素')
    const many = Array.from({ length: 30 }, (_, i) => ({ name: 'div.c' + i, width: 500 + i }))
    expect(formatOverflow({ viewport: 390, scroll: 900, os: 'mobile', worst: many }).length).toBeLessThanOrEqual(240)
  })
})
