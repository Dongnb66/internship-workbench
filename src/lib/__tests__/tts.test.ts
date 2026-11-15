import { describe, expect, it } from 'vitest'

/**
 * 朗读题目用的纯函数。
 *
 * 这些断言跑在 node 环境（本仓库 vitest 的默认环境），所以只测**不依赖浏览器**的部分：
 * 文本清洗、语速夹取、错误码翻译、以及「拿不到 window 时必须老实返回不可用」。
 * 真正的 SpeechSynthesis 行为不在这里测——那需要真浏览器，且 CI 上不一定有。
 */

const { clampRate, speak, stripForSpeech, ttsErrorText, ttsSupported } = await import('../tts')

describe('朗读前的文本清洗', () => {
  it('Markdown 记号不会被读成「星号星号」「井号」', () => {
    expect(stripForSpeech('**项目深挖**：讲讲你做过最难的一个')).toBe('项目深挖：讲讲你做过最难的一个')
    expect(stripForSpeech('## 一、整体判断\n- 第一点\n* 第二点')).toBe('一、整体判断。第一点。第二点')
    expect(stripForSpeech('用 `kubectl get nodes` 看')).toBe('用 kubectl get nodes 看')
  })

  it('列表编号不被念出来，代码块整段跳过而不是念符号', () => {
    expect(stripForSpeech('1. 第一题\n2、第二题')).toBe('第一题。第二题')
    expect(stripForSpeech('前面\n```yaml\na: 1\n```\n后面')).toBe('前面。（代码略）。后面')
  })

  it('空与纯空白返回空串，交给调用方决定不念', () => {
    expect(stripForSpeech('   ')).toBe('')
    expect(stripForSpeech('')).toBe('')
  })
})

describe('语速与错误码', () => {
  it('语速夹在 0.5-2，NaN/0/负数一律回落默认值', () => {
    expect(clampRate(1.2)).toBe(1.2)
    expect(clampRate(99)).toBe(2)
    expect(clampRate(0.01)).toBe(0.5)
    expect(clampRate('abc')).toBe(1)
    expect(clampRate(undefined, 1.4)).toBe(1.4)
  })

  it('没有中文音色时给用户下一步，而不是丢一个英文错误名', () => {
    expect(ttsErrorText('voice-unavailable')).toContain('中文语音音色')
    expect(ttsErrorText('not-allowed')).toContain('语音合成权限')
    expect(ttsErrorText('')).toContain('未知原因')
  })
})

describe('能力判断', () => {
  it('没有 window（node / SSR）时报不可用，且 speak 返回 false 而不是抛', () => {
    expect(ttsSupported()).toBe(false)
    expect(speak('第一题')).toBe(false)
  })
})
