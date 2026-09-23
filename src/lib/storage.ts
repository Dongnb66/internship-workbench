import { cloud } from '../cloud'

/**
 * 简历附件的存储读写（runtime bucket，`users/<uid>/resumes/` 前缀）。
 *
 * 权限模型：path 必须挂在当前用户自己的 userPath 下，存储侧 RLS 才会放行；
 * 登录态由 SDK 的共享 fetch 自动携带，这里不手动传 token。
 *
 * file_url 存的是**短时签名链接**（7 天），只用于「打开文件」按钮直接预览；
 * 到期后从列表里点开 会 403，重新点「编辑 → 保存」或重新上传即可续签。
 * file_path 是永久路径，是删除与续签的依据。
 */

const RESUME_PREFIX = 'resumes'
const SIGNED_URL_TTL = 7 * 24 * 3600

/** 存储路径里的文件名只保留安全字符，其余替换为下划线 */
function safeName(name: string): string {
  return name.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(-120) || 'resume.pdf'
}

export async function currentUserId(): Promise<string> {
  const res = await cloud.auth.getUser()
  if (res.error) throw new Error('获取登录身份失败，请重新登录后再上传')
  const id = (res.data as { id?: string } | null)?.id
  if (!id) throw new Error('登录身份缺少用户 ID，无法上传附件')
  return id
}

export interface UploadedResumeFile {
  /** 存储路径（永久，入库 resumes.file_path） */
  path: string
  /** 7 天有效的签名链接（入库 resumes.file_url，供直接打开） */
  url: string
  /** 归一化后的文件名 */
  fileName: string
}

export async function uploadResumeFile(file: File): Promise<UploadedResumeFile> {
  const userId = await currentUserId()
  const fileName = safeName(file.name)
  const path = cloud.storage.userPath(userId, `${RESUME_PREFIX}/${Date.now()}-${fileName}`)
  const up = await cloud.storage.upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (up.error) throw new Error(up.error.message || '附件上传失败')
  const signed = await cloud.storage.createSignedUrl(path, SIGNED_URL_TTL)
  if (signed.error) {
    // 上传成功但签链失败：附件已在库里，不回滚——用户可稍后重试签链
    console.warn('签名链接生成失败（附件已上传）：', signed.error.message)
    return { path, url: '', fileName }
  }
  return { path, url: signed.data.signedUrl, fileName }
}

/** 按永久路径重新签一个短链（「打开文件」403 时的续签入口） */
export async function signResumeUrl(path: string): Promise<string> {
  const signed = await cloud.storage.createSignedUrl(path, SIGNED_URL_TTL)
  if (signed.error) throw new Error(signed.error.message || '生成访问链接失败')
  return signed.data.signedUrl
}

/** 删除简历行时顺手清理附件；失败只警告不入错误流程（行删除是主操作） */
export async function removeResumeFile(path: string): Promise<void> {
  try {
    const res = await cloud.storage.remove([path])
    if (res.error) console.warn('附件清理失败（不影响简历删除）：', res.error.message)
  } catch (error) {
    console.warn('附件清理失败（不影响简历删除）：', error)
  }
}
