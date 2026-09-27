/**
 * 小程序端的计费门：**默认不花创建者的钱**。
 *
 * 与网页端 `src/lib/billing.ts` 是同一条规则，但**这一端少一条通路**，这件事必须写死在代码里：
 * 网页能浏览器直发（实测四家厂商的响应带跨域头），小程序做不到——
 * `wx.request` 的域名要在小程序后台逐个白名单，而厂商域名不归本应用所有，也过不了审核。
 * 所以这一端**默认拒绝**，而且界面上不给任何开关：小程序里任何使用者都能翻这个 flag，
 * 那等于把创建者的钱包放在台面上。`ownerTrial` 那条代码路径留着，是给创建者自己在
 * 开发者工具里给自己开的后门（存储是设备级的）；给普通使用者的那句话指向网页端。
 *
 * 三条判定的写法与网页端刻意保持一致，并由 `miniprogram/__tests__/billing.test.mjs`
 * 里那张真值表跨端比对：同一个仓库里「谁能用 AI」写两遍，迟早一处严一处松。
 *
 * 默认值必须是「关」：读不到、存储坏了、抛异常，一律按关闭处理。
 */

/** 创建者试用开关（与网页端同名；两端的存储本来就是分开的） */
const TRIAL_KEY = 'wb_owner_trial'

/**
 * 这一端有没有自备 Key 的通路。**写死 false**，不是配置项：
 * 小程序没有浏览器直发那条路，用户在网页端填的 Key 到这里用不上。
 */
const BYO_AVAILABLE_HERE = false

/**
 * 纯函数判定。输入形状与网页端不同是刻意的：这里没有 byoConfigured 这一说，
 * 硬套网页那三个字段就会假装"这一端也能自备"。
 *
 * @param {{ownerTrial: boolean, byoAvailableHere?: boolean, hasUserKeyAnywhere?: boolean}} input
 */
function decideAccess(input) {
  const ownerTrial = input.ownerTrial === true
  const byoAvailableHere = input.byoAvailableHere === undefined ? BYO_AVAILABLE_HERE : input.byoAvailableHere === true
  const hasKey = input.hasUserKeyAnywhere === true
  if (byoAvailableHere && hasKey) {
    return { allowed: true, access: 'byo', paidBy: 'user', reason: '' }
  }
  if (ownerTrial) {
    return { allowed: true, access: 'owner-trial', paidBy: 'creator', reason: '' }
  }
  const aboutKey = hasKey ? '你在网页端填的 Key 在这一端用不上。' : ''
  return {
    allowed: false,
    access: 'none',
    // 付款方写成 nobody 而不是 creator：这句话本身就是承诺——绝不悄悄记到创建者头上
    paidBy: 'nobody',
    reason:
      aboutKey +
      '这个小程序没有自备 Key 那条路：厂商域名要在小程序后台逐个白名单，而那些域名不归本应用所有。' +
      '要用 AI，请去网页端——那里可以填你自己的 DeepSeek / Kimi / OpenRouter / 阿里云百炼 Key，' +
      '或者选本机 Ollama，两条路都不花应用创建者的钱。',
  }
}

/**
 * 存储适配器。
 *
 * 没有 `wx`（跑在 node 里做断言、或者被别的运行时引入）时退回一份内存存储，
 * 而不是抛错——抛错会让调用方倾向"包一层 try 然后当放行"，那正是最坏的写法。
 */
function createMiniStorage(wxRuntime) {
  const mem = new Map()
  const hasWx = !!(wxRuntime && wxRuntime.getStorageSync && wxRuntime.setStorageSync)
  return {
    getItem(key) {
      if (!hasWx) return mem.has(key) ? mem.get(key) : null
      try {
        const v = wxRuntime.getStorageSync(key)
        return v === '' || v === undefined || v === null ? null : String(v)
      } catch {
        return null
      }
    },
    setItem(key, value) {
      if (!hasWx) {
        mem.set(key, String(value))
        return
      }
      try {
        wxRuntime.setStorageSync(key, String(value))
      } catch {
        /* 存不下就当没开过：默认关，符合「宁可不能用」 */
      }
    },
    removeItem(key) {
      if (!hasWx) {
        mem.delete(key)
        return
      }
      try {
        if (wxRuntime.removeStorageSync) wxRuntime.removeStorageSync(key)
      } catch {
        /* 删不掉也只是保持原状 */
      }
    },
  }
}

/** 只有显式写入的 '1' 算开；其他一切值（含 'true'、'0'、空串）都算关 */
function isTrialOn(storage) {
  try {
    return storage.getItem(TRIAL_KEY) === '1'
  } catch {
    return false
  }
}

/** 供页面与 `streamChat` 共用：把存储里的状态合成一个判定 */
function currentAccess(storage) {
  const s = storage || createMiniStorage(typeof wx === 'undefined' ? undefined : wx)
  return decideAccess({ ownerTrial: isTrialOn(s), byoAvailableHere: BYO_AVAILABLE_HERE, hasUserKeyAnywhere: false })
}

module.exports = {
  TRIAL_KEY: TRIAL_KEY,
  BYO_AVAILABLE_HERE: BYO_AVAILABLE_HERE,
  decideAccess: decideAccess,
  createMiniStorage: createMiniStorage,
  isTrialOn: isTrialOn,
  currentAccess: currentAccess,
}
