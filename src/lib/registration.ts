/**
 * 注册收口：**这个站不再自行创建账号**。
 *
 * 为什么这是这次改动的一部分：站的地址是公网可达的，而原先登录页写着
 * 「无需单独注册：填邮箱收验证码，首次使用会自动为你创建账号并登录」。
 * 任何人拿到链接都能开一个号，然后每一个 AI 调用都记在应用创建者的额度上
 * （平台错误码前缀 `quota_`，语义是 Creator quota）。计费门把「花钱」挡住了，
 * 这一档挡的是「进来」。
 *
 * 能做与不能做，一句话写清（不写清就是文档在说谎）：
 * - **做得到**：让这个应用自己不再创建账号。账号只在 `verifyOtp(isExistingUser:false)`
 *   这一步产生，而这一步现在必须先过这道门。从界面进来的路人被挡在外面。
 * - **做不到**：挡住绕过界面、直接拿应用标识去调认证接口的人。认证服务侧的
 *   sign-up 开关不在代码可达范围内（本构建里连数据库管理工具都没挂载，
 *   「把邀请码名单放数据库」这条路也走不了），所以名单只能是一份源码常量。
 *   既然它是常量，界面上就必须把这句话说明白，而不是假装已经关严了。
 */

/**
 * 出厂值：占位符。**它不是可用的码**——它写在源码里，而源码是公开的。
 *
 * 名单里只有占位符时 `codesAreConfigured()` 为 false，新注册一律拒绝。
 * 也就是说这个仓库默认处于「关闭」状态，创建者必须显式换成自己的码才开门。
 */
export const PLACEHOLDER_CODE = 'REPLACE-ME-邀请码'

/** 创建者在这里列出发给谁的邀请码（一次一个也行）。改完重新发布即生效。 */
export const INVITE_CODES: string[] = [PLACEHOLDER_CODE]

/** 人抄码会抄出各种样子：去空格 + 忽略大小写，除此之外不做任何"聪明"的匹配 */
export function normalizeCode(code: string): string {
  return String(code ?? '').trim().toLowerCase()
}

/** 名单到底配了没：空名单、只有占位符，都算没配（没配 = 关闭） */
export function codesAreConfigured(list: string[] = INVITE_CODES): boolean {
  const placeholder = normalizeCode(PLACEHOLDER_CODE)
  return list.some((c) => {
    const n = normalizeCode(c)
    return n !== '' && n !== placeholder
  })
}

export interface GateInput {
  /** `sendOtp` 的返回值：这个邮箱是不是已经有账号了 */
  isExistingUser: boolean
  code: string
  /**
   * 邀请码名单。默认取出厂那份，但**必须可以注入**：
   * 出厂状态是「只有占位符」（= 关闭），如果判定只能读常量，
   * 「码对得上就放行」这条分支在测试里根本走不到。
   */
  list?: string[]
}

export interface GateResult {
  allowed: boolean
  /** true = 放行且这一步会真的创建账号（界面上要按这个说清楚） */
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
  const code = normalizeCode(input.code)
  if (!codesAreConfigured(list)) {
    return {
      allowed: false,
      createsAccount: false,
      reason:
        '这个工作台现在关闭自行注册：新邮箱要凭邀请码开账号。' +
        '而创建者那边还没设置邀请码（源码里的名单仍是占位符），所以现在谁都注册不进来。' +
        '已有账号用验证码或密码登录不受影响。',
    }
  }
  if (!code) {
    return {
      allowed: false,
      createsAccount: false,
      reason: '新邮箱需要邀请码才能开账号：向应用创建者要一个。已有账号请直接用验证码或密码登录。',
    }
  }
  // 占位符**永远不算可用码**：它就躺在源码里，公开可读，按「列表里有没有」一比就等于门没关。
  const placeholder = normalizeCode(PLACEHOLDER_CODE)
  const hit = list.some((c) => {
    const n = normalizeCode(c)
    return n !== '' && n !== placeholder && n === code
  })
  if (!hit) {
    return {
      allowed: false,
      createsAccount: false,
      reason: '邀请码不对。这个站按邀请码开账号，不开放自行注册；已有账号请用验证码或密码登录。',
    }
  }
  return { allowed: true, createsAccount: true, reason: '' }
}
