/**
 * 契约测试：OfferBiu 源产出的 JSON，工作台必须吃得下去，且**不能丢截止日**。
 *
 * 这条契约有两端：`crawler/lib/normalize.mjs` 的 makePayload 写 deadline，
 * `src/lib/import.ts` 的 parseCollectorJson 读 deadline。
 * 中间断掉的症状是沉默的：导入成功、岗位都在，但**截止日全空** ——
 * 概览页的临近截止待办因此永远是空的，没人会想到是"字段在导入时被丢了"。
 * （本轮修的就是这个：parseCollectorJson 原本把 deadline 写死成 ''。）
 *
 * 夹具用的是**真实 API 返回的形状**（2026-09-25 实测 offerbiu.com/api/recruitment/postings），
 * 不是照文档编的 —— 字段名写错的契约测试等于没写。
 */

import { describe, expect, it } from 'vitest'

import { parseCollectorJson } from '../../src/lib/import.ts'
import { dateOnlyOf, makePayload } from '../lib/normalize.mjs'
import { mapOfferbiuItem, splitPositions, toOfferbiuPayload } from '../sources/offerbiu.mjs'

/** 一条真实返回（已删去长 URL 的查询串，字段名与取值形态保持原样） */
const REAL_ITEM = {
  id: 'rec-2027-e372189e06e39486f35abf33',
  companyId: 'rc-重庆机场集团所属企业信息科技公司',
  seasonYear: 2027,
  sourceName: 'campus-2027',
  companyName: '重庆机场集团所属企业信息科技公司',
  companyNature: '央国企',
  industry: 'IT/互联网/游戏/电商',
  industryGroupCodes: ['internet-tech', 'consumer-retail'],
  recruitType: '秋招',
  targetYears: [2027],
  locations: ['重庆'],
  positionsText: '系统操作员',
  deadlineType: 'DATE',
  deadlineAt: '2026-10-08',
  deadlineText: '2026/10/08',
  announcementUrl: 'https://gzw.cq.gov.cn/gqzp/202609/t20260918_16097226.html',
  applyUrl: 'https://we.51job.com/xyzlogin?ctmid=DAD9A54F',
  status: 'active',
  visibilityTier: 'public',
}

describe('OfferBiu 单条映射', () => {
  it('真实记录映射后字段齐全，且带上结构化截止日', () => {
    const job = mapOfferbiuItem(REAL_ITEM)
    expect(job.company).toBe('重庆机场集团所属企业信息科技公司')
    expect(job.title).toBe('系统操作员')
    expect(job.city).toBe('重庆')
    expect(job.url).toBe(REAL_ITEM.applyUrl)
    expect(job.deadline).toBe('2026-10-08')
    // 溯源字段：隔一个月回来能核对这条是谁带来的
    expect(job.offerbiu_id).toBe(REAL_ITEM.id)
  })

  it('没有完整 JD 正文时如实写明，不伪造一段空的岗位描述', () => {
    const job = mapOfferbiuItem(REAL_ITEM)
    expect(job.raw).toContain('不含完整 JD 正文')
    // 但结构化信息要进正文，人才看得懂这一条是什么
    expect(job.raw).toContain('央国企')
    expect(job.raw).toContain('面向届数：2027')
    expect(job.raw).toContain('投递截止：2026/10/08')
    expect(job.raw).toContain(REAL_ITEM.announcementUrl)
  })

  it('缺 applyUrl 时退回官方公告链接，而不是留一个点不开的空链接', () => {
    const job = mapOfferbiuItem({ ...REAL_ITEM, applyUrl: '' })
    expect(job.url).toBe(REAL_ITEM.announcementUrl)
  })

  it('公司名与岗位名都为空 → 丢弃，不产出空壳岗位', () => {
    expect(mapOfferbiuItem({ ...REAL_ITEM, companyName: '', positionsText: '' })).toBeNull()
    expect(mapOfferbiuItem(null)).toBeNull()
  })

  it('LOCATIONS 多值时取第一个，不把城市拼成一串', () => {
    const job = mapOfferbiuItem({ ...REAL_ITEM, locations: ['北京', '上海'] })
    expect(job.city).toBe('北京')
  })

  it('日期归一化：认不出就留空，绝不猜', () => {
    expect(dateOnlyOf('2026/10/08')).toBe('2026-10-08')
    expect(dateOnlyOf('2026-10-08T00:00:00Z')).toBe('2026-10-08')
    expect(dateOnlyOf('招满即止')).toBe('')
    expect(dateOnlyOf(undefined)).toBe('')
  })
})

