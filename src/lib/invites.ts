/**
 * 邀请码生成器：**造出来的码必须能被注册门认下来**。
 *
 * 为什么要有这个模块（而不是随手敲一串）：`registration.ts` 的名单是源码常量，
 * 创建者要自己造码 → 粘进源码 → 发布 → 把码发给人。这条路上有两个坑是静默的：
 * 1. **念混**：邀请码要人抄、人语音传达，`0/O`、`1/I/L` 抄错了用户只会得到一句"码不对"，
 *    而他看不出自己哪里错——所以字符集先把这些剔掉。
 * 2. **错位**：生成器与判定不共用同一套归一规则，码发出去了人却进不来（不报错，
 *    只让人当面被挡）。所以这里有一条跨模块断言：`renderSourceLine` 的结果喂回
 *    `signupGate` 必须放行（见 `invites.test.ts`）。
 *
 * 顺带一句限度：这些码是**准入口令**，不是密钥——它们最终会出现在源码与产物里，
 * 知道码的人可以注册。它挡的是"拿到链接就顺手开一个号"，不挡"专门来薅的人"。
 */

/** 去掉 `0 O 1 I L` 之后的大写字母 + 数字 */
export const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** 码体长度：4 位太短（撞码与猜码都容易），12 位抄不动 */
const BODY_LENGTH = 8

/** 一次最多生成这么多：这不是防攻击，是防"手滑要了一百万个"把剪贴板与源码埋了 */
const MAX_BATCH = 200

function body(rand: () => number): string {
  let out = ''
  for (let i = 0; i < BODY_LENGTH; i += 1) {
    const r = rand()
    // 取不到 [0,1) 之外的值时按 0 处理：宁可退回第一个字符，也不产出 NaN 形状的码
    const idx = Number.isFinite(r) ? Math.min(ALPHABET.length - 1, Math.max(0, Math.floor(r * ALPHABET.length))) : 0
    out += ALPHABET[idx]
  }
  return out
}

/** 统一形状：`WB-<年>-<8 位>`。年份让旧码在换下一批时自然作废（人眼能看出来）。 */
export function formatCode(raw: string, year: number = new Date().getFullYear()): string {
  return `WB-${Number(year)}-${String(raw ?? '').trim().toUpperCase()}`
}

/**
 * 生成一批不重复的码。
 *
 * 数量校验放在最前面而不是"生成完再截断"：截断会让调用方以为自己拿到了 200 个，
 * 而 `0`、负数、小数、`NaN` 都是能真实发生的传参错误。
 */
export function generateCodes(count = 6, rand: () => number = Math.random, year?: number): string[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH) {
    throw new Error(`邀请码数量必须是 1..${MAX_BATCH} 的整数（收到 ${String(count)}）`)
  }
  const seen = new Set<string>()
  const out: string[] = []
  // 撞码在小字符集下不是理论问题：同一批里撞到就重生，直到凑够数量
  let guard = 0
  while (out.length < count) {
    const code = formatCode(body(rand), year)
    if (!seen.has(code)) {
      seen.add(code)
      out.push(code)
    }
    guard += 1
    if (guard > count * 50) throw new Error('生成邀请码时反复撞码，随机源可能坏了')
  }
  return out
}

/**
 * 印出**可以直接替换**的那一行源码。
 *
 * 为什么是这一行而不是"给你一份 txt"：粘贴点只有一个（`registration.ts` 里那一处声明），
 * 少一次手工拼装就少一次把码敲错的机会；占位符刻意不留在里面——
 * 名单里躺着一个公开可读的"可用码"等于门没关。
 */
export function renderSourceLine(codes: string[]): string {
  const list = (codes ?? []).map((c) => String(c).trim()).filter(Boolean)
  if (!list.length) throw new Error('没有可写的邀请码')
  return `export const INVITE_CODES: string[] = [${list.map((c) => `'${c}'`).join(', ')}]`
}
