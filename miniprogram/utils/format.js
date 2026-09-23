function pad(n) {
  return n < 10 ? '0' + n : String(n)
}

function todayISO() {
  const d = new Date()
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

/**
 * 把各种后端日期表示解析成 Date。
 *
 * ⚠️ 口径必须与 Web 端 `src/lib/format.ts` 的 `new Date(value)` 对齐。
 * 原先这里先 `replace(/-/g,'/')` 再去掉 `T...` 后缀，等于把时区信息整个丢掉、
 * 强制按本地时间解释；而 Web 端保留原串，让引擎按 ISO 规则处理（带 Z 或偏移时按 UTC）。
 * 后果是同一个 `deadline` 两端能差一整天：`2026-09-25T16:00:00.000Z` 在 UTC+8 下
 * Web 显示 09-26、小程序显示 09-25，于是「剩 N 天」和「是否 3 天内截止」的判定不一致。
 *
 * 策略：纯日期串（YYYY-MM-DD）按本地时间构造，避免被当成 UTC 后在上海时区里退回前一天；
 * 其余情况交给 `new Date` 走标准解析。
 */
function parseDate(value) {
  const s = String(value).trim()
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.exec(s)
  if (dateOnly) {
    const parts = s.split('-')
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
  }
  return new Date(s)
}

function fmtDate(value) {
  if (!value) return '—'
  const d = parseDate(value)
  if (isNaN(d.getTime())) return String(value).slice(0, 10)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function fmtDateTime(value) {
  if (!value) return '—'
  const d = parseDate(value)
  if (isNaN(d.getTime())) return String(value)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/**
 * 距今天数：正数=还有几天，0=今天，负数=已过。
 *
 * 先把时间点解析成**本地日历日**再比，而不是 `slice(0,10)` 后直接比 ——
 * 后者会把 `2026-09-25T16:00:00Z` 当成 09-25，但这在 UTC+8 实际已是 09-26 的 00:00，
 * 于是「剩 N 天」比 Web 端少算一天。走 `parseDate` 保留时区语义，再取本地日期。
 */
function daysLeft(value) {
  if (!value) return null
  const d = parseDate(value)
  if (isNaN(d.getTime())) return null
  const thatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const today = new Date(todayISO().replace(/-/g, '/'))
  return Math.round((thatDay.getTime() - today.getTime()) / 86400000)
}

function leftText(value) {
  const n = daysLeft(value)
  if (n === null) return '—'
  if (n < 0) return '已过 ' + Math.abs(n) + ' 天'
  if (n === 0) return '今天'
  return '剩 ' + n + ' 天'
}

/** 把「顿号/逗号/空格」分隔的输入切成数组，用于技能、期望城市这类多值字段 */
function textToArray(value) {
  return String(value || '')
    .split(/[,，、\s]+/)
    .map(function (s) { return s.trim() })
    .filter(function (s) { return s })
}

function num(value) {
  const n = Number(value)
  return isFinite(n) ? n : 0
}

/** 去掉 ISO 时间串里的时区与毫秒，供 <picker mode="date"> 使用 */
function dateOnly(value) {
  return value ? String(value).slice(0, 10) : todayISO()
}

module.exports = { pad, todayISO, fmtDate, fmtDateTime, daysLeft, leftText, textToArray, num, dateOnly, parseDate }
