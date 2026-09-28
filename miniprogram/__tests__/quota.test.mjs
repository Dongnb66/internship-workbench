import { describe, expect, it } from 'vitest'

/**
 * 小程序那一端的额度台账。
 *
 * 为什么需要：那一端挂了计费门（默认拒绝），但**没有每日上限**。
 * 创建者一旦在开发者工具里把试用 flag 打开，那一端就是" unlimited 烧创建者额度"——
 * 网页端有的三道上限（每天几件事 / 单件事几步 / 全天几次）在它那儿一道都没有。
 *
 * 两条刻意：
 * 1. **限额数字与网页端逐字相同**，由跨端契约测试钉住。同一个产品里「今天还能跑 20 次巡检」
 *    在两端口径不同，用户会当成 bug，而代码不会报错。
 * 2. 台账**存设备**（小程序 storage 本来就是设备级），坏了 fail-open 但把 `degraded` 标出来——
 *    与网页端同向：护栏挡不住时要看得见，不能假装没事。
 */

const { DEFAULT_QUOTA, createQuotaStore, quotaStatus, taskSubject, todayKey } = require('../utils/quota')

describe('任务身份 = 能力 + 对象', () => {
  it('两个不同岗位不是同一件事（否则第 9 个被 8 步上限误杀）', () => {
    const a = taskSubject('JD 评估', '后端实习 A 公司：Go/K8s')
    const b = taskSubject('JD 评估', '前端实习 B 公司：React')
    expect(a).not.toBe(b)
    const records = [
      { day: '2026-09-27', task: a },
      { day: '2026-09-27', task: b },
    ]
    expect(quotaStatus(records, DEFAULT_QUOTA, DAY).usedTasks).toBe(2)
  })

  it('同一段文本重复评估算同一件事（这才是要熔断的那种转圈）', () => {
    const one = taskSubject('JD 评估', 'same jd')
    const again = taskSubject('JD 评估', 'same jd')
    expect(one).toBe(again)
  })

  it('空文本不炸，退化成只有能力名', () => {
    expect(taskSubject('JD 评估', '')).toBe('JD 评估')
    expect(taskSubject('JD 评估', null)).toBe('JD 评估')
  })

  it('标签带上正文长度，长 JD 前 60 字相同也不会撞', () => {
    const head = 'X'.repeat(70)
    const other = head + 'different tail'
    expect(taskSubject('JD 评估', head)).not.toBe(taskSubject('JD 评估', other))
  })
})

function memStore(initial) {
  const mem = new Map(Object.entries(initial || {}))
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
    raw: mem,
  }
}

// 夹具用**本地** 2026-09-27 10:00，不用 `new Date('2026-09-27T10:00:00+08:00')`：
// 那是个绝对瞬时，在 UTC-4 落到 09-26 22:00，`todayKey(DAY)` 于是变成 '2026-09-26'，
// 而下面手写的记录都带 `day: '2026-09-27'` —— 全部对不上，却只在西半球红。
// 台账的「今天」本来就该按使用者的本地日历日切，夹具必须把这件事表达清楚。
const DAY = new Date(2026, 8, 27, 10, 0, 0)

describe('三道上限（与网页端同一套数字）', () => {
  it('数字必须与 src/lib/quota.ts 一致（两端口径不同会被当成 bug）', async () => {
    const web = await import('../../src/lib/quota')
    expect(DEFAULT_QUOTA).toEqual(web.DEFAULT_QUOTA)
  })

  it('每任务步数必须等于智能体的 maxSteps 上限（否则熔断会误杀正常任务）', () => {
    // 8 这个数字在两处表示同一件事：一圈一次调用、最多 8 圈
    expect(DEFAULT_QUOTA.maxCallsPerTask).toBe(8)
    expect(DEFAULT_QUOTA.dailyTasks).toBeLessThan(DEFAULT_QUOTA.maxCallsPerDay)
  })
})

