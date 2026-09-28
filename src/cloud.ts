import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'
import { humanizeCloudError } from './lib/email'

/**
 * 本应用的云服务公开配置（来自 WorkBuddy 云服务激活时返回的 publicConfig）。
 * endpoint 与本应用的发布域绑定，publishableKey 本身不含权限，仅标识应用，
 * 权限由服务端 Origin 校验 + 数据库 RLS 共同决定。切勿再手工拼接 /.cloud/** 请求。
 */
export const publicConfig = {
  endpoint: 'https://internship-workbench-47024.app.workbuddy.host',
  publishableKey: 'wbpk_cj7U3jJ6RwPG2f4tfo273L_UxTAZ930zrqU2smny12XL5ty3aX2bgBe',
}

export const cloud = createWorkBuddyCloud({
  endpoint: publicConfig.endpoint,
  publishableKey: publicConfig.publishableKey,
})

export function errText(error: unknown): string {
  if (!error) return '未知错误'
  if (typeof error === 'string') return humanizeCloudError(error)
  const e = error as { message?: string; code?: string; kind?: string; error?: { message?: string } }
  // 上游的校验类错误会把正则原文塞在 message 里（见 email.ts 文件头），一律先过一遍转译
  return humanizeCloudError(e.error?.message ?? e.message ?? '请求失败，请重试')
}
