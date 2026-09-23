/**
 * 本地规则打分：不调用大模型也能给出可解释的匹配度。
 * 与服务端无关，无网络依赖，页面打开即可算。
 */

/** JD 中出现即视为潜在缺口的技术词（命中越多分越低） */
const WATCH_WORDS = [
  'redis', 'mongodb', 'kafka', 'k8s', 'kubernetes', 'elasticsearch', 'vue', 'c++',
  'pytorch', 'golang', 'go语言', 'dify', 'flink', 'spark', 'ceph', 'rust',
  'springcloud', 'hadoop'
]

const PREFILTER_THRESHOLD = 45

function localScore(jd, title, profile, watch) {
  const words = watch || WATCH_WORDS
  const text = String(title || '') + ' ' + String(jd || '')
  const lower = text.toLowerCase()
  const skills = ((profile && profile.skills) || []).filter(Boolean)
  const directions = ((profile && profile.directions) || []).filter(Boolean)
  const expectCities = (profile && profile.expect_city) || []

  const hits = []
  const missing = []

  for (let i = 0; i < expectCities.length; i += 1) {
    const c = expectCities[i]
    if (c && lower.indexOf(String(c).toLowerCase()) >= 0) { hits.push('工作城市符合期望'); break }
  }
  for (let i = 0; i < skills.length; i += 1) {
    const s = skills[i]
    if (s && lower.indexOf(String(s).toLowerCase()) >= 0) hits.push(String(s))
  }
  for (let i = 0; i < words.length; i += 1) {
    if (lower.indexOf(words[i]) >= 0) missing.push(words[i])
  }
  const dirHits = directions.filter(function (d) {
    return lower.indexOf(String(d).split(' ')[0].toLowerCase()) >= 0
  })
  for (let i = 0; i < dirHits.length; i += 1) hits.push(dirHits[i])

  const skillPart = Math.min(40, hits.length * 8)
  const dirPart = Math.min(20, dirHits.length * 10)
  const penalty = Math.min(12, missing.length * 3)
  const score = Math.max(0, Math.min(100, 40 + skillPart + dirPart - penalty))

  return { score: score, hits: uniq(hits).slice(0, 10), missing: uniq(missing).slice(0, 8) }
}

function uniq(list) {
  const out = []
  for (let i = 0; i < list.length; i += 1) {
    if (out.indexOf(list[i]) < 0) out.push(list[i])
  }
  return out
}

/**
 * 第一段：关键词预筛。目的不是判死岗位，而是把明显不相关的挡在 AI 深评之前，省额度。
 * 判定规则：本地分 >= threshold 才通过。基线 40 分意味着「一条技能/方向关键词都没命中」的 JD 会被挡下。
 */
function prefilterJob(jd, title, profile, threshold) {
  const limit = threshold === undefined ? PREFILTER_THRESHOLD : threshold
  const result = localScore(jd, title, profile)
  if (!String(jd || '').trim()) {
    return { score: result.score, hits: result.hits, missing: result.missing, pass: false, reason: '没有 JD 原文，无法评分' }
  }
  const pass = result.score >= limit
  return {
    score: result.score,
    hits: result.hits,
    missing: result.missing,
    pass: pass,
    reason: pass
      ? '预筛通过（本地分 ' + result.score + '）'
      : '预筛未通过（本地分 ' + result.score + ' < ' + limit + '），可直接跳过 AI 省额度'
  }
}

module.exports = {
  WATCH_WORDS: WATCH_WORDS,
  PREFILTER_THRESHOLD: PREFILTER_THRESHOLD,
  localScore: localScore,
  prefilterJob: prefilterJob
}
