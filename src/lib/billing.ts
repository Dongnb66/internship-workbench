/**
 * 计费门：**默认不花创建者的钱**。
 *
 * 这个应用原先只有一条 AI 通道——平台云服务的模型代理，而它的额度语义是
 * **Creator quota**（记在应用创建者账上）。也就是说「任何注册用户点一下 AI，钱记在你头上」。
 * 这道门把这件事反过来：没有用户自己的 Key、也没人显式开试用开关，AI 一律不调用。
 *
 * 三条判定的顺序是刻意的：
 * 1. 有用户 Key → 走 byo（用户付）。
 * 2. 有 Key 但通道没接通 → **宁可拒绝，也不回落到平台额度**。
 *    静默回落是这里最坏的失败模式：不报错、不提示，只有账单在涨，
 *    而且涨的是别人的钱。测试里专门有一条钉住它。
 * 3. 只有创建者试用开关打开 → 走平台额度，明确标出 paidBy='creator'，
 *    并且仍然受 `quota.ts` 的日限与每任务步数约束（两道门叠加，不是二选一）。
 *
 * 默认值必须是「关」：读不到、存储坏了、抛异常，一律按关闭处理——
 * 宁可 AI 功能不能用，也不能悄悄花钱。
 */

/** 创建者试用开关（默认关） */
export const OWNER_TRIAL_KEY = 'wb_owner_trial'
/** 用户自备 Key，只存在本机 localStorage；本项目**不在服务端保管任何人的 Key** */
export const BYO_KEY_KEY = 'wb_byo_key'
/** 选了哪家厂商（与 Key 配套，同样是设备级） */
export const BYO_PRESET_KEY = 'wb_byo_preset'

export type AiAccess = 'byo' | 'owner-trial' | 'none'
export type PaidBy = 'user' | 'creator' | 'nobody'

export interface AccessInput {
  hasUserKey: boolean
  ownerTrial: boolean
  /** 自备 Key 通道是否真的能发请求（本地网关在跑） */
  byoReady: boolean
}

export interface AccessDecision {
  allowed: boolean
  access: AiAccess
  paidBy: PaidBy
  /** 拒绝时给用户看的话；放行时是空串 */
  reason: string
}

/**
 * 纯函数：所有判定都在这里，界面与 streamChat 都问它，避免两处各写一遍规则。
 * （同一个仓库里「谁能用 AI」写两遍，迟早一处严一处松。）
 */
export function decideAccess(input: AccessInput): AccessDecision {
  if (input.hasUserKey) {
    if (input.byoReady) return { allowed: true, access: 'byo', paidBy: 'user', reason: '' }
    return {
      allowed: false,
      access: 'none',
      // 付款方写成 nobody 而不是 creator：这句话本身就是承诺——绝不悄悄记到创建者头上
      paidBy: 'nobody',
      reason:
        '你填了自备 Key，但自备 Key 通道现在没接通（需要在自己电脑上跑本地网关）。' +
        '这里**不会改用本应用的额度**——那等于让应用创建者替你付钱。请启动本地网关后重试。',
    }
  }
  if (input.ownerTrial) return { allowed: true, access: 'owner-trial', paidBy: 'creator', reason: '' }
  return {
    allowed: false,
    access: 'none',
    paidBy: 'nobody',
    reason:
      'AI 功能需要自备模型 Key（DeepSeek / 智谱 / Kimi，花你自己账户的余额），' +
      '或由应用创建者在「设置 — AI 通道」里开启「用本应用的额度试用」。' +
      '本应用的额度记在创建者账号上，不默认替使用者承担。',
  }
}

/**
 * byo 通道的就绪状态。
 * 由接线层（本地网关探活 / 网关路由注册）显式置位，**默认 false**：
 * 未接通就等价于「不能发」，而不是「发不出去就换一条路」。
 */
let byoReady = false

export function setByoReady(v: boolean): void {
  byoReady = v === true
}

export function isByoReady(): boolean {
  return byoReady
}

function read(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
  } catch {
    // 隐私模式 / 配额爆了：读不到就按「关」处理，不抛错也不猜测
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // 存不下就用不了这项能力，符合「宁可不能用，不可悄悄花钱」
  }
}

export function getOwnerTrialEnabled(): boolean {
  return read(OWNER_TRIAL_KEY) === '1'
}

export function setOwnerTrialEnabled(v: boolean): void {
  write(OWNER_TRIAL_KEY, v ? '1' : null)
}

/** 只看「有没有填」，不返回 Key 本身：调用方拿到 Key 的路径只有发请求那一处 */
export function hasUserKey(): boolean {
  return String(read(BYO_KEY_KEY) ?? '').trim().length > 0
}

/** 把三处状态合成一个判定，供 streamChat 与界面共用 */
export function currentAccess(): AccessDecision {
  return decideAccess({ hasUserKey: hasUserKey(), ownerTrial: getOwnerTrialEnabled(), byoReady: isByoReady() })
}
