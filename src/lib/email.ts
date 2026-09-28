/**
 * 邮箱格式前置校验 + 云服务校验类错误的转译。
 *
 * 起因（2026-09-28 实测）：登录页邮箱框里只填了「2088417049」，点「发送验证码」后
 * 界面上出现的是服务端原文 ——
 *   invalid SendVerificationCodeRequest.Email: value does not match regex pattern
 *   "^[^1][0-9A-Za-z_]{1,40}@[0-9A-Za-z_]{1,40}\.[A-Za-z]{1,10}$"
 * 用户看到的是一串正则，而不是「你少填了 @ 和域名」。这里补两层：
 *   1) 提交前拦「明显不是邮箱」的输入，直接说清缺什么、该长什么样；
 *   2) 万一仍有请求漏过去，由 errText 走 humanizeCloudError 兜底翻成人话。
 *
 * 边界：这里刻意**不比服务端更严**。判定权仍在服务端正则，前端只负责在明显
 * 错误时给一句能看懂的话 —— 绝不因为「我以为不合法」而挡掉合法输入。
 */

/** 宽松形态：有 @、@ 前后非空且不含空白、域名带点且后缀至少两位字母。 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/

export function emailLooksValid(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim())
}

/**
 * 给界面用的中文提示，合法时返回 null。
 * 「缺 @」这一支要顺带把建议补全（`2088417049` → `2088417049@qq.com`），
 * 用户可以直接照着抄，而不是读一句「格式不正确」再猜。
 */
export function emailProblem(value: string): string | null {
  const v = value.trim()
  if (!v) return '请先填写邮箱'
  if (!v.includes('@')) {
    return `「${v}」不是邮箱地址 —— 缺了「@域名」，应该填成像 ${v}@qq.com 这样`
  }
  if (!EMAIL_SHAPE.test(v)) {
    return `「${v}」格式不对，应形如「用户名@域名」，例如 example@qq.com`
  }
  return null
}

/**
 * 把云服务返回的原文翻成人话。只处理能确定含义的几类，其余**原样透出** ——
 * 宁可显示英文原文，也不要编一个可能不对的中文原因。
 */
export function humanizeCloudError(raw: string): string {
  if (!raw) return '请求失败，请重试'
  if (/regex pattern/i.test(raw)) {
    if (/email/i.test(raw)) return '邮箱格式不对，请填完整地址，例如 2088417049@qq.com'
    if (/code|token/i.test(raw)) return '验证码格式不对，应为 6 位数字'
    if (/password/i.test(raw)) return '密码不符合要求，至少 6 位'
    return '填写的内容格式不符合要求，请检查后重试'
  }
  return raw
}
