/**
 * 契约测试：抓取器产出的东西，工作台必须吃得下去。
 *
 * 这是全仓最重要的一组测试。抓取器和前端是两份独立的实现，它们之间只有一个接口 ——
 * 抓取器写出的 JSON。这个接口一旦错位（键名、来源标签、去重键算法、岗位类型取值），
 * 症状是「导入成功但字段全空」或者「看起来正常但岗位池里出现一堆假重复」，
 * 两者都不会报错，只会安静地把数据弄脏。所以在这里逐条钉死。
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  CHANNELS,
  GREETING_RULES,
  JOB_TYPES as UI_JOB_TYPES,
  PROFILE_TEMPLATE,
} from '../../src/lib/constants.ts'
import {
  dateOnly as webDateOnly,
  daysLeft as webDaysLeft,
  fmtDate as webFmtDate,
  fmtDateTime as webFmtDateTime,
} from '../../src/lib/format.ts'
import { paceStatus as webPaceStatus } from '../../src/lib/pace.ts'
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

/**
 * Web 端与小程序端是两份手写的常量副本，没有任何工具保证它们同步。
 * 这里用 `createRequire` 直接加载小程序的 CommonJS 模块来逐项比对 ——
 * 踩过的坑：小程序 CHANNELS 少了「浏览器采集」「岗位广场」两项，导致
 * jobs.js 里 `indexOf` 返回 -1、picker 落到第 0 项、编辑一次就把真实来源
 * 静默改成「BOSS直聘」。这类错位不会报错，只会安静地篡改数据。
 */
