import { describe, expect, it } from 'vitest'

import {
  dedupeKey,
  expandTemplate,
  hostOf,
  makePayload,
  mergeDetail,
  mergeJobs,
  normalizeJobType,
  parseArgs,
  safeFileName,
  screenJobs,
  screenTitle,
  stamp,
  toText,
} from '../lib/normalize.mjs'
import { SITES, detectSiteByUrl, findSite } from '../sites.mjs'

const job = (over = {}) => ({ company: '示例科技', title: '后端开发实习生', city: '深圳', salary: '200/天', url: 'https://x.com/1', raw: 'JD', ...over })

describe('parseArgs', () => {
  it('支持 --key value 与 --key=value 两种写法', () => {
    const a = parseArgs(['--site', 'tencent', '--limit=15'])
    expect(a.sites).toEqual(['tencent'])
    expect(a.limit).toBe(15)
    const b = parseArgs(['--site=tencent'])
    expect(b.sites).toEqual(['tencent'])
  })

  it('可重复参数累加，单值参数取最后一次', () => {
    const a = parseArgs(['--keyword', '前端', '--keyword', '后端', '--pages', '1', '--pages', '3'])
    expect(a.keywords).toEqual(['前端', '后端'])
    expect(a.pages).toBe(3)
  })

  it('数字参数非法时退回默认值，不是 NaN', () => {
    const a = parseArgs(['--pages', 'abc', '--detail', '-1'])
    expect(a.pages).toBe(2)
    expect(a.detail).toBe(20)
  })

  it('布尔参数不带值，也支持 --flag=false', () => {
    expect(parseArgs(['--headed']).headed).toBe(true)
    expect(parseArgs(['--headed=false']).headed).toBe(false)
    expect(parseArgs(['--resume', '--purge']).resume).toBe(true)
    expect(parseArgs(['--resume', '--purge']).purge).toBe(true)
  })

  it('未知参数不抛错，但要能被调用方看到', () => {
    const a = parseArgs(['--site', 'tencent', '--nope', '33'])
    expect(a.sites).toEqual(['tencent'])
    expect(a.unknown).toEqual(['--nope'])
  })

  it('默认值就是文档里写的那些', () => {
    const a = parseArgs([])
    expect(a.pages).toBe(2)
    expect(a.limit).toBe(60)
    expect(a.detail).toBe(20)
    expect(a.delay).toBe(2600)
    expect(a.mode).toBe('all')
  })
})

describe('expandTemplate', () => {
  it('填关键词并做 URL 编码', () => {
    expect(expandTemplate('https://a.com/list?query={kw}', { kw: '前端 开发' })).toBe('https://a.com/list?query=%E5%89%8D%E7%AB%AF%20%E5%BC%80%E5%8F%91')
  })

  it('没给关键词时把整个参数摘掉，不留空 query', () => {
    expect(expandTemplate('https://a.com/list?query={kw}', { kw: '' })).toBe('https://a.com/list')
    expect(expandTemplate('https://a.com/list?query={kw}&city=1', { kw: '' })).toBe('https://a.com/list?city=1')
  })

  it('填页码', () => {
    expect(expandTemplate('https://a.com/p/{page}', { page: 3 })).toBe('https://a.com/p/3')
  })

  it('无占位符时原样返回', () => {
    expect(expandTemplate('https://a.com/x', { kw: 'a' })).toBe('https://a.com/x')
    expect(expandTemplate('', {})).toBe('')
  })
})

