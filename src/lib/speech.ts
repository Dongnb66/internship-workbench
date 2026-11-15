/**
 * 浏览器语音转写（仅麦克风，不含系统回环/桌面音频）。
 *
 * 用途：面试进行中记录「我自己说了什么」。对方的提问不在这里抓——
 * 面试结束后把会议软件的转写导进来补齐（见 transcript.ts）。
 *
 * 依赖 Web Speech API：Chrome / Edge 可用，Electron 与部分浏览器不可用，
 * 因此所有调用点必须先过 speechSupported()，不可用时给出明确提示而不是静默失败。
 */

interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return typeof ctor === 'function' ? (ctor as new () => RecognitionLike) : null
}

export function speechSupported(): boolean {
  return recognitionCtor() !== null
}

/** 语音识别错误码 → 人话。这些都会真的发生，不能让用户看到一串英文。 */
export function speechErrorText(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '麦克风权限被拒绝：点地址栏的锁图标，允许本站使用麦克风后重试'
    case 'audio-capture':
      return '没检测到麦克风设备，请检查是否插好或系统里被禁用'
    case 'no-speech':
      return '这段时间没听到声音，可以继续说'
    case 'network':
      return '语音识别服务连不上（需要联网）。面试结束后仍可用导入转写的方式复盘'
    case 'aborted':
      return '已停止'
    default:
      return `语音识别中断：${code || '未知原因'}`
  }
}

export interface DictationOptions {
  /** 默认 zh-CN */
  lang?: string
  /** 一句说完（定稿）时回调一次 */
  onFinal: (text: string) => void
  /** 正在说的半句，用于界面上实时预览 */
  onInterim?: (text: string) => void
  onError?: (message: string) => void
  onEnd?: () => void
}

export interface Dictation {
  stop: () => void
}

/**
 * 开始转写。返回句柄；不可用（浏览器不支持 / 启动失败）返回 null。
 * continuous=true 让它不要在每句话后自动收工——面试里停顿很常见。
 */
export function startDictation(opts: DictationOptions): Dictation | null {
  const Ctor = recognitionCtor()
  if (!Ctor) return null

  const rec = new Ctor()
  rec.lang = opts.lang ?? 'zh-CN'
  rec.continuous = true
  rec.interimResults = true

  rec.onresult = (event: unknown) => {
    const e = event as { resultIndex?: number; results?: ArrayLike<ArrayLike<{ transcript?: string }> & { isFinal?: boolean }> }
    if (!e?.results) return
    let interim = ''
    const start = Number(e.resultIndex ?? 0)
    for (let i = start; i < e.results.length; i += 1) {
      const result = e.results[i]
      const text = String(result?.[0]?.transcript ?? '').trim()
      if (!text) continue
      if (result.isFinal) opts.onFinal(text)
      else interim += text
    }
    if (interim) opts.onInterim?.(interim)
  }
  rec.onerror = (event: unknown) => {
    const code = String((event as { error?: string })?.error ?? '')
    opts.onError?.(speechErrorText(code))
  }
  rec.onend = () => opts.onEnd?.()

  try {
    rec.start()
  } catch (error) {
    opts.onError?.(`启动失败：${String(error)}`)
    return null
  }
  return {
    stop: () => {
      try {
        rec.stop()
      } catch {
        // 已经停了，忽略
      }
    },
  }
}