describe('Web ↔ 小程序 常量口径', () => {
  const require = createRequire(import.meta.url)
  const MP_ROOT = fileURLToPath(new URL('../../miniprogram/utils/', import.meta.url))
  const mpConstants = require(path.join(MP_ROOT, 'constants.js'))

  it('CHANNELS 逐项一致且顺序一致（顺序变了 picker 下标就会指错）', () => {
    expect(mpConstants.CHANNELS).toEqual(CHANNELS)
  })

  it('JOB_TYPES 逐项一致且顺序一致', () => {
    expect(mpConstants.JOB_TYPES).toEqual(UI_JOB_TYPES)
  })

  it('PROFILE_TEMPLATE 的键集合两端一致（漏键会让一键填入少字段）', () => {
    const webKeys = Object.keys(PROFILE_TEMPLATE).sort()
    const mpKeys = Object.keys(mpConstants.PROFILE_TEMPLATE).sort()
    expect(mpKeys).toEqual(webKeys)
  })

  it('PROFILE_TEMPLATE 的可验证数字两端一致（518 条测试口径不能漂）', () => {
    const nums = (s) => String(s).match(/\d+/g) ?? []
    expect(nums(mpConstants.PROFILE_TEMPLATE.self_intro)).toEqual(nums(PROFILE_TEMPLATE.self_intro))
    expect(nums(mpConstants.PROFILE_TEMPLATE.resume_summary)).toEqual(nums(PROFILE_TEMPLATE.resume_summary))
  })

  it('GREETING_RULES 两端都钉住了完整的拆分数字（只写总数挡不住模型自己编分解）', () => {
    // 踩过的坑：小程序这份只写了「合计 518 条测试」，Web 端才是完整的
    // 「518 条测试（156 + 71 + 79 + 48 + 129 + 35）、9 条评测」。
    // 只断言出现过「518」是挡不住的 —— 拆分项一个不少才算钉住。
    // 6 个仓库的测试数必须逐个出现在规则里，模型没有空间自行加减。
    // （口径沿革：2026-09-30 依架构裁决 X1 由 508 = 146+… 改为 518，主项目 146→156，发起人已点头。）
    const PARTS = ['518', '156', '71', '79', '48', '129', '35']
    for (const source of [GREETING_RULES, mpConstants.GREETING_RULES]) {
      for (const n of PARTS) {
        expect(source, `打招呼纪律里缺了测试数拆分项 ${n}`).toContain(n)
      }
    }
  })

  it('小程序常量文件导出的每一项都被 Web 端认识（防拼写漂移）', () => {
    // 只做「小程序不该有 Web 端不认识的常量」这一个方向：
    // 反向（Web 有、小程序没有）不一定都是 bug —— 小程序未实现的页面不需要那些常量。
    // 但小程序**导出了**的，必须是 Web 端真实存在的口径，否则说明有人改错了名字。
    const known = new Set([
      'STAGES', 'CHANNELS', 'JOB_TYPES', 'INDUSTRIES', 'PRIORITIES', 'DIMS',
      'TASK_KINDS', 'PROFILE_TEMPLATE', 'GREETING_RULES', 'stageLabel', 'stageColor',
    ])
    for (const key of Object.keys(mpConstants)) {
      expect(known.has(key), `小程序 constants.js 导出了 Web 端不认识的「${key}」`).toBe(true)
    }
  })

  it('小程序常量文件里声明的顶层 const 都被导出了（防「写了但忘了导出」）', () => {
    // 踩过的坑：往 constants.js 里加了 INDUSTRIES，却没加进 module.exports，
    // 结果是页面 `constants.INDUSTRIES` 拿到 undefined —— 不报错，只是筛选项空了。
    // 这里直接读源码，比对「声明了哪些顶层 const」与「导出了哪些」。
    const src = readFileSync(path.join(MP_ROOT, 'constants.js'), 'utf8')
    const declared = [...src.matchAll(/^const ([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1])
    expect(declared.length, '没解析到任何顶层常量，正则可能失效了').toBeGreaterThan(0)
    const exported = new Set(Object.keys(mpConstants))
    const forgotten = declared.filter((name) => !exported.has(name))
    expect(forgotten, `这些常量声明了却没导出：${forgotten.join(', ')}`).toEqual([])
  })
})

/**
 * 日期解析两端必须同结果。
 *
 * 踩过的坑：小程序 `format.js` 先 `replace(/-/g,'/')` 再剥掉 `T...` 后缀，
 * 等于丢掉时区、强制按本地时间解释；Web 端是 `new Date(value)`，带 Z 时按 UTC。
 * 于是同一个 deadline 两端能差一整天 —— 直接决定「剩 N 天」与「是否 3 天内截止」
 * 两个用户可见的判定。deadline 存成时间戳时这个偏差就会出现。
 */
describe('Web ↔ 小程序 日期解析', () => {
  const require = createRequire(import.meta.url)
  const mpFormat = require(path.join(fileURLToPath(new URL('../../miniprogram/utils/', import.meta.url)), 'format.js'))

  // 真实输入：deadline / due_at 这类字段可能是纯日期串，也可能是带 Z 的时间戳。
  // 覆盖纯日期串、带 Z 的时间戳、带毫秒的、跨月跨年的边界。
  const CASES = [
    '2026-09-25',
    '2026-09-25T00:00:00.000Z',
    '2026-09-25T16:00:00.000Z',
    '2026-12-31T23:59:59.999Z',
    '2027-01-01T00:00:00.000Z',
    '2026-03-01',
  ]

  // fmtDateTime 只用于展示**时间戳**（sent_at / scheduled_at / created_at / new Date().toISOString()），
  // 全仓没有一处拿它格式化纯日期串。所以这里只喂带时间部分的输入 ——
  // 对着「纯日期串」比对 fmtDateTime 等于测一条永不执行的分支，
  // 而 Web 端把 '2026-09-25' 解析成 UTC 后显示 08:00，本身也是个不该扩散的怪癖。
  const DATE_TIME_CASES = CASES.filter((v) => v.includes('T'))

  it('fmtDate 两端同结果（用户看到的截止日不能两边不一样）', () => {
    for (const value of CASES) {
      expect(mpFormat.fmtDate(value), `fmtDate(${value})`).toBe(webFmtDate(value))
    }
  })

  it('fmtDateTime 两端同结果', () => {
    for (const value of DATE_TIME_CASES) {
      expect(mpFormat.fmtDateTime(value), `fmtDateTime(${value})`).toBe(webFmtDateTime(value))
    }
  })

  it('daysLeft 两端同结果（「剩 N 天」与 3 天内截止标记的依据）', () => {
    for (const value of CASES) {
      expect(mpFormat.daysLeft(value), `daysLeft(${value})`).toBe(webDaysLeft(value))
    }
  })

  it('空值与坏值两端都退化，不抛异常', () => {
    for (const value of [null, undefined, '', '不是日期']) {
      expect(mpFormat.fmtDate(value), `fmtDate(${String(value)})`).toBe(webFmtDate(value))
      expect(mpFormat.daysLeft(value), `daysLeft(${String(value)})`).toBe(webDaysLeft(value))
    }
  })

  it('dateOnly 两端同结果（编辑表单回填截止日的依据）', () => {
    // 这条钉的是「回填必须取本地日历日」：两边任何一边退回 slice(0,10)（UTC 日期），
    // 带 16:00Z 以后时间戳的用例就会差一天——用户不改直接保存，截止日被悄悄提前
    for (const value of CASES) {
      expect(mpFormat.dateOnly(value), `dateOnly(${value})`).toBe(webDateOnly(value))
    }
    expect(mpFormat.dateOnly('不是日期')).toBe(webDateOnly('不是日期'))
  })

  it('paceStatus 的「距上次发送多久」两端同结果（决定冷却是否放行）', () => {
    // 这条最容易出错：小程序原先自己剥 T/时区后缀，会把 UTC 发送时间当本地时间，
    // 算出的小时数偏掉，于是「距上次发送仅 N 分钟」的拦截时松时紧。
    const require2 = createRequire(import.meta.url)
    const mpPace = require2(path.join(fileURLToPath(new URL('../../miniprogram/utils/', import.meta.url)), 'pace.js'))
    const now = new Date('2026-09-23T10:00:00.000Z')
    const config = { dailyLimit: 8, window: '09:00-21:00', minIntervalMin: 30 }
    const messages = [
      { direction: 'out', sent_at: '2026-09-23T09:40:00.000Z', content: '你好' },
      { direction: 'out', sent_at: '2026-09-22T09:00:00.000Z', content: '旧消息' },
    ]
    const web = webPaceStatus(messages, config, now)
    const mp = mpPace.paceStatus(messages, config, now)
    expect(mp.sentToday).toBe(web.sentToday)
    expect(mp.minutesSinceLast).toBe(web.minutesSinceLast)
    expect(mp.allowed).toBe(web.allowed)
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
