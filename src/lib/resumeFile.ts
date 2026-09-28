/**
 * 简历附件：文本提取。
 *
 * 支持范围与理由：
 * - PDF：求职投递件绝大多数是 PDF，是第一优先格式；用 pdfjs-dist
 *   在浏览器本地提取，简历内容不出设备（上传的只有用户自己主动传的附件本身）。
 * - docx：部分渠道网申要求 Word 版；mammoth 提取纯文本足够分析用。
 * - doc（老二进制格式）：两个库都处理不了，直接明确报错让用户转存 docx，
 *   不做「静默提取出乱码」这种更糟的结果。
 * - txt / md：直接读。
 *
 * pdfjs / mammoth 都用动态 import：主包不背这两个 ~1MB 级依赖，
 * 只有真正上传附件的这一次交互才会加载它们。
 */

export const MAX_RESUME_BYTES = 10 * 1024 * 1024

export type ResumeKind = 'pdf' | 'docx' | 'txt' | 'md' | 'doc' | 'unknown'

export function resumeKindOf(fileName: string): ResumeKind {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'doc') return 'doc'
  if (ext === 'txt') return 'txt'
  if (ext === 'md' || ext === 'markdown') return 'md'
  return 'unknown'
}

/** 从 PDF 提取文本：逐页 readText，压掉多余空行但保留段落结构 */
async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const data = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data })
  const doc = await loadingTask.promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    // 同一行的 text item 直接拼接，行尾换行——pdfjs 的 item 没有 y 坐标分组时
    // 这样最稳；简历是单栏排版，实际效果足够分析用
    let line = ''
    const lines: string[] = []
    let lastY: number | null = null
    for (const item of content.items as Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>) {
      if (typeof item.str !== 'string') continue
      const y = item.transform?.[5] ?? null
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
        lines.push(line)
        line = ''
      }
      line += item.str
      if (item.hasEOL) {
        lines.push(line)
        line = ''
      }
      if (y !== null) lastY = y
    }
    if (line.trim()) lines.push(line)
    pages.push(lines.join('\n'))
  }
  await loadingTask.destroy()
  return pages.join('\n\n')
}

/** 从 docx 提取文本：mammoth 的 extractRawText 不解析样式只要文字 */
async function extractDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value
}

/** 提取入口：返回纯文本；不支持/超限/提取失败都抛带中文原因的 Error */
export async function extractResumeText(file: File): Promise<string> {
  if (file.size > MAX_RESUME_BYTES) {
    throw new Error(`文件超过 ${Math.round(MAX_RESUME_BYTES / 1024 / 1024)}MB 上限（当前 ${Math.round(file.size / 1024 / 1024)}MB）`)
  }
  const kind = resumeKindOf(file.name)
  if (kind === 'doc') {
    throw new Error('不支持老版 .doc 格式：请用 Word/WPS 另存为 .docx 后重新上传')
  }
  if (kind === 'unknown') {
    throw new Error('仅支持 PDF / docx / txt / md 简历文件')
  }
  let text: string
  if (kind === 'pdf') text = await extractPdf(file)
  else if (kind === 'docx') text = await extractDocx(file)
  else text = await file.text()
  const cleaned = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim()
  if (!cleaned) {
    throw new Error('没有提取到任何文字：这个文件可能是纯图片（扫描件/照片导出的 PDF），请换文字版简历')
  }
  return cleaned
}

/** 分析用的文本量上限：超长简历截断，提示放前面（12K 字符 ≈ 8-10 页，远超简历长度） */
export const ANALYZE_TEXT_LIMIT = 12000
