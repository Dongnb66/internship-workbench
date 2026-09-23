/**
 * 契约测试：抓取器产出的东西，工作台必须吃得下去。
 *
 * 这是全仓最重要的一组测试。抓取器和前端是两份独立的实现，它们之间只有一个接口 ——
 * 抓取器写出的 JSON。这个接口一旦错位（键名、来源标签、去重键算法、岗位类型取值），
 * 症状是「导入成功但字段全空」或者「看起来正常但岗位池里出现一堆假重复」，
 * 两者都不会报错，只会安静地把数据弄脏。所以在这里逐条钉死。
 */

import { describe, expect, it } from 'vitest'

import { CHANNELS, JOB_TYPES as UI_JOB_TYPES } from '../../src/lib/constants.ts'
import {
  dedupeKey as uiDedupeKey,
  looksLikeCollectorJson,
  normalizeJobType as uiNormalizeJobType,
  parseCollectorJson,
} from '../../src/lib/import.ts'
import {
  JOB_TYPES as CRAWLER_JOB_TYPES,
  dedupeKey as crawlerDedupeKey,
  makePayload,
  normalizeJobType as crawlerNormalizeJobType,
} from '../lib/normalize.mjs'
import { BOARD_COMPANY, SITES, detectSiteByUrl } from '../sites.mjs'

describe('常量口径', () => {
  it('岗位类型取值两边完全一致（否则前端筛选器会漏掉抓进来的岗位）', () => {
    expect(CRAWLER_JOB_TYPES).toEqual(UI_JOB_TYPES)
  })

  it('每个站点的 channel 都是工作台认识的渠道', () => {
    for (const site of SITES) {
      expect(CHANNELS, `${site.id} 的 channel「${site.channel}」不在 CHANNELS 里`).toContain(site.channel)
    }
  })
})

describe('站点表自身一致性', () => {
  it('站点 id 不重复（重复 id 会让 findSite 永远只认第一个）', () => {
    const ids = SITES.map((s) => s.id)
    expect(new Set(ids).size, `重复的 id：${ids.join(', ')}`).toBe(ids.length)
  })

  it('BOARD_COMPANY 的每个键都对应一个真实站点（否则是打错字的死映射）', () => {
    const ids = new Set(SITES.map((s) => s.id))
    const orphans = Object.keys(BOARD_COMPANY).filter((id) => !ids.has(id))
    expect(orphans, `这些公司名映射没有对应站点：${orphans.join(', ')}`).toEqual([])
  })

  it('每个站点要么有 listUrl，要么明确要求用 --url 传地址', () => {
    for (const site of SITES) {
      if (site.id === 'generic') continue
      const usable = Boolean(site.listUrl)
      const needsUrl = /--url/.test(site.notes ?? '')
      expect(usable || needsUrl, `${site.id} 既没有 listUrl 也没说明要用 --url`).toBe(true)
    }
  })

  it('拼出「单公司招聘板」的站点必须给出公司名（页面里读不到，只能靠站点表）', () => {
    // 这些站点是某一家公司自己的招聘门户，页面里没有公司字段。
    // 漏了 BOARD_COMPANY 的症状很隐蔽：公司名会变成「更新于2026/08/17」这类卡片正文行。
    const singleCompanyBoards = ['tencent', 'bytedance', 'huawei', 'alibaba', 'baidu', 'meituan', 'jd', 'netease', 'xiaomi', 'kuaishou', 'mihoyo', 'iflytek', 'byd', 'zte', 'pdd', 'huatai', 'cmb', 'hikvision', 'sf', 'lenovo']
    const ids = new Set(SITES.map((s) => s.id))
    for (const id of singleCompanyBoards) {
      if (!ids.has(id)) continue
      expect(BOARD_COMPANY[id], `${id} 是单公司招聘板，但 BOARD_COMPANY 里没有它`).toBeTruthy()
    }
  })

  it('多公司平台不硬塞公司名（塞了会让所有岗位都记成同一家公司）', () => {
    for (const id of ['boss', 'shixiseng', 'nowcoder', 'moka', 'feishu', 'beisen', 'generic']) {
      expect(BOARD_COMPANY[id], `${id} 是多公司平台，不应出现在 BOARD_COMPANY 里`).toBeUndefined()
    }
  })

  it('detectSiteByUrl 能把各站点自己的域名认回来', () => {
    const cases = [
      ['https://join.qq.com/post.html', 'tencent'],
      ['https://zhaopin.meituan.com/web/campus', 'meituan'],
      ['https://campus.iflytek.com/', 'iflytek'],
      ['https://job.byd.com/', 'byd'],
      ['https://careers.pinduoduo.com/campus/grad', 'pdd'],
      ['https://career.cmbchina.com/', 'cmb'],
    ]
    for (const [url, id] of cases) {
      expect(detectSiteByUrl(url)?.id, url).toBe(id)
    }
  })
})

