import { describe, expect, it } from 'vitest'

import { CRAWLER_PREFS_DEFAULT, CRAWLER_PREFS_KEY, parseCrawlerPrefs, serializeCrawlerPrefs } from '../crawlTask'

/**
 * 抓取页偏好的解析：这些都是**真实会发生的输入** —— 用户升级后站点表变了、localStorage 被
 * 别的版本写坏、隐私模式禁掉存储。判据只有一条：**坏数据绝不能把抓取页搞炸**，最差退化成默认值。
 */
const KNOWN = ['hikvision', 'tencent', 'meituan']

describe('抓取页偏好（localStorage）', () => {
  it('空 / 坏 JSON / 不是对象 → 默认值', () => {
    expect(parseCrawlerPrefs(null, KNOWN)).toEqual(CRAWLER_PREFS_DEFAULT)
    expect(parseCrawlerPrefs(undefined, KNOWN)).toEqual(CRAWLER_PREFS_DEFAULT)
    expect(parseCrawlerPrefs('', KNOWN)).toEqual(CRAWLER_PREFS_DEFAULT)
    expect(parseCrawlerPrefs('{不是 json', KNOWN)).toEqual(CRAWLER_PREFS_DEFAULT)
    expect(parseCrawlerPrefs('"字符串"', KNOWN)).toEqual(CRAWLER_PREFS_DEFAULT)
    expect(parseCrawlerPrefs('42', KNOWN)).toEqual(CRAWLER_PREFS_DEFAULT)
  })

  it('站点 id 已不存在 → 只留还认识的（站点表会变）', () => {
    const p = parseCrawlerPrefs(JSON.stringify({ sites: ['hikvision', '已经删掉的站点', 'tencent'] }), KNOWN)
    expect(p.sites).toEqual(['hikvision', 'tencent'])
  })

  it('字段类型全不对 → 各自退回默认，不连坐', () => {
    const p = parseCrawlerPrefs(
      JSON.stringify({ sites: 'hikvision', keyword: 123, pages: 'x', limit: null, mode: 'bogus' }),
      KNOWN,
    )
    expect(p).toEqual(CRAWLER_PREFS_DEFAULT)
  })

  it('页数 / 条数越界或非整数 → clamp 到合法区间（和输入框的 min/max 一致）', () => {
    expect(parseCrawlerPrefs(JSON.stringify({ pages: 999 }), KNOWN).pages).toBe(20)
    expect(parseCrawlerPrefs(JSON.stringify({ pages: 0 }), KNOWN).pages).toBe(1)
    expect(parseCrawlerPrefs(JSON.stringify({ pages: 2.6 }), KNOWN).pages).toBe(3)
    expect(parseCrawlerPrefs(JSON.stringify({ limit: 9999 }), KNOWN).limit).toBe(300)
    expect(parseCrawlerPrefs(JSON.stringify({ limit: -5 }), KNOWN).limit).toBe(1)
  })

  it('关键词超长要截断（localStorage 不是堆放处）', () => {
    expect(parseCrawlerPrefs(JSON.stringify({ keyword: 'x'.repeat(500) }), KNOWN).keyword.length).toBe(100)
  })

  it('序列化 → 解析 一轮回来一致，且只存这五个字段', () => {
    const prefs = { sites: ['tencent'], keyword: '后端实习', pages: 3, limit: 45, mode: 'intern' as const }
    expect(parseCrawlerPrefs(serializeCrawlerPrefs(prefs), KNOWN)).toEqual(prefs)
    expect(Object.keys(JSON.parse(serializeCrawlerPrefs(prefs))).sort()).toEqual(['keyword', 'limit', 'mode', 'pages', 'sites'])
  })

  it('storage key 用 wb_ 前缀（与黑名单 / 模型选择同一约定）', () => {
    expect(CRAWLER_PREFS_KEY.startsWith('wb_')).toBe(true)
  })
})
