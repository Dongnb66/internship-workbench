/**
 * 「谁是应用创建者」这件事的唯一判定点。
 *
 * 为什么需要它：计费门默认不花创建者的钱，而「用本应用的额度试用」这道开关原先
 * 无条件摆在设置页里——**任何登录进来的使用者都能勾上它**，那扇门就等于没关。
 * 花钱的授权不能靠"反正没人会去勾"，得有一个身份判定挡在前面。
 *
 * 为什么默认是空：跟邀请码同一套做法。**没配置就是关闭**，而不是先摆一个公开的
 * 默认值再指望人记得改。留空时谁都拿不到这道开关，包括创建者本人——
 * 界面上会把这句话直接说出来，免得他被当成"功能坏了"。
 *
 * 局限也写在这儿：身份读的是会话里的邮箱（SDK 的 `email` 是可缺省字段），
 * 而这是**前端**判定。真正要管住钱，得靠服务端身份（额度、限流都在那儿）。
 */

/** 创建者自己的登录邮箱。空串 = 未配置 = 谁都不算创建者。 */
export const OWNER_EMAIL = ''

/** 邮箱归一只做两件事：去空格、小写。不做任何"看起来像"的判断。 */
export function normalizeEmail(email: string | null | undefined): string {
  return String(email ?? '').trim().toLowerCase()
}

/**
 * 这个会话是不是创建者本人的账号。
 *
 * 两边任一为空就返回 false：空邮箱绝不能把自己认证成"没配置时的那个配置项"。
 * 比对是全等，`boss@example.com` 不算 `boss@example.com.evil.cn`。
 */
export function isOwnerAccount(email?: string | null, ownerEmail: string = OWNER_EMAIL): boolean {
  const mine = normalizeEmail(email)
  const owner = normalizeEmail(ownerEmail)
  if (!mine || !owner) return false
  return mine === owner
}

/** 界面上要区分"你不是创建者"与"这个站还没设创建者邮箱"，所以把这个事实也交出去 */
export function ownerAccountConfigured(ownerEmail: string = OWNER_EMAIL): boolean {
  return normalizeEmail(ownerEmail) !== ''
}