describe('台账行为', () => {
  it('满了 20 件事就拒绝第 21 件，并说清是"今天"的上限', () => {
    const full = Array.from({ length: DEFAULT_QUOTA.dailyTasks }, (_, i) => ({ day: '2026-09-27', task: `任务${i}` }))
    const s = quotaStatus(full, DEFAULT_QUOTA, DAY)
    expect(s.usedTasks).toBe(DEFAULT_QUOTA.dailyTasks)
    expect(s.allowed).toBe(false)
    expect(s.reasons.join('；')).toMatch(/今天|上限/)
  })

  it('同一件事转够 8 步就熔断（挡死循环）', () => {
    const loops = Array.from({ length: DEFAULT_QUOTA.maxCallsPerTask }, () => ({ day: '2026-09-27', task: '每日巡检' }))
    const s = quotaStatus(loops, DEFAULT_QUOTA, DAY, '每日巡检')
    expect(s.allowed).toBe(false)
    expect(s.reasons.join('；')).toMatch(/步数|循环|上限/)
  })

  it('今天转够 60 次调用就封顶（前两道还没撞时也要挡：那是总保险丝）', () => {
    // 3 件事 × 每件 7 步 = 21 次 < 20 件事？不，件数没满、每件事也没到 8 步，
    // 只有"今日总数"这一道该响——上一版测试完全没测到这一道。
    const records = []
    for (let t = 0; t < 9; t += 1) {
      for (let i = 0; i < 7; i += 1) records.push({ day: '2026-09-27', task: `任务${t}` })
    }
    const s = quotaStatus(records, DEFAULT_QUOTA, DAY)
    expect(s.callsToday).toBe(63)
    expect(s.allowed).toBe(false)
    expect(s.reasons.join('；')).toMatch(/总数|60/)
  })

  it('上一件事转满了 8 步，不该把下一件新事一起熔断（focusTask 只看自己）', () => {
    const loops = Array.from({ length: DEFAULT_QUOTA.maxCallsPerTask }, () => ({ day: '2026-09-27', task: '每日巡检' }))
    // 不指定在问谁：取"今天最热的"，那确实是失控的那件
    expect(quotaStatus(loops, DEFAULT_QUOTA, DAY).allowed).toBe(false)
    // 指定在问一件新事：它自己一步没转过，就该放行
    const fresh = quotaStatus(loops, DEFAULT_QUOTA, DAY, '新的一件')
    expect(fresh.allowed).toBe(true)
    expect(fresh.usedTasks).toBe(1)
  })

  it('昨天的记录不吃今天的额度', () => {
    const yesterday = [{ day: '2026-09-26', task: '昨天的事' }]
    expect(quotaStatus(yesterday, DEFAULT_QUOTA, DAY).usedTasks).toBe(0)
  })

  it('记账按天分桶，同名任务合并计数', () => {
    const store = createQuotaStore(memStore(), DEFAULT_QUOTA)
    store.record('每日巡检', todayKey(DAY))
    store.record('每日巡检', todayKey(DAY))
    store.record('JD 评估', todayKey(DAY))
    const s = store.status(todayKey(DAY), '每日巡检')
    expect(s.usedTasks).toBe(2)
    // 字段名与网页端一致：这里是 Map，不是普通对象（改名会让两端各写一份读取代码）
    expect(s.callsInTask.get('每日巡检')).toBe(2)
  })

  it('台账坏了是 fail-open，但 degraded 必须为真（挡不住时要看得见）', () => {
    const broken = {
      getItem() {
        throw new Error('storage down')
      },
      setItem() {
        throw new Error('storage down')
      },
    }
    const s = createQuotaStore(broken, DEFAULT_QUOTA).status(todayKey(DAY))
    expect(s.allowed).toBe(true)
    expect(s.degraded).toBe(true)
  })

  it('坏存储下记账不抛错（记账失败不该让 AI 整个不能用）', () => {
    const broken = {
      getItem() {
        throw new Error('storage down')
      },
      setItem() {
        throw new Error('storage down')
      },
    }
    expect(() => createQuotaStore(broken, DEFAULT_QUOTA).record('t', todayKey(DAY))).not.toThrow()
  })

  it('台账读到手改过的垃圾时按空处理，而不是崩', () => {
    const s = memStore({ [todayKey(DAY)]: '{不是数组}' })
    expect(() => createQuotaStore(s, DEFAULT_QUOTA).status(todayKey(DAY))).not.toThrow()
    expect(createQuotaStore(s, DEFAULT_QUOTA).status(todayKey(DAY)).usedTasks).toBe(0)
  })
})
