import type { QAItem } from './interviewQA'

/**
 * 模拟面试的会话逻辑（纯函数，不碰浏览器也不碰模型）。
 *
 * 为什么单独立一个文件：模型输出「题目列表」的形状不稳定——编号、项目符号、
 * 引号、`面试官：` 前缀、夹一句「以下是题目」的开场白都会出现。把这些消化
 * 掉的部分放在纯函数里，才能用真实样本断言，而不是在页面里靠肉眼扫。
 *
 * 一场模拟只花两次模型调用：一次出题（整批）、一次复盘（整批）。
 * 逐题追问要多一次调用/题，会把「每任务 8 次」的额度上限吃掉，所以默认不做。
 */

export const MOCK_CATEGORY = '模拟面试'

/** 一题最长的可展示长度；模型偶尔会把两道题连成一行，超长就截断而不是丢掉 */
const MAX_QUESTION = 160

export interface MockSession {
  company: string
  title: string
  round: string
  /** 计划出几题 */
  count: number
  questions: string[]
  /** 与 questions 同下标；没答的留空串 */
  answers: string[]
  /** 当前做到第几题（0-based） */
  cursor: number
}

export function createSession(input: { company: string; title: string; round?: string; count?: number }): MockSession {
  const count = Math.min(12, Math.max(1, Number(input.count) || 5))
  return {
    company: String(input.company ?? '').trim(),
    title: String(input.title ?? '').trim(),
    round: String(input.round ?? '模拟面').trim() || '模拟面',
    count,
    questions: [],
    answers: [],
    cursor: 0,
  }
}

const BULLET = /^\s*(?:[-*+·•]|\d+\s*[.)、]|第\s*\d+\s*[题问])[:：.、]?\s*/
const ROLE_PREFIX = /^\s*(?:面试官|提问|问题|Q\s*\d*|问)[:：]\s*/
const COMMENTARY = /^(好的|以下|下面是|这些|说明|注意|提示|总结|以上|希望|如需|如需进一步)/

/** 看起来像一道题：自带问号，或者是中文里常见的开放式提问起手 */
function looksLikeQuestion(line: string): boolean {
  if (/[?？]\s*$/.test(line)) return true
  // 口语化的追问常常不带问号：「……的区别在哪」「你有没有做过」
  if (/(为什么|怎么|怎样|哪|是否|有没有|什么|吗[。.]?)$/.test(line)) return true
  return /^(请|说说|聊聊|介绍|谈谈|解释|对比|举|你(?:为什|怎么|如|有|认为|做过|能不能|是否)|有没有|什么)/.test(line)
}

function normalize(text: string): string {
  return text.replace(/\s+/g, '').replace(/[?？。.!！]/g, '').toLowerCase()
}

/**
 * 模型输出的整段文本 → 题目数组。
 * 没有列表符号的裸行只在「像一道题」时才收，否则并进上一题——
 * 因为换行续写的题干很常见，而开场白不该变成第一题。
 */
export function parseQuestions(raw: string, max = 12): string[] {
  // 非法 max（0 / NaN）回落默认 12，而不是静默变成「只出 1 题」
  const limit = Math.min(12, Math.max(1, Number(max) || 12))
  const out: string[] = []
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const text = line.trim()
    if (!text) continue
    // Markdown 标题和加粗说明不是题
    if (/^#{1,6}\s/.test(text)) continue
    if (/^[*>]{1,2}\s*$/.test(text)) continue

    const marked = BULLET.test(text) || ROLE_PREFIX.test(text)
    let body = text.replace(BULLET, '').replace(ROLE_PREFIX, '').replace(/^["“「『]|["”」』]$/g, '').trim()
    // 行内加粗很常见（「**项目深挖**：…」），留着会把星号当成题目的一部分
    body = body.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^\s*[:：]\s*/, '').trim()
    if (!body || body.length < 4) continue

    if (!marked) {
      if (COMMENTARY.test(body) && !/[?？]$/.test(body)) continue
      if (!looksLikeQuestion(body)) {
        // 不像题的裸行：有上一题就当作续写，没有就丢掉（开场白）
        if (out.length) out[out.length - 1] = `${out[out.length - 1]} ${body}`
        continue
      }
    }
    if (COMMENTARY.test(body) && !/[?？]$/.test(body)) continue
    if (body.length > MAX_QUESTION) body = `${body.slice(0, MAX_QUESTION)}…`

    const key = normalize(body)
    if (out.some((q) => normalize(q) === key)) continue
    out.push(body)
    if (out.length >= limit) break
  }
  return out
}

/** 把会话里已答的部分收成问答对；复盘只喂这些，避免「（未记录）」淹掉真实回答 */
export function sessionToQA(session: MockSession): QAItem[] {
  return session.questions.map((q, i) => ({ q, a: String(session.answers[i] ?? '').trim() })).filter((it) => it.q || it.a)
}

export function sessionProgress(session: MockSession): { total: number; answered: number; done: number } {
  // 空题面不算一道题：手动清掉某题文字时进度不能虚高
  const total = session.questions.filter((q) => String(q ?? '').trim()).length
  const answered = session.answers.filter((a) => a.trim()).length
  return { total, answered, done: Math.min(session.cursor, total) }
}

/** 还能不能再答一句：转写会一直吐字，界面需要一个明确的上界而不是无限追加 */
export function appendAnswer(session: MockSession, index: number, line: string): string[] {
  const next = [...session.answers]
  const text = String(line ?? '').trim()
  if (!text) return next
  const i = Math.max(0, Math.min(index, Math.max(0, session.questions.length - 1)))
  while (next.length <= i) next.push('')
  next[i] = `${next[i]}${next[i] ? ' ' : ''}${text}`
  return next
}

/** 复盘要用的公司名：没填具体公司时也要说得清这是自练，不要留空串导致标题变成「· 模拟面」 */
export function reviewSubject(session: MockSession): { company: string; title: string; round: string } {
  return {
    company: session.company || '自练（未指定公司）',
    title: session.title || '未指定岗位',
    round: session.round,
  }
}
