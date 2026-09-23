import { describe, expect, it } from 'vitest'
import {
  cleanBlock,
  dedupeAgainst,
  dedupeKey,
  draftToRow,
  guessFromBlock,
  importReadiness,
  isDraftUsable,
  looksLikeCollectorJson,
  normalizeJobType,
  parseCollectorJson,
  pickJobUrl,
  probeJobFile,
  splitJobBlocks,
  type JobDraft,
} from '../import'

const labeled = `公司：示例科技
岗位：后端开发实习生
工作地点：深圳
薪资：200-300/天
学历要求：本科
截止日期：2026-10-15
https://example.com/job/1
岗位职责
1. 负责接口开发与联调
2. 编写单元测试`

function draft(over: Partial<JobDraft> = {}): JobDraft {
  return {
    company: '示例科技',
    title: '后端开发实习生',
    city: '深圳',
    job_type: '实习',
    salary: '200-300/天',
    education: '本科',
    deadline: '',
    url: '',
    tags: [],
    jd_text: '负责接口开发',
    source: '批量导入',
    ...over,
  }
}

describe('cleanBlock', () => {
  it('压缩多余空行与行内空格', () => {
    expect(cleanBlock('公司：A\n\n\n\n岗位：B  ')).toBe('公司：A\n\n岗位：B')
  })

  it('统一换行符', () => {
    expect(cleanBlock('A\r\nB')).toBe('A\nB')
  })

  it('空输入返回空串', () => {
    expect(cleanBlock('   ')).toBe('')
  })
})

describe('splitJobBlocks', () => {
  it('空文本返回空数组', () => {
    expect(splitJobBlocks('')).toEqual([])
  })

  it('短文本不拆分', () => {
    expect(splitJobBlocks('一个岗位的简单描述')).toEqual(['一个岗位的简单描述'])
  })

  it('按 --- 分隔线拆分', () => {
    const a = '第一个岗位的完整描述内容'
    const b = '第二个岗位的完整描述内容'
    expect(splitJobBlocks(`${a}\n---\n${b}`)).toEqual([a, b])
  })

  it('=== 与 *** 同样作为分隔线', () => {
    const a = '第一个岗位的完整描述内容'
    const b = '第二个岗位的完整描述内容'
    expect(splitJobBlocks(`${a}\n===\n${b}`)).toHaveLength(2)
    expect(splitJobBlocks(`${a}\n***\n${b}`)).toHaveLength(2)
  })

  it('碎片被丢弃，不产生一堆空块', () => {
    // 两段都短于 15 字：视为「不是分隔线」，整段当作一个块
    expect(splitJobBlocks('短\n---\n也很短')).toHaveLength(1)
  })

  it('超长文本被切成多块，且每块不超过上限', () => {
    const para = 'A'.repeat(1000)
    const long = Array.from({ length: 10 }, () => para).join('\n\n')
    const blocks = splitJobBlocks(long, 5000)
    expect(blocks.length).toBeGreaterThan(1)
    expect(blocks.every((b) => b.length <= 5000)).toBe(true)
  })

  it('单个超长段落会被硬切，不会整段塞给模型', () => {
    const blocks = splitJobBlocks('B'.repeat(9000), 5000)
    expect(blocks.length).toBe(2)
    expect(blocks.every((b) => b.length <= 5000)).toBe(true)
  })
})

describe('normalizeJobType', () => {
  it('保留合法枚举值', () => {
    expect(normalizeJobType('暑期实习')).toBe('暑期实习')
    expect(normalizeJobType('日常实习')).toBe('日常实习')
    expect(normalizeJobType('校招')).toBe('校招')
    expect(normalizeJobType('社招')).toBe('社招')
  })

  it('从描述里推断类型', () => {
    expect(normalizeJobType('2027 届秋季校园招聘')).toBe('校招')
    expect(normalizeJobType('暑期实习生（可转正）')).toBe('暑期实习')
    expect(normalizeJobType('日常实习岗')).toBe('日常实习')
  })

  it('认不出来时回落到实习，保证筛选器不会失效', () => {
    expect(normalizeJobType('')).toBe('实习')
    expect(normalizeJobType('后端开发工程师')).toBe('实习')
  })
})

