import { describe, expect, it } from 'vitest'

/**
 * 会议转写 → 问答对。
 *
 * 这些用例按真实会遇到的脏数据写：VTT 带时间轴、妙记带「说话人1」、
 * 一段追问连着说多行、单人单向粘贴（只录了自己）。
 */

const { dialogueToQA, guessSelfSpeaker, parseTranscript, speakerNames, transcriptToQA } = await import('../transcript')

describe('转写解析', () => {
  it('「我 / 面试官」冒号格式直接对成问答', () => {
    const { qa } = transcriptToQA('面试官：先做个自我介绍\n我：我是XX大学的大三学生')
    expect(qa).toEqual([{ q: '先做个自我介绍', a: '我是XX大学的大三学生' }])
  })

  it('WebVTT 的时间轴与序号被剥掉，不混进正文', () => {
    const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.000
<v 面试官>先介绍一下你的项目

2
00:00:04.000 --> 00:00:09.000
<v 我>我做过一个工具调用重试的模块`
    const lines = parseTranscript(vtt)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({ speaker: '面试官', text: '先介绍一下你的项目' })
    expect(lines[1].text).toContain('工具调用重试')
    expect(lines.some((l) => l.text.includes('-->'))).toBe(false)
  })

  it('SRT 的数字序号不当作正文', () => {
    const srt = `1
00:00:00,500 --> 00:00:02,000
面试官：你实习多久

2
00:00:02,500 --> 00:00:05,000
我：三个月`
    const lines = parseTranscript(srt)
    expect(lines).toHaveLength(2)
    expect(lines[0].text).toBe('你实习多久')
  })

  it('同一说话人连着说几段，合并成同一题的题干（追问算同一题）', () => {
    const qa = dialogueToQA(
      [
        { speaker: '面试官', text: '你说说这个 Agent 项目' },
        { speaker: '面试官', text: '工具调用失败时怎么兜底？' },
        { speaker: '我', text: '做了重试加降级' },
      ],
      '我',
    )
    expect(qa).toHaveLength(1)
    expect(qa[0].q).toContain('工具调用失败')
    expect(qa[0].a).toBe('做了重试加降级')
  })

  it('我连续说多段时合并进同一个答案，不会拆成多个空题', () => {
    const qa = dialogueToQA(
      [
        { speaker: '面试官', text: '讲讲最难的点' },
        { speaker: '我', text: '最难的是幂等' },
        { speaker: '我', text: '还有并发下的顺序' },
      ],
      '我',
    )
    expect(qa).toHaveLength(1)
    expect(qa[0].a).toContain('幂等')
    expect(qa[0].a).toContain('并发')
  })

  it('只出现一次的疑似说话人前缀不被当成说话人', () => {
    const lines = parseTranscript('问题：你为什么选我们公司\n我：因为做 Agent 方向匹配')
    expect(lines[0].speaker).toBe('')
    expect(lines[0].text).toContain('问题：你为什么选我们公司')
  })

  it('猜「哪个是我」：两位说话人时取后开口的那位', () => {
    const lines = parseTranscript('面试官：你好\n我：你好\n面试官：介绍一下')
    expect(speakerNames(lines)).toEqual(['面试官', '我'])
    expect(guessSelfSpeaker(lines)).toBe('我')
  })

  it('单侧录音（只有我一个人）时不会硬配出空题', () => {
    const qa = dialogueToQA(
      [
        { speaker: '我', text: '我负责工具调用' },
        { speaker: '我', text: '做了失败重试' },
      ],
      '我',
    )
    expect(qa).toEqual([])
  })

  it('空输入返回空结果，不抛错', () => {
    expect(parseTranscript('')).toEqual([])
    expect(transcriptToQA('').qa).toEqual([])
  })
})
