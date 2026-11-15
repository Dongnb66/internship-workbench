import type { QAItem } from './interviewQA'

/**
 * 会议转写 → 问答对。
 *
 * 来源五花八门：飞书妙记导出、腾讯会议字幕复制、Zoom 的 .vtt、BOSS 上手动复制的聊天。
 * 这里不认某一家格式，只做两件稳定的事：
 * 1. 剥掉时间轴/序号/样式标签；
 * 2. 认出「谁在说话」，再把「对方问 → 我答」配成问答对。
 *
 * 说话人名字只出现一次时不当说话人——否则「问题：你为什么选我们」会被误切。
 */

export interface DialogueLine {
  speaker: string
  text: string
}

/** 时间轴行：VTT / SRT 都有 */
const TIME_CUE = /^\d{1,2}:\d{2}(:\d{2})?[.,]?\d{0,3}\s*-->/ 

/** 说话人前缀：短、无标点，冒号后是正文 */
const SPEAKER_PREFIX = /^([^\s：:，。！？、]{1,16})[：:]\s*(.+)$/

/** 一眼能认定是面试双方的标签，即使只出现一次 */
const KNOWN_SPEAKER = /^(hr|HR|Hr|面试官|招聘|我|候选人|说话人\d*|interviewer|Interviewer|candidate|Candidate)$/

function cleanText(text: string): string {
  return String(text ?? '')
    .replace(/<v\s+[^>]+>/g, '')
    .replace(/<\/?[a-z][^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeSpeaker(name: string): string {
  return String(name ?? '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/\s+/g, '')
    .trim()
}

interface Prefixed {
  prefix: string | null
  body: string
}

/** 第一步：逐行剥时间轴与序号，拆出可能的「说话人前缀」 */
function preParse(raw: string): Prefixed[] {
  const lines = String(raw ?? '').replace(/\r/g, '').split('\n')
  const rows: Prefixed[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) continue
    if (/^WEBVTT/i.test(line) || /^NOTE/i.test(line) || /^Kind:|^Language:/i.test(line)) continue
    if (TIME_CUE.test(line)) continue
    // SRT 的纯数字序号：只有下一行是时间轴时才算序号
    if (/^\d{1,6}$/.test(line) && TIME_CUE.test(String(lines[i + 1] ?? '').trim())) continue

    const vTag = line.match(/^<v\s+([^>]+)>/)
    const speakerish = vTag ? cleanText(vTag[1]) : null
    const body = cleanText(vTag ? line.replace(/^<v\s+[^>]+>/, '') : line)
    if (!body) continue

    if (speakerish) {
      rows.push({ prefix: speakerish, body })
      continue
    }
    const m = body.match(SPEAKER_PREFIX)
    if (m) rows.push({ prefix: m[1], body: m[2] })
    else rows.push({ prefix: null, body })
  }
  return rows
}

/** 第二步：统计前缀出现次数，够资格的才升级成说话人 */
function speakerDict(rows: Prefixed[]): Map<string, string> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (!row.prefix) continue
    const key = normalizeSpeaker(row.prefix)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const dict = new Map<string, string>()
  for (const [key, count] of counts) {
    if (count >= 2 || KNOWN_SPEAKER.test(key)) dict.set(key, key)
  }
  return dict
}

/** 原始转写 → 对话行；没有可识别说话人时全部记为「未标注」，仍可作为单侧文本使用 */
export function parseTranscript(raw: string): DialogueLine[] {
  const rows = preParse(raw)
  const dict = speakerDict(rows)
  const out: DialogueLine[] = []
  for (const row of rows) {
    const key = row.prefix ? normalizeSpeaker(row.prefix) : ''
    const speaker = key && dict.has(key) ? String(dict.get(key)) : ''
    // 前缀没被认定为说话人时要把冒号还原，否则「问题：xxx」会被吃掉前半句
    const text = speaker ? row.body : row.prefix ? `${row.prefix}：${row.body}` : row.body
    if (speaker) {
      out.push({ speaker, text })
    } else if (out.length && out[out.length - 1].speaker) {
      // 无前缀的行是上一段话的换行续写
      out[out.length - 1].text = `${out[out.length - 1].text} ${text}`.trim()
    } else {
      out.push({ speaker: '', text })
    }
  }
  return out.filter((l) => l.text)
}

/** 转写里出现过的说话人，按首次出现顺序，用于「哪个是我」的下拉 */
export function speakerNames(lines: DialogueLine[]): string[] {
  const seen: string[] = []
  for (const line of lines) {
    if (line.speaker && !seen.includes(line.speaker)) seen.push(line.speaker)
  }
  return seen
}

/**
 * 猜「哪个说话人是我」：两位说话人时取第二位（面试通常面试官先开口）；
 * 只有一位时返回该位（单侧录音的场景，匹配后会被当作我的回答）。
 */
export function guessSelfSpeaker(lines: DialogueLine[]): string | null {
  const names = speakerNames(lines)
  if (names.length >= 2) return names[1]
  return names[0] ?? null
}

function appendText(prev: string, next: string): string {
  if (!prev) return next
  return `${prev}\n${next}`
}

/**
 * 对话行 → 问答对。
 * 规则：对方连着说几段但还没轮到我 → 合并成同一题的题干（追问也是同一题的一部分）；
 * 我一说就是这题的答案；我连续说几段 → 合并进同一个答案。
 */
export function dialogueToQA(lines: DialogueLine[], selfSpeaker: string | null): QAItem[] {
  const me = selfSpeaker ? normalizeSpeaker(selfSpeaker) : ''
  const isMe = (speaker: string) => {
    const name = normalizeSpeaker(speaker)
    return !!me && (name === me || name.includes(me) || me.includes(name))
  }
  const items: QAItem[] = []
  for (const line of lines) {
    if (!line.text) continue
    if (isMe(line.speaker)) {
      if (!items.length) continue // 开场前我自己的寒暄，没有对应问题，丢掉
      const last = items[items.length - 1]
      last.a = appendText(last.a, line.text)
      continue
    }
    const last = items[items.length - 1]
    if (last && !last.a) last.q = appendText(last.q, line.text)
    else items.push({ q: line.text, a: '' })
  }
  return items.filter((it) => it.q || it.a)
}

/** 一站式：粘贴文本 → 问答对（UI 的默认路径） */
export function transcriptToQA(raw: string, selfSpeaker?: string | null): { lines: DialogueLine[]; qa: QAItem[]; self: string | null; speakers: string[] } {
  const lines = parseTranscript(raw)
  const speakers = speakerNames(lines)
  const self = selfSpeaker ?? guessSelfSpeaker(lines)
  return { lines, qa: dialogueToQA(lines, self), self, speakers }
}