describe('guessFromBlock', () => {
  it('提取带标签的字段', () => {
    const d = guessFromBlock(labeled)
    expect(d.company).toBe('示例科技')
    expect(d.title).toBe('后端开发实习生')
    expect(d.city).toBe('深圳')
    expect(d.salary).toBe('200-300/天')
    expect(d.education).toBe('本科')
    expect(d.deadline).toBe('2026-10-15')
    expect(d.url).toBe('https://example.com/job/1')
  })

  it('JD 正文保留原文，不做删改', () => {
    const d = guessFromBlock(labeled)
    expect(d.jd_text).toContain('负责接口开发与联调')
  })

  it('没有标签时不猜公司和岗位以外的字段', () => {
    const d = guessFromBlock('一段没有任何标签的岗位描述文字，只有正文内容')
    expect(d.company).toBe('')
    expect(d.salary).toBe('')
    expect(d.deadline).toBe('')
    expect(d.education).toBe('')
  })

  it('从正文里认出薪资与截止日期', () => {
    const d = guessFromBlock('后端开发实习，日薪 180-250/天，投递截止 2026/10/1，欢迎投递')
    expect(d.salary).toContain('180-250')
    expect(d.deadline).toBe('2026-10-01')
  })

  it('中文年月日格式的日期也能归一', () => {
    expect(guessFromBlock('截止日期：2026年10月5日').deadline).toBe('2026-10-05')
  })

  it('远程岗位被识别成城市', () => {
    const d = guessFromBlock('数据工程实习生，全远程办公，每周 20 小时')
    expect(d.city).toBe('远程')
  })
})

describe('dedupeKey / dedupeAgainst', () => {
  it('忽略大小写、空格、括号与岗位后缀', () => {
    expect(dedupeKey('示例科技 ', '后端开发（实习生）')).toBe(dedupeKey('示例科技', '后端开发实习生'))
  })

  it('公司不同则视为不同岗位', () => {
    expect(dedupeKey('A 公司', '后端实习生')).not.toBe(dedupeKey('B 公司', '后端实习生'))
  })

  it('能认出与库中已有岗位重复', () => {
    const existing = [{ id: 1, company: '示例科技', title: '后端开发实习生' }]
    const checks = dedupeAgainst(existing, [draft(), draft({ company: '另一家', title: '前端实习生' })])
    expect(checks[0].duplicate).toBe(true)
    expect(checks[0].existing?.id).toBe(1)
    expect(checks[1].duplicate).toBe(false)
  })

  it('公司和岗位都为空时不算重复', () => {
    const checks = dedupeAgainst([{ id: 1, company: '示例科技', title: '后端开发实习生' }], [draft({ company: '', title: '' })])
    expect(checks[0].duplicate).toBe(false)
    expect(checks[0].key).toBe('||')
  })
})

describe('isDraftUsable', () => {
  it('有岗位名或有 JD 就能入库', () => {
    expect(isDraftUsable(draft())).toBe(true)
    expect(isDraftUsable(draft({ title: '', jd_text: '只有一段职责描述' }))).toBe(true)
    expect(isDraftUsable(draft({ title: '', jd_text: '' }))).toBe(false)
  })
})

describe('draftToRow', () => {
  it('按分数定优先级', () => {
    expect(draftToRow(draft(), 80).priority).toBe('高')
    expect(draftToRow(draft(), 60).priority).toBe('中')
    expect(draftToRow(draft(), 30).priority).toBe('低')
  })

  it('缺 JD 时写入醒目备注，提醒补上再送 AI', () => {
    const row = draftToRow(draft({ jd_text: '' }), 50)
    expect(row.jd_text).toBeNull()
    expect(String(row.notes)).toContain('未解析到 JD 正文')
  })

  it('公司或岗位缺失时用占位名，避免表格出现空白行', () => {
    const row = draftToRow(draft({ company: '', title: '' }), 40)
    expect(row.company).toBe('未填公司')
    expect(row.title).toBe('未填岗位')
  })

  it('空字符串字段落成 null，不写空串进库', () => {
    const row = draftToRow(draft({ city: '', salary: '', deadline: '', url: '' }), 50)
    expect(row.city).toBeNull()
    expect(row.salary).toBeNull()
    expect(row.deadline).toBeNull()
    expect(row.url).toBeNull()
  })

  it('状态默认进岗位池', () => {
    expect(draftToRow(draft(), 50).status).toBe('pool')
  })
})

