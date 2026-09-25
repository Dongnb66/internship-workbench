import type { Profile } from '../types'

/**
 * 硬门槛检测：把「JD 里写死、你不满足」的条件单独拎出来，别混在普通 gap 里。
 *
 * 设计来源：career-ops（72k★，MIT）的 Block G / Work-Auth 硬阻断信号 —— JD 里明写
 * 「不提供签证」时直接判为 hard blocker，而不是当一条普通缺点。移植到国内校招语境，
 * 对应的就是届数、学历、英语证书、经验年限、院校层级这几类**在初筛阶段就硬卡**的门槛。
 *
 * 三条不可让步的设计约束（同源思想：估算永远不能进最高档）：
 * 1. **证据必须来自 JD 原句**：每条阻断都带 `quote`，逐字取自 JD 的某一行，用户能自己核。
 *    规则自己推断出来的东西不许当硬阻断。
 * 2. **拿不准一律降级**：措辞含「优先 / 加分 / 更佳」的一律算 soft，不算 hard；
 *    完全没有强度线索（既不说"必须"也不说"优先"）的规则**宁可不报**，避免误报挡掉好岗位。
 * 3. **硬阻断不给话术补救**：advice 一律是「别投」，不写"你可以这样解释"。
 *    这条是有意的——打招呼纪律明确不主动暴露短板，硬门槛上做辩解只会浪费双方时间。
 *
 * 隐私约束：本文件**不编码任何个人短板事实**（如某类证书是否通过）。规则只判断
 * 「JD 是否提出该要求」，具体是否满足由使用者自己对照。仓库是公开的，这条必须守住。
 */

export type BlockerLevel = 'hard' | 'soft'

export interface Blocker {
  level: BlockerLevel
  /** 命中所在行的 JD 原文（截断展示用），用户可据此自查 */
  quote: string
  /** 哪一类门槛，一句话 */
  label: string
  /** 该怎么办；硬阻断一律是「别投」 */
  advice: string
}

export interface BlockerReport {
  hard: Blocker[]
  soft: Blocker[]
  /** 一句话结论，直接可显示 */
  verdict: string
}

/** 明确措辞 = 硬要求 */
const HARD_WORDS = ['仅限', '仅限于', '必须', '要求', '须', '限定', '只招', '硬性']
/** 弱措辞 = 加分项，不算硬门槛 */
const SOFT_WORDS = ['优先', '加分', '更佳', '更好', '者优先', 'preferred', 'plus']

const MAX_QUOTE = 90

function lines(jd: string): string[] {
  return jd
    .split(/[\n\r]+/)
    .map((l) => l.trim())
    .filter(Boolean)
}

function quoteOf(line: string): string {
  return line.length > MAX_QUOTE ? `${line.slice(0, MAX_QUOTE)}…` : line
}

/** 措辞强度：优先/加分 → soft；必须/仅限 → hard；都没有 → 不报 */
function wording(line: string): BlockerLevel | null {
  if (SOFT_WORDS.some((w) => line.includes(w))) return 'soft'
  if (HARD_WORDS.some((w) => line.includes(w))) return 'hard'
  return null
}

/** 从「2028 届」这类文本里抽出生年，抽不到返回 null */
export function yearOf(text: string | null | undefined): number | null {
  const m = String(text ?? '').match(/(20\d{2})/)
  return m ? Number(m[1]) : null
}

/** 从 JD 原句里抽出所有「20xx 届」的年份 */
export function gradYearsIn(jd: string): number[] {
  const out = new Set<number>()
  for (const m of jd.matchAll(/(20\d{2})\s*届/g)) out.add(Number(m[1]))
  return Array.from(out).sort()
}

interface Ctx {
  myYear: number | null
  myCities: string[]
  /** 在读本科时非 null，用于判断「硕士及以上」这类要求 */
  undergrad: boolean
}

function ctxOf(profile: Profile | null): Ctx {
  const p = profile ?? {}
  const grade = String(p.grade ?? '')
  return {
    myYear: yearOf(p.grad_year),
    myCities: (p.expect_city ?? []).map((c) => String(c).trim()).filter(Boolean),
    // 「大三/大四/大一/大二」= 本科在读；没有年级信息时不推断，避免误判
    undergrad: /大[一二三四五]/.test(grade),
  }
}

