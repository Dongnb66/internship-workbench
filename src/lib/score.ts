import type { Profile } from '../types'

export interface ScoreResult {
  score: number
  hits: string[]
  missing: string[]
}

/** JD 中出现即视为潜在缺口的技术词（本地预筛用，命中越多分越低） */
export const WATCH_WORDS = [
  'redis',
  'mongodb',
  'kafka',
  'k8s',
  'kubernetes',
  'elasticsearch',
  'vue',
  'c++',
  'pytorch',
  'golang',
  'go语言',
  'dify',
  'flink',
  'spark',
  'ceph',
  'rust',
  'springcloud',
  'hadoop',
]

export const PREFILTER_THRESHOLD = 45

/** 本地规则打分：不调用大模型也能给出可解释的匹配度 */
export function localScore(jd: string, title: string, profile: Profile | null, watch: string[] = WATCH_WORDS): ScoreResult {
  const text = `${title} ${jd}`.toLowerCase()
  const skills = (profile?.skills ?? []).filter(Boolean)
  const directions = (profile?.directions ?? []).filter(Boolean)
  const expectCities = profile?.expect_city ?? []

  const hits: string[] = []
  const missing: string[] = []

  if (expectCities.some((c) => c && text.includes(String(c).toLowerCase()))) hits.push('工作城市符合期望')

  for (const skill of skills) {
    if (skill && text.includes(String(skill).toLowerCase())) hits.push(String(skill))
  }
  for (const word of watch) {
    if (text.includes(word)) missing.push(word)
  }
  const dirHits = directions.filter((d) => text.includes(String(d).split(' ')[0].toLowerCase()))
  hits.push(...dirHits)

  const skillPart = Math.min(40, hits.length * 8)
  const dirPart = Math.min(20, dirHits.length * 10)
  const penalty = Math.min(12, missing.length * 3)
  const score = Math.max(0, Math.min(100, 40 + skillPart + dirPart - penalty))

  return {
    score,
    hits: Array.from(new Set(hits)).slice(0, 10),
    missing: Array.from(new Set(missing)).slice(0, 8),
  }
}

export interface PrefilterResult extends ScoreResult {
  pass: boolean
  reason: string
}

/**
 * 第一段：关键词预筛。目的不是判死岗位，而是把明显不相关的挡在 AI 深评之前，省 token。
 * 判定规则：本地分 >= threshold 才通过。基线 40 分意味着「一条技能/方向关键词都没命中」的 JD 会被挡下。
 */
export function prefilterJob(jd: string, title: string, profile: Profile | null, threshold = PREFILTER_THRESHOLD): PrefilterResult {
  const result = localScore(jd, title, profile)
  if (!jd.trim()) {
    return { ...result, pass: false, reason: '没有 JD 原文，无法评分' }
  }
  const pass = result.score >= threshold
  return {
    ...result,
    pass,
    reason: pass ? `预筛通过（本地分 ${result.score}）` : `预筛未通过（本地分 ${result.score} < ${threshold}），可直接跳过 AI 省额度`,
  }
}