describe('screenTitle', () => {
  it('留下像岗位的标题', () => {
    expect(screenTitle('后端开发实习生').pass).toBe(true)
    expect(screenTitle('AI Agent 应用开发实习生').pass).toBe(true)
  })

  it('挡掉不像岗位的行', () => {
    expect(screenTitle('').pass).toBe(false)
    expect(screenTitle('首页 职位 我的').pass).toBe(false)
    expect(screenTitle('A'.repeat(80)).pass).toBe(false)
  })

  it('mode=intern 只留实习', () => {
    expect(screenTitle('后端开发实习生', { mode: 'intern' }).pass).toBe(true)
    expect(screenTitle('前端开发工程师', { mode: 'intern' })).toEqual({ pass: false, reason: '非实习标题（--mode intern）' })
    expect(screenTitle('资深后端开发实习生', { mode: 'intern' })).toEqual({ pass: false, reason: '带高级别标记（--mode intern）' })
    expect(screenTitle('后端开发专家（社招）', { mode: 'intern' }).pass).toBe(false)
  })

  it('mode=campus 收校招与实习', () => {
    expect(screenTitle('2028 届校园招聘·后端开发', { mode: 'campus' }).pass).toBe(true)
    expect(screenTitle('后端开发实习生', { mode: 'campus' }).pass).toBe(true)
    expect(screenTitle('后端开发工程师', { mode: 'campus' }).pass).toBe(false)
  })

  it('include / exclude 能生效', () => {
    expect(screenTitle('后端开发实习生', { include: ['前端'] }).pass).toBe(false)
    expect(screenTitle('前端开发实习生', { include: ['前端'] }).pass).toBe(true)
    expect(screenTitle('销售实习生', { exclude: ['销售'] }).pass).toBe(false)
  })
})

describe('screenJobs', () => {
  it('分开保留项与被挡原因', () => {
    const { kept, filtered, reasons } = screenJobs(
      [job(), job({ title: '首页 职位 我的' }), job({ title: '测试开发实习生' })],
      {},
    )
    expect(kept).toHaveLength(2)
    expect(filtered).toBe(1)
    expect(reasons[0][0]).toBe('标题不含岗位词')
  })
})

describe('dedupeKey / mergeJobs', () => {
  // 这组断言记录的是两端共用的既有行为，不是理想行为 —— 改任何一条都会同时影响
  // 前端「导入时查重」和抓取器「跨轮次去重」，所以先把现状钉住再谈要不要改。
  it('空白差异不影响去重键', () => {
    expect(dedupeKey('示例科技 有限公司', '后端开发实习生')).toBe(dedupeKey('示例科技有限公司', '后端开发实习生'))
  })

  it('抹掉实习/校招这类后缀', () => {
    expect(dedupeKey('A', '后端开发实习')).toBe(dedupeKey('A', '后端开发'))
  })

  it('已记录的限制：「实习生」只抹掉「实习」，会留下一个「生」', () => {
    // 所以「后端开发实习生」和「后端开发」不会互相去重 —— 这是刻意的保守选择：
    // 宁可漏判重复（人工在预览表里一眼能看出来），也不要错判重复把两个岗位吃掉。
    expect(dedupeKey('A', '后端开发实习生')).toBe(dedupeKey('A', '后端开发生'))
    expect(dedupeKey('A', '后端开发实习生')).not.toBe(dedupeKey('A', '后端开发'))
  })

  it('吞掉重复项并保留已有键', () => {
    const first = mergeJobs([], [job(), job({ title: '前端开发实习生' })])
    expect(first.fresh).toHaveLength(2)
    expect(first.keys).toHaveLength(2)

    const second = mergeJobs(first.keys, [job(), job({ title: '测试开发实习生' })])
    expect(second.fresh).toHaveLength(1)
    expect(second.dup).toBe(1)
  })

  it('公司名与岗位名都空时不参与去重，避免互相吃掉', () => {
    const r = mergeJobs([], [job({ company: '', title: '' }), job({ company: '', title: '' })])
    expect(r.fresh).toHaveLength(2)
  })
})

describe('mergeDetail', () => {
  it('详情页补上列表页缺的字段', () => {
    const merged = mergeDetail(job({ city: '', salary: '' }), { company: '', title: '', city: '北京', salary: '300/天', raw: '完整 JD' })
    expect(merged.city).toBe('北京')
    expect(merged.salary).toBe('300/天')
    expect(merged.company).toBe('示例科技')
    expect(merged.raw).toBe('完整 JD')
  })

  it('JD 正文一律以详情页为准', () => {
    expect(mergeDetail(job({ raw: '摘要' }), { raw: '正文' }).raw).toBe('正文')
  })

  it('没有详情时原样返回', () => {
    expect(mergeDetail(job(), null).title).toBe('后端开发实习生')
  })
})

