/**
 * 「岗位差距三档 + 补齐计划」的纯逻辑层（学牛客求职 Skill 的设计）。
 *
 * 把 AI 评估已有的 highlights / gaps 升级成三档：
 *   已满足（met）      —— 模型给出的亮点，原样保留
 *   待确认（confirm）  —— JD 里提到、但**无法替用户核实**的事实（学历/到岗时长/届数…）
 *                         这档是牛客设计里最值得学的一点：诚实列出「AI 不知道、只有你知道」的部分
 *   欠缺（missing）    —— 模型给出的缺口，每条配一个可执行的补齐动作
 *
 * 纯函数、不改表结构：ai_reports 的列不动（schema 工具当前不可用），
 * 待确认档从 JD 原文用关键词规则现算，不落库。
 */

export interface MissingItem {
  /** 缺口原文（来自 AI 评估的 gaps） */
  item: string
  /** 可执行的补齐动作 */
  action: string
}

export interface GapPlan {
  met: string[]
  confirm: string[]
  missing: MissingItem[]
}

/**
 * 缺口 → 补齐动作的映射。口径必须与打招呼纪律一致：
 * 未接触的技术**不主动提**，用同类且更硬的能力顶上（要 Redis 讲 MySQL、要 Vue 讲 React）。
 */
const GAP_ACTIONS: Array<[RegExp, string]> = [
  [/elasticsearch|elastic\s?search|\bes\b/i, '打招呼不主动提；面试前速读 ES 官方文档，把 MySQL 索引优化与检索经验讲透'],
  [/vue/i, '不主动提；用 React 同栈项目的组件设计与状态管理经验顶上'],
  [/redis/i, '不主动提；把 MySQL 查询优化与「为什么需要缓存」的思路讲清楚'],
  [/pytorch|深度学习|训练模型/i, '不主动提；强调 LLM 应用工程与 RAG 落地经验，算法岗如实说工程强于训练'],
  [/dify/i, '不主动提；用 LangGraph / LangChain 的等价实践（编排、工具调用、记忆）顶上'],
  [/k8s|kubernetes|运维/i, '不主动提；用 Docker 容器化交付经验讲清部署链路'],
  [/go语言|golang/i, '不主动提；用 Python/Node 服务端与 Spring Boot 的后端功底顶上'],
]

function actionFor(gap: string): string {
  for (const [re, action] of GAP_ACTIONS) {
    if (re.test(gap)) return action
  }
  return '面试前花 30 分钟读官方文档速览；打招呼与简历里不主动提这条'
}

/** JD 关键词 → 待确认项。只列「AI 不知道、只有用户知道」的事实，不猜测结论 */
const CONFIRM_RULES: Array<[RegExp, string]> = [
  [/本科|硕士|研究生|博士|学历/, 'JD 提到学历要求 —— 核对在读年级是否符合'],
  [/每周\s*\d|天\s*\/\s*周|实习时长|\d+\s*个月/, 'JD 提到到岗时长/每周天数 —— 核对你的可实习周期能否覆盖'],
  [
    /20\d{2}\s*届|(?:19|20)\d{2}\s*年[^。；;，,]{0,8}(毕业|应届)/,
    'JD 提到届数/毕业年份 —— 核对是否限定（你是 2028 届）',
  ],
  [/到岗|入职时间|asap/i, 'JD 提到到岗时间 —— 确认你的最早可到岗日期'],
  [/坐班|远程|hybrid|混合办公/i, '工作形式（坐班/远程/混合）需与对方确认'],
  [/转正|return\s*offer|留用/i, 'JD 提到转正机会 —— 面试时可主动问留用率'],
]

function confirmFromJd(jd: string | null | undefined): string[] {
  const text = String(jd ?? '')
  if (!text.trim()) return []
  const out: string[] = []
  for (const [re, mark] of CONFIRM_RULES) {
    if (re.test(text) && !out.includes(mark)) out.push(mark)
  }
  return out
}

/** 组装三档。gaps/highlights 支持数组或「按行分隔的字符串」（ai_reports 存的是后者） */
export function gapPlan(
  highlights: string[] | string | null | undefined,
  gaps: string[] | string | null | undefined,
  jd: string | null | undefined,
): GapPlan {
  const toList = (v: string[] | string | null | undefined): string[] => {
    if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean)
    return String(v ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  const met = toList(highlights)
  const missing = toList(gaps).map((item) => ({ item, action: actionFor(item) }))
  return { met, confirm: confirmFromJd(jd), missing }
}
