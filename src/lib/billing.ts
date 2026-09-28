/**
 * 计费门：**默认不花创建者的钱**。
 *
 * 这个应用原先只有一条 AI 通道——平台云服务的模型代理，而它的额度语义是
 * **Creator quota**（记在应用创建者账上）。也就是说「任何注册用户点一下 AI，钱记在你头上」。
 * 这道门把这件事反过来：没有用户自己的 Key、也没人显式开试用开关，AI 一律不调用。
 *
 * 三条判定的顺序是刻意的：
 * 1. 自备通道**配置好了** → 走 byo（用户付）。
 *    「配置好」跟着选的那一档走：要 Key 的厂商得有 Key，本机模型不需要 Key。
 * 2. 配置好了但那一档**现在发不出去** → 宁可拒绝，也不回落到平台额度。
 *    静默回落是这里最坏的失败模式：不报错、不提示，只有账单在涨，
 *    而且涨的是别人的钱。测试里专门有一条钉住它。
 * 3. 只有创建者试用开关打开 → 走平台额度，明确标出 paidBy='creator'，
 *    并且仍然受 `quota.ts` 的日限与每任务步数约束（两道门叠加，不是二选一）。
 *
 * 默认值必须是「关」：读不到、存储坏了、抛异常，一律按关闭处理——
 * 宁可 AI 功能不能用，也不能悄悄花钱。
 */
import { BYO_PRESETS, type ChannelPreset } from './aiChannels'

/**
 * 「怎么把 AI 接上」这三步是**这一文件的唯一一份**，两处共用：
 * `decideAccess` 的拒绝文案，和总览页那条未配置提示。
 *
 * 为什么写死成常量：这条产品口径是「AI 只走使用者自备的 Key，不默认花创建者的钱」，
 * 而拒绝文案原先只在**用户点了 AI 按钮之后**以抛错形式出现 —— 一个刚注册的人不会先去
 * 设置页，他看到的是"这功能坏了"。指引要有入口名，所以这里写的是界面上真实存在的标题
 * （`Settings.tsx` 的 `AI 通道` 卡与「自检一下」按钮，`App.tsx` 里那一栏叫「目标条件」），
 * 不是我们内部叫法。改界面上的名字时，记得同时改这里。
 */
export const BYO_SETUP_STEPS: readonly string[] = [
  '打开「目标条件」页里的「AI 通道」，选一家能被浏览器直发的厂商（DeepSeek / Kimi / OpenRouter / 阿里云百炼）；',
  '把那一家控制台里建的 Key 粘进去，再填上要用的模型名；',
  '点「自检一下」，绿了再回来 —— 之后 AI 只走你选的这一条，钱记在你自己的账户上。',
]

/** 创建者试用开关（默认关） */
export const OWNER_TRIAL_KEY = 'wb_owner_trial'
/** 用户自备 Key，只存在本机 localStorage；本项目**不在服务端保管任何人的 Key** */
export const BYO_KEY_KEY = 'wb_byo_key'
/** 选了哪家厂商（与 Key 配套，同样是设备级） */
export const BYO_PRESET_KEY = 'wb_byo_preset'
/** 模型名按厂商分别记：换了厂商还留着上一家的模型名，只会得到一个莫名其妙的 404 */
export const BYO_MODEL_PREFIX = 'wb_byo_model_'

export type AiAccess = 'byo' | 'owner-trial' | 'none'
export type PaidBy = 'user' | 'creator' | 'nobody'

export interface AccessInput {
  /** 选的那一档要的东西齐了（要 Key 的有 Key，本机档不需要） */
  byoConfigured: boolean
  /** 选的那一档真的发得出去：实测能被浏览器直发，或本机服务探到了 */
  byoSendable: boolean
  ownerTrial: boolean
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
  if (input.byoConfigured) {
    if (input.byoSendable) return { allowed: true, access: 'byo', paidBy: 'user', reason: '' }
    return {
      allowed: false,
      access: 'none',
      // 付款方写成 nobody 而不是 creator：这句话本身就是承诺——绝不悄悄记到创建者头上
      paidBy: 'nobody',
      reason:
        '你选的自备 Key 通道现在发不出去：那一家厂商实测不能被浏览器直发，或者本机模型服务还没启动。' +
        '这里不会改用本应用的额度——那等于让应用创建者替你付钱。' +
        '换一家能直发的厂商（DeepSeek / Kimi / OpenRouter / 阿里云百炼），或把本机 Ollama 跑起来。',
    }
  }
  if (input.ownerTrial) return { allowed: true, access: 'owner-trial', paidBy: 'creator', reason: '' }
  return {
    allowed: false,
    access: 'none',
    paidBy: 'nobody',
    reason:
      // 步骤与首屏那条指引是同一份（见 BYO_SETUP_STEPS）：两句话版本分家，
      // 用户就会在"点按钮看到的"和"页面告诉他的"之间得到两套说法。
      'AI 现在还没接上：本应用的额度记在创建者账号上，不默认替使用者承担。接上它只要三步：' +
      BYO_SETUP_STEPS.map((s, i) => ` ${i + 1}. ${s}`).join('') +
      ' 不想用 Key 也可以选「本机 Ollama」档，花的是自己电脑的算力。',
  }
}