describe('makePayload / toText', () => {
  const payload = makePayload({
    siteId: 'tencent',
    siteName: '腾讯招聘 · 前端',
    channel: '官网投递',
    pageUrl: 'https://join.qq.com/post.html',
    pageTitle: '腾讯招聘',
    jobs: [job()],
    now: new Date('2026-09-23T09:07:00Z'),
  })

  it('字段名与浏览器扩展的采集结果一致（parseCollectorJson 只认这套键）', () => {
    expect(Object.keys(payload.jobs[0]).sort()).toEqual(['city', 'company', 'raw', 'salary', 'title', 'url'])
    expect(payload.source).toContain('抓取器')
    expect(payload.channel).toBe('官网投递')
    expect(payload.page.site).toBe('join.qq.com')
    expect(payload.count).toBe(1)
  })

  it('文本形态与扩展同格式：公司/岗位/城市/薪资/链接/岗位原文', () => {
    for (const label of ['公司：示例科技', '岗位：后端开发实习生', '城市：深圳', '薪资：200/天', 'https://x.com/1', '岗位原文：']) {
      expect(payload.text).toContain(label)
    }
    expect(payload.text).toContain('# 采集自')
  })

  it('缺字段时输出空字符串而不是 undefined', () => {
    const p = makePayload({ jobs: [{ title: 'x' }] })
    expect(p.jobs[0].company).toBe('')
    expect(p.jobs[0].url).toBe('')
  })

  it('多个岗位之间用 --- 分隔，能被本地拆分逻辑重新认出条数', () => {
    const two = makePayload({ jobs: [job(), job({ title: '前端开发实习生' })] })
    expect(two.text.split('\n---\n')).toHaveLength(2)
  })

  it('一条都没有时只输出表头，不留半截块', () => {
    const empty = makePayload({ pageUrl: 'https://a.com', jobs: [] })
    expect(empty.count).toBe(0)
    expect(empty.text).not.toContain('岗位原文：')
    expect(toText(undefined)).toContain('# 采集自')
  })
})

describe('工具函数', () => {
  it('hostOf 对非法地址返回空串而不是抛错', () => {
    expect(hostOf('https://a.b.com/x')).toBe('a.b.com')
    expect(hostOf('not a url')).toBe('')
    expect(hostOf('')).toBe('')
  })

  it('stamp 是文件名安全的', () => {
    expect(stamp(new Date(2026, 8, 23, 9, 7))).toBe('2026-09-23_0907')
  })

  it('safeFileName 去掉路径分隔符与奇怪字符', () => {
    expect(safeFileName('腾讯招聘 · 前端')).not.toMatch(/[\\/:*?"<>|\s·]/)
    expect(safeFileName('')).toBe('output')
  })
})

describe('normalizeJobType', () => {
  it('与前端口径一致', () => {
    expect(normalizeJobType('实习')).toBe('实习')
    expect(normalizeJobType('暑期实习')).toBe('暑期实习')
    expect(normalizeJobType('2027 届秋季校园招聘')).toBe('校招')
    expect(normalizeJobType('日常实习岗')).toBe('日常实习')
    expect(normalizeJobType('社会招聘')).toBe('社招')
    expect(normalizeJobType('看不懂的')).toBe('实习')
  })
})

describe('站点表', () => {
  it('每个站点的 channel 都落在前端 CHANNELS 里', () => {
    const allowed = ['BOSS直聘', '实习僧', '官网投递', '内推', '牛客', '其它', '浏览器采集']
    for (const s of SITES) expect(allowed, `${s.id} 的 channel 非法`).toContain(s.channel)
  })

  it('id 唯一且必填字段齐全', () => {
    const ids = SITES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SITES) {
      expect(s.name).toBeTruthy()
      expect(['auto', 'query', 'next', 'more', 'scroll', 'none']).toContain(s.strategy)
      expect(typeof s.needsLogin).toBe('boolean')
    }
  })

  it('按域名反查', () => {
    expect(detectSiteByUrl('https://www.zhipin.com/web/geek/job')?.id).toBe('boss')
    expect(detectSiteByUrl('https://join.qq.com/post.html')?.id).toBe('tencent')
    expect(detectSiteByUrl('https://abc.mokahr.com/campus-recruitment/x')?.id).toBe('moka')
    expect(detectSiteByUrl('https://no-such-site.example.com/') ?? null).toBe(null)
  })

  it('findSite 对大小写与空格宽容，未知 id 返回 null', () => {
    expect(findSite(' Tencent ')?.id).toBe('tencent')
    expect(findSite('nope')).toBe(null)
  })
})