describe('站点验证标注', () => {
  it('verified 只取三个约定值（写错了等于没标）', () => {
    const ALLOWED = new Set(['live', 'offline', undefined])
    for (const site of SITES) {
      expect(ALLOWED.has(site.verified), `${site.id} 的 verified 是「${site.verified}」`).toBe(true)
    }
  })

  it('标了 live 的站点必须在 notes 里写清实跑结论（注释不算，得是可读取的字段）', () => {
    // 这条拦的是「顺手把 offline 改成 live 让自己好交代」。
    // live 是给用户看的承诺：看到 live 就敢直接拿它抓。
    // ⚠️ 判据必须落在 notes 上 —— 写进 `//` 注释是读不到的，等于没写。
    for (const site of SITES) {
      if (site.verified !== 'live') continue
      expect(
        /实跑/.test(String(site.notes ?? '')),
        `${site.id} 标了 live，但 notes 里没有实跑结论（注释里写的不算）`,
      ).toBe(true)
    }
  })

  it('标了 offline 的站点要在 notes 里说清为什么（否则没人知道该修什么）', () => {
    for (const site of SITES) {
      if (site.verified !== 'offline') continue
      expect(
        /实跑|未验|只在本地夹具/.test(String(site.notes ?? '')),
        `${site.id} 标了 offline，但 notes 里没说明原因，后来的人不知道该修哪里`,
      ).toBe(true)
    }
  })

  it('从 live 降级到 offline 时必须写明「抓到了什么但不是岗位」（防止把理由一起删掉）', () => {
    // 这条拦的是本轮真跑踩到的坑：cmb 抓到 23 条、huatai 4 条、sf 3 条，
    // 数量看着漂亮就容易被当成 live，实际全是员工风采轮播 / 招聘新闻稿 / 方向栏目名。
    // 降级时若只说「不可用」，后来的人还会再试一次同样的 URL，所以必须留下「抓到了啥」。
    const DOWNGRADED = ['cmb', 'huatai', 'sf']
    for (const id of DOWNGRADED) {
      const site = SITES.find((s) => s.id === id)
      expect(site, `站点表里找不到 ${id}`).toBeTruthy()
      expect(site.verified, `${id} 已确认抓到的东西不是岗位，应标 offline`).toBe('offline')
      expect(
        /不是岗位|非岗位|不是具体岗位|栏目名|新闻稿|轮播/.test(String(site.notes ?? '')),
        `${id} 标了 offline，但没写清「抓到的到底是不是岗位」—— 光说不可用，下一个人还会再试一遍`,
      ).toBe(true)
    }
  })
})

describe('去重键算法两端一致', () => {
  const cases = [
    ['示例科技', '后端开发实习生'],
    ['示例科技有限公司', '后端开发'],
    ['腾讯', '2027 届校园招聘·AI 应用开发'],
    ['有 限 公 司（北京）', '测试-工程师_岗'],
    ['', ''],
    ['A', ''],
  ]

  it('同一组公司与岗位名，两端算出同一个键', () => {
    for (const [company, title] of cases) {
      expect(crawlerDedupeKey(company, title), `${company} / ${title}`).toBe(uiDedupeKey(company, title))
    }
  })
})

