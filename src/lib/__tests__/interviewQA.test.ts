import { describe, expect, it } from 'vitest'

/**
 * 面试问答的结构化存储。
 *
 * 这里的每条断言都对应一个真实会翻车的场景：
 * 老记录是纯文本（打开编辑不能炸）、只记了题目（不该写成一坨 JSON）、
 * 一场面试答了七题但只记了三题回答（复盘要能算出来）。
 */

const { answeredCount, chainProgress, parseQA, qaToText, roundChains, roundRank, serializeQA } = await import('../interviewQA')

describe('问答解析', () => {
  it('老格式：一行一题，没有回答', () => {
    const items = parseQA('介绍一下你的项目\n为什么选我们公司')
    expect(items).toEqual([
      { q: '介绍一下你的项目', a: '' },
      { q: '为什么选我们公司', a: '' },
    ])
  })

  it('带 Q/A 前缀的老记录能识别出回答，多行回答不丢', () => {
    const items = parseQA('Q：讲讲你的 Agent 项目\nA：做了工具调用重试，\n失败时降级到本地规则\nQ：为什么用这个方案？')
    expect(items).toHaveLength(2)
    expect(items[0].a).toContain('降级到本地规则')
    expect(items[1].q).toContain('为什么用这个方案')
  })

  it('新格式 JSON 往返不丢字段', () => {
    const raw = serializeQA([
      { q: '项目里最难的点？', a: '工具调用幂等' },
      { q: '有什么想问我的', a: '团队现在用什么模型' },
    ])
    expect(parseQA(raw)).toEqual([
      { q: '项目里最难的点？', a: '工具调用幂等' },
      { q: '有什么想问我的', a: '团队现在用什么模型' },
    ])
  })

  it('一道题都没写回答时存纯文本，老页面和 AI 准备包仍能读', () => {
    const raw = serializeQA([
      { q: '自我介绍', a: '' },
      { q: '为什么选我们', a: '   ' },
    ])
    expect(raw).toBe('自我介绍\n为什么选我们')
    expect(raw.startsWith('{')).toBe(false)
    expect(parseQA(raw)).toHaveLength(2)
  })

  it('坏掉的 JSON 退回纯文本解析而不是抛错', () => {
    const broken = '{"v":1,"qa":[{"q":"被截断了'
    expect(() => parseQA(broken)).not.toThrow()
    expect(parseQA(broken).length).toBeGreaterThanOrEqual(1)
  })

  it('空值返回空数组', () => {
    expect(parseQA(undefined)).toEqual([])
    expect(parseQA(null)).toEqual([])
    expect(parseQA('   ')).toEqual([])
  })

  it('记录了几题回答，用于「3/7 题已补回答」的进度', () => {
    const items = parseQA(serializeQA([{ q: 'a', a: '答了' }, { q: 'b', a: '' }, { q: 'c', a: '也答了' }]))
    expect(answeredCount(items)).toBe(2)
  })

  it('喂给模型的文本保留题号，复盘才能逐题引用', () => {
    const text = qaToText([
      { q: '项目难点', a: '' },
      { q: '为什么选我们', a: '业务方向匹配' },
    ])
    expect(text).toContain('第 1 题')
    expect(text).toContain('（未记录）')
    expect(text).toContain('第 2 题')
  })
})

describe('轮次链条', () => {
  it('轮次按 一面 → 二面 → 三面 → HR 面 排序，未知轮次排最后', () => {
    expect(roundRank('一面')).toBeLessThan(roundRank('二面'))
    expect(roundRank('二面')).toBeLessThan(roundRank('三面'))
    expect(roundRank('三面')).toBeLessThan(roundRank('HR 面'))
    expect(roundRank('意外轮次')).toBeGreaterThan(roundRank('终面'))
  })

  it('同一投递下的多轮聚成一条链，即使写入顺序是乱的', () => {
    const rows = [
      { id: 3, company: '腾讯', title: 'AI 全栈', application_id: 7, round_name: '三面', kind: '面试', result: 'pending', scheduled_at: '2026-10-20T02:00:00Z' },
      { id: 1, company: '腾讯', title: 'AI 全栈', application_id: 7, round_name: '一面', kind: '面试', result: 'pass', scheduled_at: '2026-10-10T02:00:00Z' },
      { id: 2, company: '腾讯', title: 'AI 全栈', application_id: 7, round_name: '二面', kind: '面试', result: 'pass', scheduled_at: '2026-10-15T02:00:00Z' },
      { id: 4, company: '字节', title: '前端', application_id: 9, round_name: '一面', kind: '面试', result: 'fail', scheduled_at: '2026-10-12T02:00:00Z' },
    ]
    const chains = roundChains(rows)
    expect(chains).toHaveLength(2)
    const tencent = chains.find((c) => c.company === '腾讯')
    expect(tencent?.rounds.map((r) => r.round)).toEqual(['一面', '二面', '三面'])
    // 最近一轮更晚的在前面
    expect(chains[0].company).toBe('腾讯')
  })

  it('没关联投递的记录按「公司 + 岗位」兜底分组，不散成一堆', () => {
    const rows = [
      { id: 1, company: '美团', title: '后端', application_id: null, round_name: '一面', kind: '面试' },
      { id: 2, company: '美团', title: '后端', application_id: null, round_name: '二面', kind: '面试' },
      { id: 3, company: '美团', title: '另一个岗', application_id: null, round_name: '一面', kind: '面试' },
    ]
    const chains = roundChains(rows)
    expect(chains).toHaveLength(2)
    expect(chains.filter((c) => c.rounds.length === 2)).toHaveLength(1)
  })

  it('笔试不算面试轮次，不进链条', () => {
    const rows = [{ id: 1, company: '美团', title: '后端', application_id: 3, round_name: '笔试', kind: '笔试' }]
    expect(roundChains(rows)).toEqual([])
  })

  it('进度：过了几轮 + 下一场是哪轮', () => {
    const chain = {
      key: 'app:1',
      company: '腾讯',
      title: 'AI 全栈',
      latest: '2026-10-15',
      rounds: [
        { id: 1, round: '一面', result: 'pass', when: '', questionCount: 5, answered: 5 },
        { id: 2, round: '二面', result: 'pass', when: '', questionCount: 6, answered: 3 },
        { id: 3, round: '三面', result: 'pending', when: '', questionCount: 0, answered: 0 },
      ],
    }
    expect(chainProgress(chain)).toEqual({ passed: 2, failed: 0, next: '三面' })
  })
})
