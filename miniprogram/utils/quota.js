/**
 * 小程序端的限额护栏（`src/lib/quota.ts` 的同规则端口）。
 *
 * 为什么这一端也要有：那一端挂了计费门（默认拒绝），但**没有上限**。
 * 创建者一旦在开发者工具里把试用 flag 打开，小程序就是"不限次地烧创建者额度"，
 * 而网页端早就有的三道闸在它这儿一道都没有。
 *
 * 两道门叠加、不是二选一：计费门管「这单谁付」，这道管「即使有人付，也不能失控」。
 * 三道上限缺一不可，单位与网页端逐字相同（跨端契约测试钉住数字）：
 * 用户看得懂「今天还能跑 20 次巡检」，看不懂「还能调 137 次模型」。
 */

/** 与 `src/lib/quota.ts` 的 DEFAULT_QUOTA 必须一模一样，有跨端断言盯着 */
var DEFAULT_QUOTA = {
  dailyTasks: 20,
  // 8 = 智能体一圈一次调用、最多 8 圈。比步数上限松就等于没有这道闸
  maxCallsPerTask: 8,
  maxCallsPerDay: 60,
}

function pad(n) {
  return n < 10 ? '0' + n : String(n)
}

/** 台账按本地日分桶（跨过午夜就重新计数，与网页端同一口径） */
function todayKey(now) {
  var d = now || new Date()
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function keyFor(day) {
  return 'wb_quota_' + day
}

/** 今天转得最多的那个任务名（没记录时返回空串，空串计数为 0，不会误判熔断） */
function hottestTask(callsInTask) {
  var best = ''
  var max = 0
  callsInTask.forEach(function (n, task) {
    if (n > max) {
      max = n
      best = task
    }
  })
  return best
}

function emptyStatus(config) {
  return {
    usedTasks: 0,
    remainingTasks: config.dailyTasks,
    callsToday: 0,
    callsInTask: new Map(),
    taskStopped: false,
    degraded: false,
    allowed: true,
    reasons: [],
  }
}

/**
 * 纯函数：所有判定都在这里，页面与调用入口都问它。
 *
 * @param {{day: string, task: string}[]} records 台账记录
 * @param {object} config 上限
 * @param {Date} now 今天算哪一天（注入它才能断言"昨天的记录不吃今天的额度"）
 * @param {string} [focusTask] 正在问哪件事；不给就按"今天有没有任何事撞过上限"
 */
function quotaStatus(records, config, now, focusTask) {
  var list = Array.isArray(records) ? records : []
  var day = todayKey(now)
  var todays = list.filter(function (r) {
    return r && r.day === day && typeof r.task === 'string'
  })
  var callsInTask = new Map()
  todays.forEach(function (r) {
    callsInTask.set(r.task, (callsInTask.get(r.task) || 0) + 1)
  })

  var usedTasks = callsInTask.size
  var callsToday = todays.length
  var stoppedTask = focusTask === undefined ? hottestTask(callsInTask) : focusTask
  var taskStopped = (callsInTask.get(stoppedTask) || 0) >= config.maxCallsPerTask

  var reasons = []
  if (usedTasks >= config.dailyTasks) {
    reasons.push('今天 ' + config.dailyTasks + ' 次 AI 任务已用完（额度记在应用创建者账号上，不是你欠费）')
  }
  if (taskStopped) {
    reasons.push('任务「' + stoppedTask + '」已达单次 ' + config.maxCallsPerTask + ' 步上限，循环被熔断')
  }
  if (callsToday >= config.maxCallsPerDay) {
    reasons.push('今日模型调用总数已达 ' + config.maxCallsPerDay + ' 次上限')
  }

  return {
    usedTasks: usedTasks,
    remainingTasks: Math.max(0, config.dailyTasks - usedTasks),
    callsToday: callsToday,
    callsInTask: callsInTask,
    taskStopped: taskStopped,
    degraded: false,
    allowed: reasons.length === 0,
    reasons: reasons,
  }
}

/**
 * 存储适配器。
 *
 * 台账读不到 / 存不进时是 **fail-open 但 `degraded` 可见**：护栏坏掉时宁可放行，
 * 也不能在存储抖一下的时候把整个 AI 功能变砖——但必须让人看得见它现在挡不住。
 * 这一点与计费门方向相反，是刻意的：计费门读不到就拒绝（没人同意花钱），
 * 台账读不到就放行但标降级（数错了不该怪用户）。
 */
function createQuotaStore(storage, config) {
  var conf = config || DEFAULT_QUOTA

  function read(day) {
    var raw = storage.getItem(keyFor(day))
    if (!raw) return []
    try {
      var parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      // 手改过的、半个 JSON 的、旧格式的：一律按空处理，而不是崩在护栏自己身上
      return []
    }
  }

  return {
    get available() {
      try {
        storage.getItem(keyFor(todayKey()))
        return true
      } catch {
        return false
      }
    },
    status: function (day, focusTask) {
      var d = day || todayKey()
      try {
        return quotaStatus(read(d), conf, d ? new Date(d + 'T12:00:00') : new Date(), focusTask)
      } catch {
        var s = emptyStatus(conf)
        s.degraded = true
        return s
      }
    },
    record: function (task, day) {
      var d = day || todayKey()
      try {
        var list = read(d)
        list.push({ day: d, task: String(task || '未标注') })
        storage.setItem(keyFor(d), JSON.stringify(list))
      } catch {
        // 记不上账不能把 AI 打死：那是"护栏坏了"升级成"整站坏了"
      }
    },
  }
}

/**
 * 任务身份 = **能力 + 对象**，不是只有能力。
 *
 * 批量评估几个岗位时，每个岗位各是用户眼里的一件「事」；共用「JD 评估」这一个标签，
 * 第 9 个就会被每任务 8 步上限当成失控循环误杀。反过来，同一件事转很多圈正是这道闸要挡的。
 * 取正文开头 60 字 + 总长：同一段文本重复评估仍算同一件事，不同岗位几乎不会撞。
 */
function taskSubject(prefix, text) {
  var key = String(text == null ? '' : text).trim()
  if (!key) return String(prefix || '')
  return prefix + '：' + key.slice(0, 60) + '(' + key.length + ')'
}

module.exports = {
  DEFAULT_QUOTA: DEFAULT_QUOTA,
  todayKey: todayKey,
  keyFor: keyFor,
  taskSubject: taskSubject,
  quotaStatus: quotaStatus,
  createQuotaStore: createQuotaStore,
}
