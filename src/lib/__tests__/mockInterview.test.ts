import { describe, expect, it } from 'vitest'

/**
 * 模拟面试的会话逻辑。
 *
 * 用例全部按模型真会吐出来的脏形状写：编号 / 项目符号 / 加粗 / 「面试官：」前缀 /
 * 开场白混进行里 / 换行续写的长题干 / 重复题。这些形状只要有一个没吃掉，
 * 界面上就会出现一道「以下是给你的 5 道面试题」当第一题的荒唐题。
 */

const { appendAnswer, createSession, parseQuestions, reviewSubject, sessionProgress, sessionToQA } = await import('../mockInterview')

describe('题目解析', () => {
  it('编号列表按行收成题，编号被剥掉', () => {
    const out = parseQuestions('1. 介绍一下你的实习项目\n2. 你为什么投这个岗位？\n3、RAG 的召回为什么不够')
    expect(out).toEqual(['介绍一下你的实习项目', '你为什么投这个岗位？', 'RAG 的召回为什么不够'])
  })

  it('开场白不是题目，项目符号和加粗也不留符号', () => {
    const out = parseQuestions(`好的，以下是给你的 5 道面试题：
- **项目深挖**：讲讲你做过最难的一个人
* 你如何处理团队冲突？`)
    expect(out).toEqual(['项目深挖：讲讲你做过最难的一个人', '你如何处理团队冲突？'])
  })

  it('「面试官：」和「Q1：」这类前缀被剥掉', () => {
    expect(parseQuestions('面试官：说说你的 RAG 项目\nQ2：为什么选我们公司')).toEqual(['说说你的 RAG 项目', '为什么选我们公司'])
  })

  it('没有编号的裸行：像题就收，不像题就当作上一题的续写', () => {
    const out = parseQuestions(`1. 请谈谈你对 Agent 的理解
补充一句：它和传统自动化的区别在哪
这道题的追问`)
    expect(out).toHaveLength(2)
    expect(out[0]).toBe('请谈谈你对 Agent 的理解')
    expect(out[1]).toContain('补充一句')
  })

  it('重复题只留一条（模型爱把同一道换个说法出两遍）', () => {
    const out = parseQuestions('1. 介绍你的项目\n2. 介绍你的项目！\n3. 你的规划是什么？')
    expect(out).toHaveLength(2)
  })

  it('数量按 max 收口，且 max 被夹在 1-12', () => {
    const many = Array.from({ length: 20 }, (_, i) => `${i + 1}. 问题${i + 1}是什么？`).join('\n')
    expect(parseQuestions(many, 5)).toHaveLength(5)
    expect(parseQuestions(many, 0)).toHaveLength(12)
    expect(parseQuestions(many, 99)).toHaveLength(12)
  })

  it('空输入与只有说明文的输入返回空数组，而不是把说明当题', () => {
    expect(parseQuestions('')).toEqual([])
    expect(parseQuestions('希望这些题目对你有帮助')).toEqual([])
  })
})

describe('会话状态', () => {
  it('题数被夹进 1-12，非数字回落到 5', () => {
    expect(createSession({ company: '', title: '', count: 99 }).count).toBe(12)
    expect(createSession({ company: '', title: '', count: NaN }).count).toBe(5)
  })

  it('回答按题号落到对应下标，重复追加不覆盖', () => {
    const s = createSession({ company: 'A', title: 'B', count: 3 })
    s.questions = ['q1', 'q2', 'q3']
    s.answers = ['', '', '']
    const once = appendAnswer(s, 1, '第一句')
    const twice = appendAnswer(s, 1, '第二句')
    expect(once[1]).toBe('第一句')
    // 两次都从同一原始状态出发，所以各自都是「第一句」；真正的累加要在链式调用上看
    expect(twice[1]).toBe('第二句')
    const chained = appendAnswer({ ...s, answers: once }, 1, '第二句')
    expect(chained[1]).toBe('第一句 第二句')
  })

  it('下标越界不写飞，空字不追加', () => {
    const s = createSession({ company: '', title: '', count: 2 })
    s.questions = ['q1', 'q2']
    s.answers = ['', '']
    expect(appendAnswer(s, 99, '越界')[1]).toBe('越界')
    expect(appendAnswer(s, 0, '   ')).toEqual(['', ''])
  })

  it('问答对只保留有题或有答的条目，进度按已答数算', () => {
    const s = createSession({ company: '甲', title: '岗', count: 3 })
    s.questions = ['q1', 'q2', '']
    s.answers = ['答1', '', '']
    s.cursor = 9
    expect(sessionToQA(s)).toEqual([{ q: 'q1', a: '答1' }, { q: 'q2', a: '' }])
    expect(sessionProgress(s)).toEqual({ total: 2, answered: 1, done: 2 })
  })

  it('没填公司时复盘主体要说得清是自练，不能留空串', () => {
    const s = createSession({ company: '  ', title: '', count: 3 })
    expect(reviewSubject(s)).toEqual({ company: '自练（未指定公司）', title: '未指定岗位', round: '模拟面' })
  })
})
