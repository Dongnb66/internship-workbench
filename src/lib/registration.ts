/**
 * 注册口径。**这一条当天改过一次，原因是我把账算错了，所以把过程留在文件里。**
 *
 * 第一版是「新邮箱一律要凭邀请码」，理由是：站的地址公网可达，任何人拿到链接都能开号，
 * 然后每个 AI 调用都记在应用创建者的额度上（平台错误码前缀 `quota_`，语义 Creator quota）。
 * 听起来必须关。
 *
 * 但自备 Key + 计费门落地之后，那句话的**前提没了**：AI 默认花使用者自己的钱（或本机模型），
 * 「用本应用的额度」那一档既默认关着、开关又只认创建者账号。一个陌生人注册进来，
 * 他在 AI 上花这个站 0 元。于是这道门买到的东西变成三样：验证邮件额度省一点、
 * 公共岗位库少点垃圾、以及**每加一个用户创建者都要亲自发一次码** ——
 * 最后那条正好砸在「让人自己用上」这个目的上。所以默认改成**开放注册**。
 *
 * 只有一个旋钮，不留两个会互相矛盾的开关：
 * `INVITE_CODES` 里**有真码 = 上锁**（要码才放行）；只有占位符 = **开放**。
 * 想彻底不让人进，填一枚只有你自己知道的码就行，不需要额外的模式位。
 *
 * 仍然成立的限度（界面上也要说清，别假装关严）：这些都是**前端**判定。账号只在
 * `verifyOtp(isExistingUser:false)` 那一步产生，门挡在那之前，所以从界面进来的路径受控；
 * 绕过页面直接调认证接口的，代码管不了 —— 那一半在云控制台。
 */

/**
 * 占位符：**它永远不是一把可用的码**。
 *
 * 名单里只有它 = 没上锁 = 开放注册（出厂状态）。判定逻辑把它排除在候选之外，
 * 因为"码"写在源码里、源码在产物里、产物公开可读 —— 拿它当码等于没锁。
 */
export const PLACEHOLDER_CODE = 'REPLACE-ME-邀请码'

/** 出厂只有占位符 = 开放注册。要上锁就在这里填真码（一枚也行），改完重新发布生效。 */
export const INVITE_CODES: string[] = [PLACEHOLDER_CODE]

/** 人抄码会抄出各种样子：去空格 + 忽略大小写，除此之外不做任何"聪明"的匹配 */
export function normalizeCode(code: string | null | undefined): string {
  return String(code ?? '').trim().toLowerCase()
}

/** 名单里有没有真码（空名单、只有占位符都算没有） */
export function codesAreConfigured(list: string[] = INVITE_CODES): boolean {
  const placeholder = normalizeCode(PLACEHOLDER_CODE)
  return list.some((c) => {
    const n = normalizeCode(c)
    return n !== '' && n !== placeholder
  })
}

/**
 * 当前是开放注册还是要码。**唯一来源是名单本身**：
 * 有真码就是 'invite'，没有就是 'open'。界面上那栏邀请码也读这个，
 * 免得出厂开放着、页面上却写着"需要邀请码"。
 */
export function registrationMode(list: string[] = INVITE_CODES): 'open' | 'invite' {
  return codesAreConfigured(list) ? 'invite' : 'open'
}

export interface GateInput {
  /** `sendOtp` 的返回值：这个邮箱是不是已经有账号了 */
  isExistingUser: boolean
  code: string
  /**
   * 邀请码名单。默认取出厂那份，但**必须可以注入**：
   * 出厂是开放状态，如果判定只能读常量，「锁上并要求码」那整条分支在测试里走不到。
   */
  list?: string[]
}

export interface GateResult {
  allowed: boolean
  /** true = 放行且这一步会真的创建账号（界面上要按这个说清楚，不许悄悄建号） */
  createsAccount: boolean
  reason: string
}

/**
 * 唯一的判定点。登录页只问它，不许自己再拼一遍规则。
 *
 * 拒绝理由里**不回显提交上来的码**：截图与日志会留下它，
 * 而被人看到"猜什么会失败"本身就是给猜码的人省时间。
 */
export function signupGate(input: GateInput): GateResult {
  if (input.isExistingUser) return { allowed: true, createsAccount: false, reason: '' }
  const list = input.list ?? INVITE_CODES
  // 开放模式：不看码。半开半闭最误导人 —— 要么明说不要码，要么明说一定要。
  if (registrationMode(list) === 'open') return { allowed: true, createsAccount: true, reason: '' }

  const code = normalizeCode(input.code)
  if (!code) {
    return {
      allowed: false,
      createsAccount: false,
      reason: '这个工作台现在按邀请码开账号：向应用创建者要一个。已有账号请直接用验证码或密码登录。',
    }
  }
  const placeholder = normalizeCode(PLACEHOLDER_CODE)
  const hit = list.some((c) => {
    const n = normalizeCode(c)
    return n !== '' && n !== placeholder && n === code
  })
  if (!hit) {
    return {
      allowed: false,
      createsAccount: false,
      reason: '邀请码不对。这个站现在按邀请码开账号；已有账号请用验证码或密码登录。',
    }
  }
  return { allowed: true, createsAccount: true, reason: '' }
}
