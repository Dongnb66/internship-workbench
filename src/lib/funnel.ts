import type { Row } from '../types'

/**
 * 漏斗转化统计 —— BENCHMARK P0（吸收 career-ops 的 stats / rejection-latency 思路）。
 *
 * 投递阶段历史一直在积累（沟通台账的 reply_status 流水 + 面试记录），但没有汇总：
 * 「投了多少、几个有回复、几个到面试、转化率多少、当时评的分准不准」全靠脑子记。
 * 这里全部用纯函数从四张表推导，不新增存储、不碰网络。
 *
 * 漏斗四层：投递 → 回复（对方回过话）→ 面试（约到笔试/面试）→ Offer。
 * 「已挂」不是漏斗一层，是漏斗的漏——它进校准而不是进转化率。
 */

export interface FunnelStats {
  applied: number
  byStage: Record<string, number>
  replied: number
  interview: number
  offer: number
  /** 回复率 / 面试率 / Offer 率：均相对投递总数；回复后到面率相对回复数 */
  repliedRate: number
  interviewRate: number
  offerRate: number
  interviewAfterReplyRate: number
}

function reachedInterview(app: Row, msgs: Row[], interviews: Row[]): boolean {
  if (['interview', 'offer'].includes(String(app.stage))) return true
  if (interviews.some((i) => Number(i.application_id) === Number(app.id))) return true
  return msgs.some((m) => Number(m.application_id) === Number(app.id) && m.reply_status === 'interview')
}

function gotReply(app: Row, msgs: Row[]): boolean {
  if (['written', 'interview', 'offer', 'rejected'].includes(String(app.stage))) return true
  return msgs.some((m) => Number(m.application_id) === Number(app.id) && ['replied', 'interview', 'rejected'].includes(String(m.reply_status)))
}

export function funnelStats(applications: Row[], messages: Row[], interviews: Row[], offers: Row[]): FunnelStats {
  const applied = applications.length
  const byStage: Record<string, number> = {}
  for (const a of applications) byStage[String(a.stage)] = (byStage[String(a.stage)] ?? 0) + 1

  const replied = applications.filter((a) => gotReply(a, messages)).length
  const interview = applications.filter((a) => reachedInterview(a, messages, interviews)).length
  const offerCompanies = new Set(offers.map((o) => String(o.company ?? '').trim()).filter(Boolean))
  const offer = applications.filter(
    (a) => String(a.stage) === 'offer' || (a.company && offerCompanies.has(String(a.company).trim())),
  ).length

  const rate = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100))
  const repliedApps = applications.filter((a) => gotReply(a, messages))

  return {
    applied,
    byStage,
    replied,
    interview,
    offer,
    repliedRate: rate(replied, applied),
    interviewRate: rate(interview, applied),
    offerRate: rate(offer, applied),
    interviewAfterReplyRate: rate(interview, repliedApps.length),
  }
}

export interface Calibration {
  /** 被拒投递的当时匹配分均值；无被拒记录为 null */
  rejectedAvg: number | null
  /** 推进到笔试/面试/Offer 的投递均分；无样本为 null */
  advancedAvg: number | null
  /** advancedAvg − rejectedAvg：正值越大说明「低分确实该拦」，接近 0 或负值说明预筛在瞎拦 */
  gap: number | null
}

/**
 * 评分校准（career-ops calibrate 思路）：预筛分数有没有用，唯一判据是
 * 「被拒的当时分」和「走到后面的当时分」拉开差距没有。只有一条投递时有结果也照算。
 */
export function calibration(applications: Row[], jobs: Row[]): Calibration {
  const scoreOf = (app: Row): number | null => {
    const job = jobs.find((j) => Number(j.id) === Number(app.job_id))
    const n = Number(job?.match_score)
    return Number.isFinite(n) ? n : null
  }
  const avg = (nums: number[]): number | null =>
    nums.length ? Math.round(nums.reduce((s, n) => s + n, 0) / nums.length) : null

  const rejected: number[] = []
  const advanced: number[] = []
  for (const app of applications) {
    const score = scoreOf(app)
    if (score === null) continue
    if (String(app.stage) === 'rejected') rejected.push(score)
    else if (['written', 'interview', 'offer'].includes(String(app.stage))) advanced.push(score)
  }
  const rejectedAvg = avg(rejected)
  const advancedAvg = avg(advanced)
  return {
    rejectedAvg,
    advancedAvg,
    gap: rejectedAvg !== null && advancedAvg !== null ? advancedAvg - rejectedAvg : null,
  }
}
