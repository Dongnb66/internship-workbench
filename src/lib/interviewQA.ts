import type { Row } from '../types'

/**
 * 面试问答的结构化存储与轮次聚合。
 *
 * 为什么需要：老版本的「被问到的问题」是一个纯文本大框，问题和回答混在一起，
 * 既不能逐题打分，也无法回答「一面问了什么、二面又问到什么」。这里把每条记录
 * 拆成 { 问题, 我的回答 } 并对老数据做无损降级解析。
 */

export interface QAItem {
  /** 面试官问的 */
  q: string
  /** 我当时的回答（可以留空，表示没记） */
  a: string
}

/** 存的 JSON 一定以这个前缀开头，便于和老的纯文本记录区分 */
const JSON_PREFIX = '{"v":1'

export const ROUND_ORDER = ['笔试', '一面', '二面', '三面', 'HR 面', '终面'] as const

/** 轮次在链条里的位置；未知轮次排在已知轮次之后，不参与比较 */
export function roundRank(name: string): number {
  const index = ROUND_ORDER.indexOf(String(name ?? '').trim() as (typeof ROUND_ORDER)[number])
  return index === -1 ? ROUND_ORDER.length : index
}

/** 老数据：按行拆，每行一个问题；带 Q/A 前缀时识别回答 */
export function parseLegacyText(text: string): QAItem[] {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const marked = lines.some((l) => /^([QA]|问|答)[:：]/.test(l))
  if (!marked) return lines.map((l) => ({ q: l.replace(/^\d+[.、]\s*/, ''), a: '' }))

  const items: QAItem[] = []
  for (const line of lines) {
    const qm = line.match(/^([QA]|问|答)[:：]\s*(.*)$/)
    if (!qm) {
      // 没有前缀的行续接到上一条（换行写的长回答很常见）
      if (items.length) items[items.length - 1].a = `${items[items.length - 1].a}${items[items.length - 1].a ? '\n' : ''}${line}`
      continue
    }
    const isAnswer = qm[1] === 'A' || qm[1] === '答'
    if (isAnswer) {
      if (items.length && !items[items.length - 1].a) items[items.length - 1].a = qm[2]
      else items.push({ q: '', a: qm[2] })
    } else {
      items.push({ q: qm[2], a: '' })
    }
  }
  return items.filter((it) => it.q || it.a)
}

/** 数据库里的原始字符串 → 问答列表；空值返回空数组 */
export function parseQA(raw: unknown): QAItem[] {
  const text = String(raw ?? '').trim()
  if (!text) return []
  if (text.startsWith(JSON_PREFIX)) {
    try {
      const data = JSON.parse(text) as { qa?: unknown }
      const list = Array.isArray(data?.qa) ? data.qa : []
      const items = list.map((it) => {
        const obj = it as { q?: unknown; a?: unknown }
        return { q: String(obj?.q ?? '').trim(), a: String(obj?.a ?? '').trim() }
      })
      return items.filter((it) => it.q || it.a)
    } catch {
      // 坏掉的 JSON 不能让整条记录打不开，退回纯文本解析
    }
  }
  return parseLegacyText(text)
}

/**
 * 问答列表 → 数据库字符串。
 * 全部没写回答时存成一行一题的纯文本：这样老页面、老 AI 准备包都还能读，
 * 也不必为「只是记了题目」的场景付 JSON 的存储代价。
 */
export function serializeQA(items: QAItem[]): string {
  const list = items
    .map((it) => ({ q: String(it.q ?? '').trim(), a: String(it.a ?? '').trim() }))
    .filter((it) => it.q || it.a)
  if (!list.length) return ''
  if (list.every((it) => !it.a)) return list.map((it) => it.q).join('\n')
  return JSON.stringify({ v: 1, qa: list })
}

/** 喂给模型的文本：务必保留题号，复盘才能逐题引用 */
export function qaToText(items: QAItem[]): string {
  return items
    .map((it, i) => `第 ${i + 1} 题：${it.q || '（未记录题目）'}\n我的回答：${it.a || '（未记录）'}`)
    .join('\n\n')
}

export function answeredCount(items: QAItem[]): number {
  return items.filter((it) => it.a.trim()).length
}

export interface InterviewRound {
  id: number | string | null
  round: string
  result: string
  when: string
  questionCount: number
  answered: number
}

export interface RoundChain {
  key: string
  company: string
  title: string
  rounds: InterviewRound[]
  /** 最近一轮的时间，用于整体排序 */
  latest: string
}

function chainKey(row: Row): string {
  const appId = row.application_id
  if (appId !== undefined && appId !== null && String(appId) !== '') return `app:${appId}`
  return `manual:${String(row.company ?? '').trim()}|${String(row.title ?? '').trim()}`
}

/**
 * 按投递把同一家公司的一串面试聚成一条「一面 → 二面 → 三面」链条。
 * 没有关联投递的记录按「公司 + 岗位」兜底分组，避免它们散成一堆。
 */
export function roundChains(rows: Row[]): RoundChain[] {
  const map = new Map<string, RoundChain>()
  for (const row of rows) {
    if (String(row.kind ?? '面试') !== '面试') continue
    const key = chainKey(row)
    const when = row.scheduled_at ? String(row.scheduled_at) : ''
    const items = parseQA(row.questions)
    const chain = map.get(key) ?? {
      key,
      company: String(row.company ?? ''),
      title: String(row.title ?? ''),
      rounds: [],
      latest: '',
    }
    chain.rounds.push({
      id: row.id ?? null,
      round: String(row.round_name ?? '未命名'),
      result: String(row.result ?? 'pending'),
      when,
      questionCount: items.length,
      answered: answeredCount(items),
    })
    if (when > chain.latest) chain.latest = when
    map.set(key, chain)
  }
  return [...map.values()]
    .map((c) => ({
      ...c,
      rounds: c.rounds.sort((a, b) => roundRank(a.round) - roundRank(b.round) || a.when.localeCompare(b.when)),
    }))
    .sort((a, b) => b.latest.localeCompare(a.latest))
}

/** 链条进度：走到哪一轮、过了几轮、下一场是什么 */
export function chainProgress(chain: RoundChain): { passed: number; failed: number; next: string } {
  const passed = chain.rounds.filter((r) => r.result === 'pass').length
  const failed = chain.rounds.filter((r) => r.result === 'fail').length
  const pending = chain.rounds.find((r) => r.result === 'pending')
  return { passed, failed, next: pending ? pending.round : passed ? '已走完全部已登记轮次' : '未登记下一轮' }
}