describe('importReadiness', () => {
  it('画像为空时给出明确提示', () => {
    expect(importReadiness(null).ok).toBe(false)
    expect(importReadiness({ skills: [], directions: [] }).ok).toBe(false)
  })

  it('有技能或方向即视为就绪', () => {
    expect(importReadiness({ skills: ['Python'], directions: [] }).ok).toBe(true)
    expect(importReadiness({ skills: [], directions: ['LLM 工程'] }).ok).toBe(true)
  })
})

describe('浏览器采集结果导入', () => {
  const payload = {
    source: '实习工作台采集器',
    version: 1,
    page: { url: 'https://www.zhipin.com/web/geek/job?query=python', title: 'Python 实习', site: 'www.zhipin.com' },
    count: 2,
    jobs: [
      {
        company: '示例科技',
        title: 'Python 后端开发实习生',
        city: '广州',
        salary: '200-300/天',
        url: 'https://www.zhipin.com/job_detail/a.html',
        raw: 'Python 后端开发实习生 200-300/天 广州 岗位职责 负责接口开发',
      },
      { company: '', title: '', city: '', salary: '', url: '', raw: '' },
    ],
  }

  it('认得采集器输出的 JSON', () => {
    expect(looksLikeCollectorJson(JSON.stringify(payload))).toBe(true)
  })

  it('普通文本与坏 JSON 不会被误判', () => {
    expect(looksLikeCollectorJson('公司：某某科技\n岗位：后端实习生')).toBe(false)
    expect(looksLikeCollectorJson('{"a":1}')).toBe(false)
    expect(looksLikeCollectorJson('{ 不是合法 json')).toBe(false)
  })

  it('映射成岗位草稿，并按域名标出渠道', () => {
    const drafts = parseCollectorJson(JSON.stringify(payload))
    expect(drafts).toHaveLength(1)
    expect(drafts?.[0].title).toBe('Python 后端开发实习生')
    expect(drafts?.[0].company).toBe('示例科技')
    expect(drafts?.[0].salary).toBe('200-300/天')
    expect(drafts?.[0].source).toBe('BOSS直聘')
    expect(drafts?.[0].job_type).toBe('实习')
    expect(drafts?.[0].jd_text).toContain('负责接口开发')
  })

  it('认不出的域名退回通用渠道名', () => {
    const drafts = parseCollectorJson(
      JSON.stringify({ ...payload, page: { site: 'careers.example.com' } }),
    )
    expect(drafts?.[0].source).toBe('浏览器采集')
  })

  it('没有可用岗位时返回 null，由调用方回落到文本解析', () => {
    const empty = { source: '实习工作台采集器', page: {}, jobs: [{ title: '', raw: '' }] }
    expect(parseCollectorJson(JSON.stringify(empty))).toBeNull()
  })

  it('结构不对的 JSON 返回 null', () => {
    expect(parseCollectorJson('{"jobs": "not-an-array"}')).toBeNull()
    expect(parseCollectorJson('{ 坏 json')).toBeNull()
  })
})

/**
 * 扩展的「复制为文本」形态：带标签、用 --- 分隔。
 * 这段文本是从 extension/__fixtures__/mock-job-list.html 实跑出来的，
 * 逐字抄进测试是为了钉住两端的契约 —— 采集器改了输出格式没人发现的话，
 * 这里的断言会先红。
 */
const COLLECTOR_TEXT = `# 采集自 Python 实习 - 招聘搜索 （https://www.zhipin.com/web/geek/job?query=python）
# 共 2 个岗位 · 2026/9/23 16:32:26

公司：示例·星野智能科技
岗位：AI Agent 应用开发实习生
城市：广州
薪资：200-300元/天
https://www.zhipin.com/job_detail/1000.html
岗位原文：
AI Agent 应用开发实习生
200-300元/天
广州·天河区 · 3天/周 · 本科
示例·星野智能科技
Python · FastAPI · LangGraph
立即沟通

---

公司：示例·云图数据有限公司
岗位：Python 后端开发实习生
城市：深圳
薪资：180-250元/天
https://www.zhipin.com/job_detail/1001.html
岗位原文：
Python 后端开发实习生
180-250元/天
深圳·南山区 · 5天/周 · 本科
示例·云图数据有限公司
Python · MySQL · Docker
立即沟通
`

