import { describe, expect, it } from 'vitest'

import { CHANNELS } from '../constants'
import { dedupeKey } from '../import'
import { SQUARE_SOURCE, filterSquareJobs, inPool, poolKeySet, publicToPoolRow, squareCities } from '../square'
import type { PublicJob, Row } from '../../types'

const pub = (over: Partial<PublicJob> = {}): PublicJob => ({
  id: 1,
  company: '腾讯',
  title: 'AI应用工程师',
  city: '深圳',
  job_type: '校招',
  industry: '互联网',
  education: null,
  salary: null,
  source: '官网投递',
  url: 'https://join.qq.com/post_detail.html?postid=1',
  jd_text: '负责 AI 应用的开发，熟悉 Python。',
  tags: ['Python'],
  deadline: null,
  posted_at: '2026-09-23T09:18:22.517Z',
  ...over,
})

describe('岗位广场 · 加入岗位池', () => {
  it('复制出的行来源标为「岗位广场」，且该取值在 CHANNELS 里', () => {
    expect(CHANNELS).toContain(SQUARE_SOURCE)
    const row = publicToPoolRow(pub(), 80)
    expect(row.source).toBe('岗位广场')
  })

  it('私有字段在复制那一刻初始化，而不是从广场带过来', () => {
    const row = publicToPoolRow(pub(), 82)
    expect(row.status).toBe('pool')
    expect(row.priority).toBe('高')
    expect(row.match_score).toBe(82)
    expect(String(row.notes)).toContain('岗位广场')
  })

  it('优先级按分数分档，边界与岗位池口径一致', () => {
    expect(publicToPoolRow(pub(), 75).priority).toBe('高')
    expect(publicToPoolRow(pub(), 74).priority).toBe('中')
    expect(publicToPoolRow(pub(), 55).priority).toBe('中')
    expect(publicToPoolRow(pub(), 54).priority).toBe('低')
  })

  it('缺公司名 / 岗位名时不留空，避免库里出现无法辨认的行', () => {
    const row = publicToPoolRow(pub({ company: '', title: '' }), 50)
    expect(row.company).toBe('未填公司')
    expect(row.title).toBe('未填岗位')
  })

  it('JD 缺失时原样留空，不编造内容', () => {
    const row = publicToPoolRow(pub({ jd_text: null }), 50)
    expect(row.jd_text).toBe(null)
  })

  it('广场行不携带私有状态：复制出的 status 永远是 pool', () => {
    // 即便广场那一行被塞了 status（不该有），也不该带进池子
    const dirty = pub({ status: 'applied' } as Partial<PublicJob>)
    expect(publicToPoolRow(dirty, 60).status).toBe('pool')
  })
})

describe('岗位广场 · 已在池中判定', () => {
  it('与导入查重同源：同一家公司同一个岗位名算命中', () => {
    const pool: Row[] = [{ company: '腾讯', title: 'AI应用工程师' }]
    const keys = poolKeySet(pool)
    expect(inPool(pub(), keys)).toBe(true)
  })

  it('去重键忽略大小写、空格与「实习/校招」这类标签', () => {
    const keys = poolKeySet([{ company: '腾讯', title: 'AI 应用工程师 实习' } as Row])
    expect(inPool(pub({ title: 'ai应用工程师' }), keys)).toBe(true)
  })

  it('公司或岗位名不同就不算命中', () => {
    const keys = poolKeySet([{ company: '腾讯', title: 'Agent开发工程师' } as Row])
    expect(inPool(pub(), keys)).toBe(false)
  })

  it('池子为空时任何岗位都判为未加入', () => {
    expect(inPool(pub(), poolKeySet([]))).toBe(false)
  })

  it('公司名与岗位名都为空的行不参与判定，避免脏行把所有岗位都标成已加入', () => {
    const keys = poolKeySet([{ company: '', title: '' } as Row])
    expect(keys.size).toBe(0)
    expect(inPool(pub({ company: '', title: '' }), keys)).toBe(false)
  })

  it('判定与 dedupeKey 的结果一致（防止两边算法分叉）', () => {
    const job = pub({ company: '有 限 公 司（北京）', title: '测试-工程师_岗' })
    const keys = poolKeySet([{ company: '有限公司北京', title: '测试工程师岗' } as Row])
    expect(keys.has(dedupeKey(job.company, job.title))).toBe(true)
    expect(inPool(job, keys)).toBe(true)
  })
})

describe('岗位广场 · 筛选', () => {
  const jobs: PublicJob[] = [
    pub({ id: 1, company: '腾讯', title: 'AI应用工程师', city: '深圳', job_type: '校招' }),
    pub({ id: 2, company: '字节跳动', title: '后端开发实习生', city: '北京', job_type: '实习' }),
    pub({ id: 3, company: '美团', title: '数据工程实习生', city: '北京', job_type: '实习', jd_text: '熟悉 SQL 与 Python' }),
  ]
  const keys = poolKeySet([{ company: '腾讯', title: 'AI应用工程师' } as Row])

  it('关键词命中公司名', () => {
    expect(filterSquareJobs(jobs, { keyword: '字节' }, keys).map((j) => j.id)).toEqual([2])
  })

  it('关键词也命中 JD 正文', () => {
    expect(filterSquareJobs(jobs, { keyword: 'sql' }, keys).map((j) => j.id)).toEqual([3])
  })

  it('城市与岗位类型可叠加', () => {
    expect(filterSquareJobs(jobs, { city: '北京', jobType: '实习' }, keys).map((j) => j.id)).toEqual([2, 3])
    expect(filterSquareJobs(jobs, { city: '北京', jobType: '校招' }, keys)).toEqual([])
  })

  it('「未加入」把已在池中的滤掉，「已加入」只留它', () => {
    expect(filterSquareJobs(jobs, { poolState: '未加入' }, keys).map((j) => j.id)).toEqual([2, 3])
    expect(filterSquareJobs(jobs, { poolState: '已加入' }, keys).map((j) => j.id)).toEqual([1])
  })

  it('「全部」不做池子过滤', () => {
    expect(filterSquareJobs(jobs, { poolState: '全部' }, keys)).toHaveLength(3)
  })

  it('不改动原数组（筛选是纯函数）', () => {
    const before = jobs.map((j) => j.id)
    filterSquareJobs(jobs, { city: '北京' }, keys)
    expect(jobs.map((j) => j.id)).toEqual(before)
  })
})

describe('岗位广场 · 城市统计', () => {
  it('按出现次数降序，相同次数按名称排序', () => {
    const jobs = [pub({ city: '北京' }), pub({ city: '深圳' }), pub({ city: '北京' })]
    expect(squareCities(jobs)).toEqual(['北京', '深圳'])
  })

  it('忽略空城市，不产生空选项', () => {
    expect(squareCities([pub({ city: null }), pub({ city: '' }), pub({ city: '上海' })])).toEqual(['上海'])
  })
})
