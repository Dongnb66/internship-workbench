import { describe, expect, it } from 'vitest'

import { buildCrawlArgs, collectJobs } from '../lib/args.mjs'

// 白名单来源与抓取器站点表的最小代表集（完整同步契约已在 src/lib/__tests__/crawlSites.test.ts 钉住）
const SITES = [
  { id: 'tencent', urlOnly: false },
  { id: 'boss', urlOnly: false },
  { id: 'feishu', urlOnly: true },
  { id: 'generic', urlOnly: true },
]

describe('buildCrawlArgs 参数校验（安全边界）', () => {
  it('正常请求 → 有界参数 + 白名单内站点', () => {
    const r = buildCrawlArgs({ sites: ['tencent', 'boss'], keyword: '后端', pages: 2, limit: 30, mode: 'intern' }, SITES)
    expect(r.ok).toBe(true)
    expect(r.args).toEqual(['run.mjs', '--keyword', '后端', '--pages', '2', '--limit', '30', '--mode', 'intern', '--site', 'tencent', '--site', 'boss'])
  })

  it('未知站点 id 拒绝（白名单）', () => {
    const r = buildCrawlArgs({ sites: ['evil-site'] }, SITES)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未知站点')
  })

  it('urlOnly 站点不允许出现在 sites', () => {
    const r = buildCrawlArgs({ sites: ['feishu'] }, SITES)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('地址模式')
  })

  it('地址必须 http(s) 开头', () => {
    const r = buildCrawlArgs({ urls: [{ siteId: 'generic', url: 'file:///c:/windows' }] }, SITES)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('http')
  })

  it('sites 与 urls 全空拒绝', () => {
    expect(buildCrawlArgs({ sites: [], urls: [] }, SITES).ok).toBe(false)
    expect(buildCrawlArgs({}, SITES).ok).toBe(false)
    expect(buildCrawlArgs(null, SITES).ok).toBe(false)
  })

  it('数值越界收进钳位（不报错），非法数值用默认', () => {
    const r = buildCrawlArgs({ sites: ['tencent'], pages: 999, limit: -5, mode: 'nope' }, SITES)
    expect(r.ok).toBe(true)
    expect(r.args).toContain('20') // pages 钳到 20
    expect(r.args).toContain('1') // limit 钳到 1
    expect(r.args).not.toContain('--mode') // 非法 mode 回落 all，不产生参数
  })

  it('站点数超上限拒绝', () => {
    const many = Array.from({ length: 11 }, () => 'tencent')
    expect(buildCrawlArgs({ sites: many }, SITES).ok).toBe(false)
  })

  it('关键词超长拒绝', () => {
    const r = buildCrawlArgs({ sites: ['tencent'], keyword: '长'.repeat(41) }, SITES)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('关键词')
  })

  it('默认参数不产生噪音（pages=1/limit=60/mode=all 时不出现在命令里）', () => {
    const r = buildCrawlArgs({ sites: ['tencent'], keyword: '前端' }, SITES)
    expect(r.args).toEqual(['run.mjs', '--keyword', '前端', '--site', 'tencent'])
  })
})

describe('collectJobs 产出汇总', () => {
  const files = [
    { name: 'a.json', content: JSON.stringify({ jobs: [
      { company: 'A 公司', title: '后端实习', city: '深圳', salary: '200/天', url: 'https://x/1', raw: 'JD 原文 A' },
      { company: 'A 公司', title: '后端实习', city: '深圳' }, // 批内重复
      { company: '', title: '无公司' }, // 脏数据
    ] }) },
    { name: 'b.json', content: 'not-json{{{', }, // 坏文件跳过
    { name: 'c.json', content: JSON.stringify([{ company: 'B 公司', title: '前端实习' }]) }, // 裸数组形态
  ]

  it('跨文件去重、跳坏文件、字段归一', async () => {
    const jobs = await collectJobs('/fake', async () => files)
    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toEqual({ company: 'A 公司', title: '后端实习', city: '深圳', salary: '200/天', url: 'https://x/1', jd_text: 'JD 原文 A' })
    expect(jobs[1].company).toBe('B 公司')
  })
})
