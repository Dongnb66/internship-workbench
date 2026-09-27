/**
 * 限额护栏（AGENT_PLAN 第一步）。
 *
 * 为什么必须存在：本应用的模型额度记在**应用创建者**账号上（见 ai.ts 的 aiErrorText），
 * 用户看不见消耗、也不会欠费。agent 循环一次任务要调多次模型，没有护栏就是
 * 「创建者为一次失控循环买单」。
 *
 * 三道上限缺一不可，各挡一种失控：
 * - dailyTasks       用户视角的「今天还能干几件事」，挡正常用量
 * - maxCallsPerTask  单件事转的圈数，挡 agent 死循环（等于 maxSteps，见下）
 * - maxCallsPerDay   当日调用总数，前两道都没命中时的总保险丝
 *
 * 计数落点选了 **localStorage（设备级）**而不是 profile 表列：
 * 后者是一次 schema 迁移，而 AGENTS.md §1 把数据模型设计划归人拍板；
 * 从 ai_reports / knowledge 反算也不可靠——只有部分调用点会落库。
 * 代价写明白：清站点数据或换浏览器会归零，所以它挡的是「失控量」，
 * 不是「铁了心的自我攻击」。这一条要在 UI 上如实说明，不要装作能防住一切。
 */
import { pad } from './format'

/** 一次模型调用：落在哪个日历日、属于哪个任务 */
export interface CallRecord {
  day: string
  task: string
}

export interface QuotaConfig {
  dailyTasks: number
  maxCallsPerTask: number
  maxCallsPerDay: number
}

export const DEFAULT_QUOTA: QuotaConfig = {
  dailyTasks: 20,
  // 8 = agent 循环的 maxSteps：一圈一次调用，转满 8 圈就是「跑完了整个循环」而非失控。
  // 比 maxSteps 松就等于没有这道闸。
  maxCallsPerTask: 8,
  maxCallsPerDay: 60,
}

export interface QuotaStatus {
  usedTasks: number
  remainingTasks: number
  callsToday: number
  callsInTask: Map<string, number>
  /** 有任务撞到每任务上限 */
  taskStopped: boolean
  /** 存储读不到 → 这一道闸形同虚设，必须让调用方可见 */
  degraded: boolean
  allowed: boolean
  reasons: string[]
}

/** 本地日历日，与 format.ts 的 todayISO 同口径（不用 slice(0,10)，那截的是 UTC 日） */
function dayKey(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** 正午而不是零点：构造给定日历日时避开时区边界，dayKey 一定回到同一个 day */
function dayDate(day: string): Date {
  return new Date(`${day}T12:00:00`)
}

/** 今天转得最多的那个任务名（没记录时返回空串，空串的计数是 0，不会误判熔断） */
function hottestTask(callsInTask: Map<string, number>): string {
  let best = ''
  let max = 0
  for (const [task, n] of callsInTask) {
    if (n > max) {
      max = n
      best = task
    }
  }
  return best
}

export function quotaStatus(
  records: CallRecord[],
  config: QuotaConfig,
  now: Date = new Date(),
  /**
   * 「正在问哪个任务」。给了就只对这个任务判每任务熔断，没给就当成「今天有没有任何任务
   * 撞过上限」——批量评估里第 9 个岗位不该被上一件事的失控误杀。
   */
  focusTask?: string,
): QuotaStatus {
  const today = dayKey(now)
  const todays = records.filter((r) => r.day === today)

  const callsInTask = new Map<string, number>()
  for (const r of todays) callsInTask.set(r.task, (callsInTask.get(r.task) ?? 0) + 1)

  const usedTasks = callsInTask.size
  const callsToday = todays.length

  // 熔断针对谁：focusTask 存在时只看它自己；否则取今天转得最多的那一个
  const stoppedTask = focusTask !== undefined ? focusTask : hottestTask(callsInTask)
  const taskStopped = (callsInTask.get(stoppedTask) ?? 0) >= config.maxCallsPerTask

  const reasons: string[] = []
  if (usedTasks >= config.dailyTasks) {
    reasons.push(`今天 ${config.dailyTasks} 次 AI 任务已用完（额度记在应用创建者账号上，不是你欠费）`)
  }
  if (taskStopped) {
    reasons.push(`任务「${stoppedTask}」已达单次 ${config.maxCallsPerTask} 步上限，循环被熔断`)
  }
  if (callsToday >= config.maxCallsPerDay) {
    reasons.push(`今日模型调用总数已达 ${config.maxCallsPerDay} 次上限`)
  }

  return {
    usedTasks,
    remainingTasks: Math.max(0, config.dailyTasks - usedTasks),
    callsToday,
    callsInTask,
    taskStopped,
    degraded: false,
    allowed: reasons.length === 0,
    reasons,
  }
}

export interface StartDecision {
  allowed: boolean
  /** 拒绝时给用户看的话；放行时是空串（不要返回「可以开始」这种废话） */
  text: string
}

/** 用户点一下按钮（跑一次巡检 / 评估一个 JD）之前的那道问闸 */
export function canStartTask(
  records: CallRecord[],
  config: QuotaConfig,
  now: Date = new Date(),
  focusTask?: string,
): StartDecision {
  const s = quotaStatus(records, config, now, focusTask)
  return { allowed: s.allowed, text: s.allowed ? '' : s.reasons.join('；') }
}

/** 只用到 getItem/setItem 的最小存储面（测试注入 Map，运行时传 localStorage） */
export interface QuotaStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORE_PREFIX = 'wb_quota'

function taskKey(day: string): string {
  return `${STORE_PREFIX}_${day}`
}

function readDay(storage: QuotaStorage, day: string): CallRecord[] {
  const raw = storage.getItem(taskKey(day))
  if (!raw) return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((t): t is string => typeof t === 'string')
    .map((task) => ({ day, task }))
}

export interface QuotaStore {
  /** false = 存储用不了（隐私模式 / 配额爆了），护栏降级 */
  available: boolean
  status(day: string, focusTask?: string): QuotaStatus
  record(task: string, day: string): void
}

/**
 * 降级时**故意 fail-open**（挡不住，但把 degraded 摆出来）：
 * 这是自用工作台，把 AI 全禁掉会让人连手工记录都用不上，代价比放过大。
 * UI 必须提示「额度记录不可用」，否则护栏哪天坏掉没人知道。
 */
export function createQuotaStore(storage: QuotaStorage, config: QuotaConfig = DEFAULT_QUOTA): QuotaStore {
  let broken = false
  try {
    storage.getItem(taskKey(dayKey(new Date())))
  } catch {
    broken = true
  }

  const degraded = (): QuotaStatus => ({
    usedTasks: 0,
    remainingTasks: config.dailyTasks,
    callsToday: 0,
    callsInTask: new Map<string, number>(),
    taskStopped: false,
    degraded: true,
    allowed: true,
    reasons: [],
  })

  return {
    get available() {
      return !broken
    },
    status(day: string, focusTask?: string): QuotaStatus {
      if (broken) return degraded()
      try {
        return quotaStatus(readDay(storage, day), config, dayDate(day), focusTask)
      } catch {
        broken = true
        return degraded()
      }
    },
    record(task: string, day: string): void {
      if (broken) return
      try {
        const todays = readDay(storage, day)
        const next = [...todays.map((r) => r.task), task]
        storage.setItem(taskKey(day), JSON.stringify(next))
      } catch {
        broken = true
      }
    },
  }
}