describe('采集器文本形态的往返（不花模型额度也能入库）', () => {
  it('按 --- 分隔成两条', () => {
    expect(splitJobBlocks(COLLECTOR_TEXT)).toHaveLength(2)
  })

  it('每条都能被本地正则认出公司 / 岗位 / 城市 / 薪资 / 链接', () => {
    const blocks = splitJobBlocks(COLLECTOR_TEXT)
    const first = guessFromBlock(blocks[0])
    expect(first.company).toBe('示例·星野智能科技')
    expect(first.title).toBe('AI Agent 应用开发实习生')
    expect(first.city).toBe('广州')
    expect(first.salary).toBe('200-300元/天')
    expect(first.url).toBe('https://www.zhipin.com/job_detail/1000.html')

    const second = guessFromBlock(blocks[1])
    expect(second.company).toBe('示例·云图数据有限公司')
    expect(second.title).toBe('Python 后端开发实习生')
    expect(second.city).toBe('深圳')
  })

  it('JD 正文里保留了岗位原文，没有只留下标签行', () => {
    const first = guessFromBlock(splitJobBlocks(COLLECTOR_TEXT)[0])
    expect(first.jd_text).toContain('Python · FastAPI · LangGraph')
  })

  it('文本形态不会被误判成采集器 JSON', () => {
    expect(looksLikeCollectorJson(COLLECTOR_TEXT)).toBe(false)
  })
})

describe('pickJobUrl', () => {
  it('跳过采集器写进头部的来源页地址，选真正的岗位链接', () => {
    const block = `# 采集自 搜索结果 （https://www.zhipin.com/web/geek/job?query=python）
公司：示例科技
岗位：后端实习生
https://www.zhipin.com/job_detail/1000.html`
    expect(pickJobUrl(block)).toBe('https://www.zhipin.com/job_detail/1000.html')
  })

  it('优先详情页特征链接，而不是导航或分享链接', () => {
    const block = `公司：示例科技
岗位：后端实习生
https://www.zhipin.com/
https://www.zhipin.com/position/abc123`
    expect(pickJobUrl(block)).toBe('https://www.zhipin.com/position/abc123')
  })

  it('只有带筛选参数的列表页时，退回第一个可用链接', () => {
    expect(pickJobUrl('https://jobs.example.com/search?page=2')).toBe('https://jobs.example.com/search?page=2')
  })

  it('没有链接时返回空串', () => {
    expect(pickJobUrl('公司：示例科技\n岗位：后端实习生')).toBe('')
  })

  it('排除句末标点，避免把中文标点带进 URL', () => {
    expect(pickJobUrl('详见 https://example.com/job_detail/1。')).toBe('https://example.com/job_detail/1')
  })
})

describe('probeJobFile：选中的文件该走哪条路', () => {
  const crawlerJson = JSON.stringify({
    source: '实习工作台抓取器',
    channel: '官网投递',
    page: { url: 'https://join.qq.com/post.html', site: 'join.qq.com' },
    jobs: [{ company: '腾讯', title: 'AI全栈工程师', city: '深圳', url: '', raw: '岗位职责…' }],
  })

  it('抓取器 / 扩展的 JSON → 直读，不过模型', () => {
    const r = probeJobFile('tencent-2026-09-23_1718.json', crawlerJson)
    expect(r.kind).toBe('collector')
    expect(r.hint).toContain('1 个岗位')
    expect(r.hint).toContain('不需要消耗模型额度')
  })

  it('普通文本 → 走切块 / 模型那条路', () => {
    const r = probeJobFile('岗位.txt', '公司：示例科技\n岗位：后端开发实习生\n深圳')
    expect(r.kind).toBe('text')
    expect(r.hint).toContain('纯文本读入')
  })

  it('空文件单独告诉用户，不要静默', () => {
    expect(probeJobFile('x.json', '').kind).toBe('empty')
    expect(probeJobFile('x.json', '   \n  ').kind).toBe('empty')
  })

  it('JSON 结构不对（jobs 为空）时退回文本路径，而不是假装成功', () => {
    const r = probeJobFile('x.json', JSON.stringify({ source: 'x', jobs: [] }))
    expect(r.kind).toBe('text')
  })

  it('后缀不是 .json/.txt 时给出提示，但仍按内容判断', () => {
    const r = probeJobFile('岗位.md', '公司：示例科技\n岗位：后端实习生')
    expect(r.kind).toBe('text')
    expect(r.hint).toContain('.md')
  })
})
