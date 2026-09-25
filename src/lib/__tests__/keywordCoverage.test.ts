import { describe, expect, it } from 'vitest'

/**
 * JD 关键词覆盖清单 —— 第二轮对标（Resume-Matcher，Apache-2.0）的落点。
 *
 * 服务「广撒网 + 按岗位微调简历」：从 JD 抽关键词，和你的简历文本做覆盖比对，
 * 告诉你 JD 里哪些词简历已经覆盖、哪些缺——缺的就是面试官会追问、你该提前
 * 准备「用哪段已有能力顶上」的地方。纯函数，不调模型、不耗额度。
 *
 * 隐私红线：只做「JD 关键词 ↔ 简历文本」的覆盖比对，不断言个人短板。
 */

const { keywordCoverage, extractKeywords } = await import('../keywordCoverage')

const JD = `岗位职责：
1. 负责后端开发，使用 Python + FastAPI 构建高并发服务；
2. 熟悉 MySQL 索引优化，了解 Redis 缓存；
3. 有 LangGraph 或 RAG 经验优先；
4. 熟悉 Docker 部署与 Kubernetes。
任职要求：本科及以上，3 年经验。`

const RESUME = 'python-learning-agent：FastAPI + LangGraph 多智能体，146 条 pytest，MySQL 建模，Docker 部署'

describe('extractKeywords（JD 关键词抽取）', () => {
  it('抽出英文技术词，去重、去停用词', () => {
    const kws = extractKeywords(JD)
    expect(kws).toContain('Python')
    expect(kws).toContain('FastAPI')
    expect(kws).toContain('MySQL')
    expect(kws).toContain('Redis')
    expect(kws).toContain('LangGraph')
    expect(kws).toContain('Docker')
    // 停用词与泛词不进清单
    expect(kws).not.toContain('the')
    expect(kws).not.toContain('OR')
  })

  it('中文技术词进清单，泛词（职责/经验/本科）不进', () => {
    const kws = extractKeywords(JD)
    expect(kws).toContain('后端')
    expect(kws).toContain('高并发')
    expect(kws).toContain('缓存')
    expect(kws).not.toContain('职责')
    expect(kws).not.toContain('经验')
    expect(kws).not.toContain('本科')
  })
})

describe('keywordCoverage（覆盖比对）', () => {
  it('覆盖数、缺失清单、覆盖率', () => {
    const r = keywordCoverage(JD, RESUME)
    expect(r.matched).toContain('FastAPI')
    expect(r.matched).toContain('LangGraph')
    expect(r.missing).toContain('Redis')
    expect(r.missing).toContain('Kubernetes')
    // 大小写无关：python 小写也命中 Python
    expect(r.missing).not.toContain('Python')
    expect(r.coverage).toBe(Math.round((r.matched.length / r.total) * 100))
  })

  it('空 JD 或空简历不炸，覆盖率 0', () => {
    expect(keywordCoverage('', RESUME).total).toBe(0)
    const r = keywordCoverage(JD, '')
    expect(r.total).toBeGreaterThan(0)
    expect(r.matched).toHaveLength(0)
    expect(r.coverage).toBe(0)
  })

  it('缺失清单按 JD 出现顺序排， capped 在合理长度', () => {
    const r = keywordCoverage(JD, RESUME)
    expect(r.missing.indexOf('Redis')).toBeLessThan(r.missing.indexOf('Kubernetes'))
    expect(r.missing.length).toBeLessThanOrEqual(12)
  })
})