describe('岗位类型归一化两端一致', () => {
  const cases = ['实习', '日常实习', '暑期实习', '校招', '社招', '2027 届秋季校园招聘', '日常实习岗', '社会招聘', '看不懂的', '']

  it('同一段输入两端归一化结果相同', () => {
    for (const value of cases) {
      expect(crawlerNormalizeJobType(value), value).toBe(uiNormalizeJobType(value))
    }
  })
})

describe('抓取器产出 → 工作台导入', () => {
  const payload = makePayload({
    siteId: 'tencent',
    siteName: '腾讯招聘 · 前端',
    channel: '官网投递',
    pageUrl: 'https://join.qq.com/post.html?query=%E5%89%8D%E7%AB%AF',
    pageTitle: '腾讯招聘',
    jobs: [
      {
        company: '示例·星野智能科技',
        title: 'AI Agent 应用开发实习生',
        city: '广州',
        salary: '200-300元/天',
        url: 'https://join.qq.com/post_detail.html?postid=1',
        raw: '岗位职责\n1. 参与多智能体应用开发，基于 LangGraph 编排工具调用。\n任职要求\n1. 熟悉 Python、FastAPI。',
      },
      {
        company: '示例·云图数据有限公司',
        title: '2027 届校园招聘·后端开发',
        city: '深圳',
        salary: '',
        url: 'https://join.qq.com/post_detail.html?postid=2',
        raw: '',
      },
    ],
    now: new Date('2026-09-23T09:07:00Z'),
  })

  it('被识别成采集数据而不是普通文本', () => {
    expect(looksLikeCollectorJson(JSON.stringify(payload))).toBe(true)
    expect(looksLikeCollectorJson(payload.text)).toBe(false)
  })

  it('每条都变成可用草稿，字段落点正确', () => {
    const drafts = parseCollectorJson(JSON.stringify(payload))
    expect(drafts).toHaveLength(2)
    const [first, second] = drafts ?? []
    expect(first.company).toBe('示例·星野智能科技')
    expect(first.title).toBe('AI Agent 应用开发实习生')
    expect(first.city).toBe('广州')
    expect(first.salary).toBe('200-300元/天')
    expect(first.url).toBe('https://join.qq.com/post_detail.html?postid=1')
    expect(first.jd_text).toContain('LangGraph')
    expect(second.title).toBe('2027 届校园招聘·后端开发')
    expect(second.job_type).toBe('校招')
  })

  it('来源用产出方写的 channel，而不是按域名瞎猜', () => {
    const drafts = parseCollectorJson(JSON.stringify(payload)) ?? []
    expect(drafts.length).toBeGreaterThan(0)
    expect(drafts.every((d) => d.source === '官网投递')).toBe(true)
  })

  it('只有 JD 没有标题的条目也能进池（标题留空由人工补）', () => {
    const drafts = parseCollectorJson(
      JSON.stringify({ source: 'x', jobs: [{ company: '某公司', title: '', raw: '职责：写代码' }] }),
    )
    expect(drafts).toHaveLength(1)
    expect(drafts?.[0].title).toBe('')
  })

  it('形状不对时返回 null，不发散', () => {
    expect(parseCollectorJson('{"jobs": "不是数组"}')).toBe(null)
    expect(parseCollectorJson('不是 JSON')).toBe(null)
  })

  it('扩展产出的 JSON（没有 channel 字段）仍按域名兜底', () => {
    const extensionPayload = {
      source: '实习工作台采集器',
      page: { url: 'https://www.zhipin.com/web/geek/job', site: 'www.zhipin.com' },
      jobs: [{ company: 'a', title: 'b', raw: 'c', url: 'd', city: '深圳', salary: '1' }],
    }
    expect(parseCollectorJson(JSON.stringify(extensionPayload))?.[0].source).toBe('BOSS直聘')
  })
})