/**
 * 本机模型服务（Ollama）的探活结果。
 *
 * 为什么默认是「没在跑」：没探到就发，用户看到的是一句「网络错误」，
 * 然后去反复重填 Key——那是把工程问题伪装成用户的错。探一次就知道了。
 * 远端厂商不吃这个标志：它们的可达性由 CORS 实测决定（见 `aiChannels.ts`）。
 */
let localServiceReady = false

export function setLocalServiceReady(v: boolean): void {
  localServiceReady = v === true
}

export function isLocalServiceReady(): boolean {
  return localServiceReady
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

/** 只看「有没有填」，不返回 Key 本身：界面判断该不该显示「已配置」用这句就够了 */
export function hasUserKey(): boolean {
  return String(read(BYO_KEY_KEY) ?? '').trim().length > 0
}

/**
 * 读 Key 本体。**唯一的调用方是自备通道的发送器**（发请求那一刻）。
 * 界面上任何地方都不许用它显示原文——回填一次就等于把 Key 交给了截图、DOM 与日志。
 */
export function readUserKey(): string {
  return String(read(BYO_KEY_KEY) ?? '').trim()
}

export function setUserKey(value: string | null): void {
  const v = String(value ?? '').trim()
  write(BYO_KEY_KEY, v ? v : null)
}

/** 当前选的是哪一档。脏值（旧版本残留、手改）一律回落到默认厂商，而不是随机挑一家。 */
export function currentPreset(): ChannelPreset {
  const id = String(read(BYO_PRESET_KEY) ?? '').trim()
  return BYO_PRESETS.find((p) => p.id === id) ?? BYO_PRESETS[0]
}

/** 只认表里存在的档位：存进一个不认识的 id，下次读出来还是默认档 */
export function setByoPresetId(id: string): void {
  const hit = BYO_PRESETS.find((p) => p.id === id)
  write(BYO_PRESET_KEY, hit ? hit.id : null)
}

/** 这一档要用的模型名；没选过就用厂商表里的第一个 */
export function getByoModel(preset: ChannelPreset = currentPreset()): string {
  const stored = String(read(BYO_MODEL_PREFIX + preset.id) ?? '').trim()
  return stored || preset.models[0] || ''
}

export function setByoModel(presetId: string, model: string): void {
  const v = String(model ?? '').trim()
  write(BYO_MODEL_PREFIX + String(presetId ?? '').trim(), v || null)
}

/** 「自备通道配好了没」：要 Key 的厂商看有没有 Key，本机档没有 Key 这回事 */
export function isByoConfigured(preset: ChannelPreset = currentPreset()): boolean {
  return preset.requiresKey ? hasUserKey() : true
}

/** 「这一档现在发得出吗」：CORS 实测 + 本机探活，两个都是事实而不是愿望 */
export function isByoSendable(preset: ChannelPreset = currentPreset()): boolean {
  if (!preset.browserDirect) return false
  // 判的是**属性**不是对象身份：调用方递一份档位副本过来（组视图模型时很常见），
  // 按身份比就会漏判成本机档以外的那一类，探活那道闸就白设了
  if (preset.httpLocal === true) return isLocalServiceReady()
  return true
}

/** 把几处状态合成一个判定，供 streamChat 与界面共用 */
export function currentAccess(): AccessDecision {
  const preset = currentPreset()
  return decideAccess({
    byoConfigured: isByoConfigured(preset),
    byoSendable: isByoSendable(preset),
    ownerTrial: getOwnerTrialEnabled(),
  })
}