const CITY_RE = /(?:工作地点|base\s*地?|办公地点|上班地点)\s*[：:]\s*([^\s，,。；;、/|]+)/i
const EN_YEARS = /(\d+)\s*年(?:以上|及以上)?[^。；;\n]{0,8}?(?:相关|工作|项目)?经验/

export function detectBlockers(jd: string, title: string, profile: Profile | null): BlockerReport {
  const hard: Blocker[] = []
  const soft: Blocker[] = []
  const push = (b: Blocker) => (b.level === 'hard' ? hard : soft).push(b)

  const ctx = ctxOf(profile)
  const body = `${title}\n${jd}`

  // ---- 届数：数字本身就是证据，不依赖措辞
  if (ctx.myYear) {
    const years = gradYearsIn(body)
    const other = years.filter((y) => y !== ctx.myYear)
    if (other.length && !years.includes(ctx.myYear)) {
      const hit = lines(body).find((l) => new RegExp(`(${other.join('|')})\\s*届`).test(l)) ?? ''
      push({
        level: 'hard',
        quote: quoteOf(hit),
        label: `届数不符：该岗位面向 ${other.join('/')} 届`,
        advice: `你的毕业年份是 ${ctx.myYear} 届，校招按届数卡初筛，投了通常进不了流程`,
      })
    }
  }

  for (const line of lines(body)) {
    // ---- 学历：仅当同为本科在读时才有意义
    if (ctx.undergrad && /(硕士|研究生|博士)/.test(line) && !/本科(及以上|或以上|以上)/.test(line)) {
      const level = wording(line)
      if (level) {
        push({
          level,
          quote: quoteOf(line),
          label: '学历要求达到硕士/博士',
          advice: level === 'hard' ? '学历是初筛硬卡项，本科在读投这类岗位基本过不了筛' : '若只是"优先"，仍可投，但别把学历写进任何话术',
        })
      }
    }

    // ---- 英语证书：只判断 JD 是否提出要求，不判断你是否持有
    if (/四级|CET[\s-]?4/i.test(line) || /六级|CET[\s-]?6/i.test(line)) {
      const name = /六级|CET[\s-]?6/i.test(line) ? '六级' : '四级'
      const level = wording(line) ?? 'hard'
      push({
        level,
        quote: quoteOf(line),
        label: `英语证书要求：${name}`,
        advice:
          level === 'hard'
            ? '这类要求一般在初筛直接卡，优先投不指定英语证书的岗位'
            : '只是加分项，可以投；打招呼不需要提英语',
      })
    }

    // ---- 经验年限
    const y = line.match(EN_YEARS)
    if (y && Number(y[1]) >= 2) {
      push({
        level: 'hard',
        quote: quoteOf(line),
        label: `经验年限要求：${y[1]} 年以上`,
        advice: '在校生无法满足年限门槛，直接跳过，别花时间写话术',
      })
    }

    // ---- 院校层级：措辞决定强弱
    if (/985|211|双一流|双一流建设/.test(line)) {
      const level = wording(line)
      if (level) {
        push({
          level,
          quote: quoteOf(line),
          label: '院校层级限制（985/211/双一流）',
          advice: level === 'hard' ? '明确限定院校的岗位会在简历系统里被自动过滤' : '只是倾向性表述，可以投',
        })
      }
    }

    // ---- 工作地点：与期望城市不符
    const city = line.match(CITY_RE)?.[1]
    if (ctx.myCities.length && city && !ctx.myCities.some((c) => city.includes(c) || c.includes(city))) {
      push({
        level: 'soft',
        quote: quoteOf(line),
        label: `工作地点不符期望（${city}）`,
        advice: '地点写死在 JD 里的岗位，投前先想清楚是否接受',
      })
    }
  }

  // 同类去重：同一 label 只留第一条，免得一份 JD 里重复出现同一要求刷屏
  const dedup = (arr: Blocker[]) => {
    const seen = new Set<string>()
    return arr.filter((b) => (seen.has(b.label) ? false : (seen.add(b.label), true)))
  }
  const hardU = dedup(hard)
  const softU = dedup(soft)

  const verdict = hardU.length
    ? `别投：${hardU.length} 条硬门槛（${hardU.map((b) => b.label).join('；')}）`
    : softU.length
      ? `可投，但有 ${softU.length} 条要留意`
      : '没发现写死的门槛'

  return { hard: hardU, soft: softU, verdict }
}