describe('OfferBiu → 采集器 payload → 工作台导入（端到端契约）', () => {
  const payload = toOfferbiuPayload([mapOfferbiuItem(REAL_ITEM)], { seasonYear: 2027 })

  it('payload 走既有契约，渠道落在 CHANNELS 里', () => {
    expect(payload.source).toBe('实习工作台抓取器')
    expect(payload.version).toBe(1)
    expect(payload.channel).toBe('岗位广场')
    expect(payload.site_id).toBe('offerbiu')
    expect(payload.count).toBe(1)
  })

  it('截止日穿过 payload 边界后仍然存在（这是本轮修掉的真实缺陷）', () => {
    expect(payload.jobs[0].deadline).toBe('2026-10-08')
    const drafts = parseCollectorJson(JSON.stringify(payload))
    expect(drafts).not.toBeNull()
    expect(drafts[0].deadline).toBe('2026-10-08')
  })

  it('其余字段穿过边界后也一一对应，且来源标签正确', () => {
    const drafts = parseCollectorJson(JSON.stringify(payload))
    expect(drafts[0].company).toBe('重庆机场集团所属企业信息科技公司')
    expect(drafts[0].title).toBe('系统操作员')
    expect(drafts[0].city).toBe('重庆')
    expect(drafts[0].url).toBe(REAL_ITEM.applyUrl)
    // 显式 channel 优先，不被域名猜测覆盖
    expect(drafts[0].source).toBe('岗位广场')
    expect(drafts[0].jd_text).toContain('央国企')
  })

  it('payload.text 里也带截止日 —— 用户按文本粘贴时同样看得到', () => {
    expect(payload.text).toContain('截止：2026-10-08')
  })

  it('没有截止日的条目不会凭空多出一个日期', () => {
    const noDeadline = toOfferbiuPayload([mapOfferbiuItem({ ...REAL_ITEM, deadlineAt: '' })], { seasonYear: 2027 })
    expect(noDeadline.jobs[0].deadline).toBe('')
    expect(parseCollectorJson(JSON.stringify(noDeadline))[0].deadline).toBe('')
    expect(noDeadline.text).not.toContain('截止：')
  })

  it('DOM 抓取通道（不写 deadline）仍然可用，向后兼容', () => {
    const legacy = makePayload({
      siteId: 'tencent',
      siteName: '腾讯招聘',
      channel: '官网投递',
      jobs: [{ company: '腾讯', title: '后台开发', city: '深圳', url: 'https://join.qq.com/x' }],
    })
    expect(legacy.jobs[0].deadline).toBe('')
    const drafts = parseCollectorJson(JSON.stringify(legacy))
    expect(drafts[0].company).toBe('腾讯')
    expect(drafts[0].deadline).toBe('')
  })
})
describe('一家公司的整串岗位 → 一条一岗（2026-09-27 真跑后的修正）', () => {
  const row = (positionsText, extra = {}) => ({
    company: '某科技公司',
    title: positionsText,
    city: '北京',
    salary: '',
    url: 'https://app.mokahr.com/campus-recruitment/demo/1',
    deadline: '2026-10-08',
    raw: positionsText,
    ...extra,
  })

  it('顿号/逗号分开的岗位各自成一条，公司、入口、截止日跟着走', () => {
    const out = splitPositions([row('大模型算法工程师、Agent 开发工程师，测试开发')])
    expect(out.map((j) => j.title)).toEqual(['大模型算法工程师', 'Agent 开发工程师', '测试开发'])
    for (const j of out) {
      expect(j.company).toBe('某科技公司')
      expect(j.url).toContain('mokahr.com')
      expect(j.deadline).toBe('2026-10-08')
    }
  })

  it('斜杠不拆 —— 同一个岗位的两个叫法不是两个岗位', () => {
    const out = splitPositions([row('算法工程师/机器学习工程师')])
    expect(out.length).toBe(1)
    expect(out[0].title).toBe('算法工程师/机器学习工程师')
  })

  it('单岗位的公司不因为拆分改变条数（旧契约不许漂）', () => {
    expect(splitPositions([row('系统操作员')]).length).toBe(1)
  })

  it('空标题与只有标点的标题不产生空行', () => {
    expect(splitPositions([row(''), row('、、；')]).map((j) => j.title)).toEqual(['', '、、；'])
  })

  it('同一家公司里重复的岗位名只留一条', () => {
    expect(splitPositions([row('后端开发、后端开发、算法')]).map((j) => j.title)).toEqual(['后端开发', '算法'])
  })

  it('拆分后的 payload 仍然能被工作台导入接住，且截止日不丢', () => {
    const payload = toOfferbiuPayload([mapOfferbiuItem({ ...REAL_ITEM, positionsText: '前端开发、大模型算法工程师' })], { seasonYear: 2027 })
    expect(payload.count).toBe(2)
    const drafts = parseCollectorJson(JSON.stringify(payload))
    expect(drafts).not.toBeNull()
    expect(drafts.map((d) => d.title)).toEqual(['前端开发', '大模型算法工程师'])
    expect(drafts.every((d) => d.deadline === '2026-10-08')).toBe(true)
    expect(drafts.every((d) => d.source === '岗位广场' || d.channel === '岗位广场')).toBe(true)
  })
})
