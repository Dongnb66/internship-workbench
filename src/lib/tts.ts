/**
 * 浏览器语音朗读（TTS），只用于「把题念出来」这一件事。
 *
 * 边界，写清楚免得被误解：
 * - 这里不做声音克隆，用的是系统自带音色。克隆声音是另一件事，且必须只落在
 *   用户自己的产物上（项目口播这类），不用于冒充真人说话。
 * - 与 speech.ts 相反，TTS 在 Electron 里通常是可用的（Chromium 自带 speechSynthesis，
 *   Windows 走系统 SAPI 音色），所以「桌面端能读题、但不能转写我的回答」这种
 *   **不对称**是真实状态，界面上要分别判断，不能说成双端一致。
 * - 没有任何第三方计费：念题不花额度，所以出题/复盘的模型调用是本页唯一的成本项。
 */

interface SpeechUtterance {
  text: string
  lang: string
  rate: number
  pitch: number
  voice?: unknown
  onend: (() => void) | null
  onerror: ((event: unknown) => void) | null
}

interface SpeechApi {
  speak: (u: SpeechUtterance) => void
  cancel: () => void
  speaking: boolean
  pending: boolean
  getVoices: () => Array<{ voiceURI?: string; lang?: string }>
  SpeechSynthesisUtterance: new () => SpeechUtterance
}

function api(): SpeechApi | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  const synth = w.speechSynthesis as SpeechApi | undefined
  const Ctor = w.SpeechSynthesisUtterance as (new () => SpeechUtterance) | undefined
  if (!synth || typeof synth.speak !== 'function' || !Ctor) return null
  return { ...synth, SpeechSynthesisUtterance: Ctor }
}

export function ttsSupported(): boolean {
  return api() !== null
}

/** 朗读语速：模型念出来的题目偏快会听不清，卡死在 0.5~2 之间，不给 NaN/0 把引擎打哑 */
export function clampRate(value: unknown, fallback = 1): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(2, Math.max(0.5, n))
}

/**
 * 把 Markdown 剥成能听的散文。
 * 模型输出的列表符号和 `**` 会被逐字读成「星号星号」，题号也会被读出来，
 * 所以这里只留正文；换行压成句号停顿。
 */
export function stripForSpeech(text: string): string {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, '（代码略）')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+[.)、]\s*/gm, '')
    .replace(/\s*\n\s*/g, '。')
    .replace(/。{2,}/g, '。')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** SpeechSynthesis 的错误名 → 人话。这些真的会发生（尤其是系统没装中文音色）。 */
export function ttsErrorText(name: string): string {
  switch (name) {
    case 'not-allowed':
      return '浏览器拒绝了语音合成权限，需要在站点设置里允许'
    case 'no-utterance':
      return '要念的内容是空的'
    case 'synthesis-unavailable':
    case 'voice-unavailable':
    case 'language-unavailable':
      return '这台机器没有可用的中文语音音色，题目直接用看的就行（不影响记录回答）'
    case 'synthesis-failed':
      return '语音合成失败，可以重试或直接用看的'
    case 'queue-full':
      return '朗读队列满了，等上一题念完再点'
    case 'canceled':
      return '已停止朗读'
    default:
      return `朗读中断：${name || '未知原因'}`
  }
}

/**
 * 选一个中文音色。
 * getVoices() 在部分浏览器里第一次调用返回空数组（异步填充），所以这里不能因为
 * 一次拿到空列表就断言「没有音色」——那样会永远读不出声音。
 */
function pickVoice(list: Array<{ voiceURI?: string; lang?: string }>) {
  return list.find((v) => /^zh([-_]|$)/i.test(String(v.lang ?? ''))) ?? null
}

export interface SpeakOptions {
  lang?: string
  rate?: number
  onEnd?: () => void
  onError?: (message: string) => void
}

/** 念一段话；不可用或内容为空返回 false，调用方据此显示「用看的」而不是静默失败 */
export function speak(raw: string, opts: SpeakOptions = {}): boolean {
  const synth = api()
  const text = stripForSpeech(raw)
  if (!synth || !text) return false
  synth.cancel()
  const u = new synth.SpeechSynthesisUtterance()
  u.text = text
  u.lang = opts.lang ?? 'zh-CN'
  u.rate = clampRate(opts.rate)
  u.pitch = 1
  const voice = pickVoice(synth.getVoices() ?? [])
  if (voice) u.voice = voice
  u.onend = () => opts.onEnd?.()
  u.onerror = (event: unknown) => opts.onError?.(ttsErrorText(String((event as { error?: string })?.error ?? '')))
  try {
    synth.speak(u)
  } catch (error) {
    opts.onError?.(`朗读启动失败：${String(error)}`)
    return false
  }
  return true
}

export function stopSpeaking(): void {
  try {
    api()?.cancel()
  } catch {
    // 已经停了
  }
}

/** 给界面用的状态：正在念 / 排队中，用来把按钮文案写成事实而不是猜 */
export function speakingNow(): boolean {
  const synth = api()
  return !!synth && (synth.speaking || synth.pending)
}
