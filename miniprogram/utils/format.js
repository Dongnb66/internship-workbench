function pad(n) {
  return n < 10 ? '0' + n : String(n)
}

function todayISO() {
  const d = new Date()
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function fmtDate(value) {
  if (!value) return '—'
  const d = new Date(String(value).replace(/-/g, '/').replace('T', ' ').replace(/\..*$/, ''))
  if (isNaN(d.getTime())) return String(value).slice(0, 10)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function fmtDateTime(value) {
  if (!value) return '—'
  const d = new Date(String(value).replace(/-/g, '/').replace('T', ' ').replace(/\..*$/, ''))
  if (isNaN(d.getTime())) return String(value)
  return fmtDate(value) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** 距今天数：正数=还有几天，0=今天，负数=已过 */
function daysLeft(value) {
  if (!value) return null
  const d = new Date(String(value).slice(0, 10).replace(/-/g, '/'))
  if (isNaN(d.getTime())) return null
  const today = new Date(todayISO().replace(/-/g, '/'))
  return Math.round((d.getTime() - today.getTime()) / 86400000)
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

module.exports = { pad, todayISO, fmtDate, fmtDateTime, daysLeft, leftText, textToArray, num, dateOnly }
