import { describe, expect, it } from 'vitest'

import { parseResumeAnalysis } from '../ai'
import { extractResumeText, resumeKindOf } from '../resumeFile'

describe('parseResumeAnalysis', () => {
  it('正常 JSON：字段逐个回收', () => {
    const a = parseResumeAnalysis(
      JSON.stringify({
        summary: '过筛概率中等，最强牌是项目',
        education: ['双非本科如实呈现'],
        skills: ['React 熟练', 'Node 有一手'],
        projects: ['python-learning-agent 有 146 条测试'],
        defense: ['FastAPI 生命周期：会问为何用 lifespan'],
        risks: ['「精通」字眼过重'],
        suggestions: ['补实习时长'],
      }),
    )
    expect(a.summary).toContain('最强牌')
    expect(a.education).toHaveLength(1)
    expect(a.skills).toHaveLength(2)
    expect(a.projects).toHaveLength(1)
    expect(a.defense).toHaveLength(1)
    expect(a.risks).toHaveLength(1)
    expect(a.suggestions).toHaveLength(1)
  })

  it('模型包了 ```json 代码块也能救回来', () => {
    const a = parseResumeAnalysis('好的，以下是分析结果：\n```json\n{"summary":"x","skills":["a"]}\n```\n希望有帮助')
    expect(a.summary).toBe('x')
    expect(a.skills).toEqual(['a'])
  })

  it('完全不是 JSON：返回空结构不炸页面', () => {
    const a = parseResumeAnalysis('服务器开小差了，无法输出')
    expect(a.summary).toBe('')
    expect(a.skills).toEqual([])
    expect(a.risks).toEqual([])
  })

  it('字段缺失 / 非数组 / 条目超长：全部兜底', () => {
    const a = parseResumeAnalysis(JSON.stringify({ skills: 'not-array', projects: [1, '', 'ok'], defense: Array.from({ length: 20 }, (_, i) => `k${i}`) }))
    expect(a.skills).toEqual([])
    expect(a.projects).toEqual(['1', 'ok']) // 空串被过滤、数字转字符串
    expect(a.defense).toHaveLength(10) // max 截断
  })
})

describe('resumeKindOf', () => {
  it('按扩展名分派', () => {
    expect(resumeKindOf('简历_杨运栋.pdf')).toBe('pdf')
    expect(resumeKindOf('resume.DOCX')).toBe('docx')
    expect(resumeKindOf('resume.doc')).toBe('doc')
    expect(resumeKindOf('a.md')).toBe('md')
    expect(resumeKindOf('a.markdown')).toBe('md')
    expect(resumeKindOf('a.txt')).toBe('txt')
    expect(resumeKindOf('a.pages')).toBe('unknown')
    expect(resumeKindOf('noext')).toBe('unknown')
  })
})

describe('extractResumeText 入口校验', () => {
  it('.doc 直接拒绝并给出转存提示，不发起解析', async () => {
    const file = new File(['x'], 'old.doc')
    await expect(extractResumeText(file)).rejects.toThrow('另存为 .docx')
  })

  it('不支持的类型报错', async () => {
    const file = new File(['x'], 'photo.jpg')
    await expect(extractResumeText(file)).rejects.toThrow('仅支持 PDF')
  })

  it('超过 10MB 报错（错误信息里带实际大小）', async () => {
    const big = new File([new ArrayBuffer(11 * 1024 * 1024)], 'big.pdf')
    await expect(extractResumeText(big)).rejects.toThrow(/超过 10MB/)
  })
})
