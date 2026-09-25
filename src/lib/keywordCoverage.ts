/**
 * JD 关键词覆盖 —— 第二轮对标（Resume-Matcher，Apache-2.0）的落点。
 *
 * 从 JD 抽关键词（英文技术词 + 中文技术词），与简历文本做大小写无关的覆盖比对：
 * 缺的词就是面试官会追问、你该提前准备「用哪段已有能力顶上」的地方。
 * 纯函数、纯本地计算，不调模型、不耗额度。
 *
 * 隐私红线：只做「JD 关键词 ↔ 简历文本」的覆盖比对，工具可以提示
 * 「JD 提出了这项要求」，绝不断言「你不满足」（AGENTS.md §3.4）。
 */

/** 英文停用词与 JD 泛词：出现再多也不算「该覆盖的技术点」 */
const STOPWORDS = new Set([
  // 英文通用
  'the', 'and', 'for', 'with', 'you', 'your', 'our', 'we', 'are', 'will', 'job', 'work', 'team',
  'and', 'or', 'of', 'to', 'in', 'on', 'is', 'as', 'by', 'at', 'be', 'an', 'it', 'this', 'that',
  'experience', 'years', 'year', 'skills', 'skill', 'ability', 'good', 'strong', 'plus', 'must',
  'require', 'requirements', 'responsibilities', 'responsibility', 'preferred', 'related', 'major',
  'degree', 'bachelor', 'master', 'candidate', 'candidates', 'position', 'role', 'company', 'join',
  // 中文拼音混入与编号
  'cn', 'com', 'www', 'http', 'https',
])

/** 中文技术词表：JD 里出现这些词才算技术要求；分词器抽不出来的都靠它兜 */
const CN_TECH_TERMS = [
  '后端', '前端', '全栈', '算法', '架构', '高并发', '分布式', '微服务', '中间件', '消息队列',
  '缓存', '数据库', '索引', '容器', '部署', '测试', '自动化', '运维', '监控', '性能',
  '大模型', '智能体', '多智能体', '检索', '向量化', '向量', '提示词', '微调', '推理',
  '爬虫', '数据挖掘', '数据分析', '图像', '语音', '推荐系统', '安全', '爬取',
  '校招', '转正', '导师', '薪资', '五险',
]

/** 从 JD 文本抽取关键词：英文技术词（≥2 字符）+ 命中词表的中文技术词，保持出现顺序、去重 */
export function extractKeywords(jd: string): string[] {
  const text = String(jd ?? '')
  const out: string[] = []
  const seen = new Set<string>()

  // 英文技术词：字母开头，允许数字/#/+/.（c++、node.js、vue3）
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9+#./]{1,24}/g)) {
    const word = m[0].replace(/[.+]+$/, '')
    const lower = word.toLowerCase()
    if (word.length < 2 || seen.has(lower)) continue
    if (STOPWORDS.has(lower)) continue
    // 纯数字与单个字母过滤
    if (/^\d+$/.test(word)) continue
    seen.add(lower)
    out.push(word)
  }

  // 中文技术词：命中词表才收
  for (const term of CN_TECH_TERMS) {
    if (text.includes(term) && !seen.has(term)) {
      seen.add(term)
      out.push(term)
    }
  }
  return out
}

export interface CoverageResult {
  /** JD 抽出的关键词总数 */
  total: number
  /** 简历文本已覆盖的关键词 */
  matched: string[]
  /** 简历未覆盖的关键词（按 JD 出现顺序，最多 12 条防刷屏） */
  missing: string[]
  /** 覆盖率 0-100 */
  coverage: number
}

/** 覆盖比对：简历文本包含关键词（ASCII 大小写无关）即算覆盖 */
export function keywordCoverage(jd: string, resumeText: string): CoverageResult {
  const keywords = extractKeywords(jd)
  const resume = String(resumeText ?? '').toLowerCase()
  const matched: string[] = []
  const missing: string[] = []
  for (const kw of keywords) {
    const isAscii = /^[A-Za-z]/.test(kw)
    const hit = isAscii ? resume.includes(kw.toLowerCase()) : resume.includes(kw)
    ;(hit ? matched : missing).push(kw)
  }
  return {
    total: keywords.length,
    matched,
    missing: missing.slice(0, 12),
    coverage: keywords.length === 0 ? 0 : Math.round((matched.length / keywords.length) * 100),
  }
}
