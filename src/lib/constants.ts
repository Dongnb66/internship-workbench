export const STAGES = [
  { key: 'applied', label: '已投递', color: '#3b82f6' },
  { key: 'written', label: '笔试', color: '#f59e0b' },
  { key: 'interview', label: '面试', color: '#8b5cf6' },
  { key: 'offer', label: 'Offer', color: '#12a150' },
  { key: 'rejected', label: '已挂', color: '#9aa3af' },
] as const

export const JOB_TYPES = ['实习', '日常实习', '暑期实习', '校招', '社招']
export const CHANNELS = ['BOSS直聘', '实习僧', '官网投递', '内推', '牛客', '浏览器采集', '岗位广场', '其它']

/**
 * 渠道能力边界矩阵 —— 每个渠道在「采集 / AI 处理 / 投递 / 回填」四个环节上，
 * 工具能做到什么、哪一步必须你自己动手。岗位池页渲染这张表，目的就一个：
 * 别让用户把「能采集」推断成「也能自动投递」（docs/BENCHMARK.md 的 P0 缺口）。
 *
 * 两条被 channelCapability 契约测试钉死的约束：
 * - channel 与 CHANNELS 双射：新增渠道忘了写能力行、或渠道改名后留着旧行，测试都红；
 * - apply 恒为字面量「人工」（类型上也锁死）：不自动投递、不自动发送是产品承诺
 *   （AGENTS.md §2.3），矩阵里出现「自动投递」即视为改坏。
 * 单元格里不要用 ASCII 引号和方括号 —— 契约测试按引号从源码抽数组，混入会解析失败（宁红勿脏）。
 */
export interface ChannelCapability {
  channel: (typeof CHANNELS)[number]
  /** 岗位怎么进池子 */
  collect: string
  /** 入池后 AI 能替你做什么（与渠道无关） */
  ai: string
  /** 投递由谁完成 —— 恒为「人工」 */
  apply: '人工'
  /** 网申表单回填能力 */
  backfill: string
}

export const CHANNEL_CAPABILITIES: ChannelCapability[] = [
  { channel: 'BOSS直聘', collect: '浏览器扩展一键采集当前页；本地抓取器可抓，但风控重，只能慢速串行', ai: '本地预筛 + AI 深评 + 打招呼草稿，入池即可用，不挑渠道', apply: '人工', backfill: '扩展一键填充网申表单；在线简历仍要你自己维护' },
  { channel: '实习僧', collect: '本地抓取器 + 浏览器扩展', ai: '本地预筛 + AI 深评 + 打招呼草稿，入池即可用，不挑渠道', apply: '人工', backfill: '扩展一键填充网申表单' },
  { channel: '官网投递', collect: '本地抓取器（公司招聘板清单）+ 浏览器扩展', ai: '本地预筛 + AI 深评 + 打招呼草稿，入池即可用，不挑渠道', apply: '人工', backfill: '网申填写包 + 扩展一键填充；官网表单字段最杂，这里作用最大' },
  { channel: '内推', collect: '没有自动采集，手工登记', ai: '本地预筛 + AI 深评 + 打招呼草稿，入池即可用，不挑渠道', apply: '人工', backfill: '内推通常没有公开表单；需要时用填写包自己填' },
  { channel: '牛客', collect: '本地抓取器（牛客校招）+ 浏览器扩展', ai: '本地预筛 + AI 深评 + 打招呼草稿，入池即可用，不挑渠道', apply: '人工', backfill: '扩展一键填充网申表单' },
  { channel: '浏览器采集', collect: '扩展只读「你当前打开的那一屏」，一键采集入库', ai: '本地预筛 + AI 深评 + 打招呼草稿，入池即可用，不挑渠道', apply: '人工', backfill: '扩展一键填充当前页面' },
  { channel: '岗位广场', collect: '广场一键加入岗位池（公共库 + OfferBiu 校招源），复制的是快照、与他人无关', ai: '本地预筛 + AI 深评 + 打招呼草稿，入池即可用，不挑渠道', apply: '人工', backfill: '广场本身没有表单；投递与回填跟随你最终投递的渠道' },
  { channel: '其它', collect: '手工录入', ai: '本地预筛 + AI 深评 + 打招呼草稿，入池即可用，不挑渠道', apply: '人工', backfill: '看具体平台；常见字段扩展一般都能填' },
]
export const INDUSTRIES = ['互联网', '人工智能', '金融', '游戏', '硬件/芯片', '政企/国企', '其它']
export const PRIORITIES = ['高', '中', '低']
export const DIMS = ['技能匹配', '经验匹配', '成长空间', '薪资结构', '工作强度', '稳定性', '通勤'] as const
export const TASK_KINDS = ['投递', '笔试', '面试', '截止', '跟进', '其它']
export const KNOW_CATEGORIES = ['八股', '面经', '项目', '打招呼话术', '公司情报', '面试准备']
export const RESUME_DIRECTIONS = ['AI Agent 方向', '后端方向', '全栈方向', '算法方向', '通用投递']

/** 目标条件模板：一键填入发起人已知的可验证事实，可自行修改 */
export const PROFILE_TEMPLATE = {
  full_name: '杨运栋',
  grade: '大三',
  grad_year: '2028 届',
  major: '计算机科学与技术',
  school: '吉首大学张家界学院',
  expect_city: ['广州', '深圳', '远程'],
  expect_type: ['实习', '日常实习'],
  expect_daily: 180,
  skills: ['Python', 'FastAPI', 'LangGraph', 'RAG', 'React', 'TypeScript', 'Node/Express', 'Spring Boot', 'MySQL', 'Docker', 'pytest/JUnit'],
  directions: ['AI Agent 应用', 'LLM 工程', 'Python 后端', '全栈开发'],
  available_days: '每周 5 天，可连续实习 6 个月以上',
  self_intro:
    '2028 届计算机科学与技术本科在读，独立完成 5 个开源项目（6 个仓库、508 条测试），主力项目用 FastAPI + LangGraph 实现多智能体学习系统，含 BM25 三道代码级防幻觉 RAG 与三层记忆。',
  resume_summary:
    '5 个开源项目 / 6 个仓库，合计 508 条测试（python-learning-agent 146 · campus-mutual-aid 71 · travel-rank 79 · mcp-toolkit 48 · offer-pipeline 前端 129 + agent-platform-java 后端 35）。' +
    '主力项目 python-learning-agent：FastAPI + LangGraph，ReAct 自主辅导 Agent + BM25 三道代码级防幻觉 RAG + 三层记忆，pytest 全离线可跑。' +
    '可流畅阅读英文技术文档与官方 API 文档。',
}

/**
 * 网申填写包的字段清单 —— **唯一事实源**。
 *
 * 这份清单有三个消费者：填写包页面（生成 `applykit.json`）、浏览器扩展（按它去页面上
 * 找对应输入框填入）、契约测试（校验两边一致）。以前三个地方各写一份，
 * 结果「性别」「技能关键词」在页面里导出了、扩展里却没有对应规则 —— 用户以为填了，
 * 页面上其实是空的，而且全程不报错。所以清单必须只有一处。
 *
 * `fillable` 这个标记是给契约测试用的：像「简历文件名」这种只随包带出去供人核对、
 * 页面上并没有对应输入框的字段，必须显式标成 false，否则测试会永远要求扩展
 * 给它写一条匹配规则，逼着后来的人要么加假规则、要么关掉测试。
 */
export const APPLY_KIT_FIELDS = [
  { label: '姓名', required: true, fillable: true },
  { label: '性别', required: true, fillable: true, hint: '按证件如实填' },
  { label: '联系电话', required: true, fillable: true },
  { label: '电子邮箱', required: true, fillable: true },
  { label: '学校', required: true, fillable: true },
  { label: '学历', required: true, fillable: true },
  { label: '专业', required: true, fillable: true },
  { label: '年级', required: false, fillable: true },
  { label: '毕业年份', required: true, fillable: true },
  { label: '期望城市', required: false, fillable: true },
  { label: '期望岗位', required: false, fillable: true },
  { label: '期望日薪', required: false, fillable: true },
  { label: '可到岗时间', required: false, fillable: true },
  { label: '可实习时长', required: false, fillable: true },
  { label: '技能关键词', required: false, fillable: true },
  { label: 'GitHub', required: false, fillable: true },
  { label: '作品集', required: false, fillable: true },
  { label: '一句话自我介绍', required: false, fillable: true },
  { label: '项目经历', required: false, fillable: true },
  { label: '简历文件名', required: false, fillable: false, hint: '仅供你核对投的是哪一版，页面上没有这个输入框' },
] as const

export type ApplyKitLabel = (typeof APPLY_KIT_FIELDS)[number]['label']

/** 取值映射必须覆盖清单里的每一个字段：漏一个，TypeScript 直接报错（编译期强制，不靠人记） */
export type ApplyKitValues = Record<ApplyKitLabel, string>

/** 用户自定义提示（少数需要额外说明的字段才有） */
export const APPLY_KIT_HINTS: Partial<Record<ApplyKitLabel, string>> = Object.fromEntries(
  APPLY_KIT_FIELDS.filter((f) => 'hint' in f).map((f) => [f.label, (f as { hint: string }).hint]),
) as Partial<Record<ApplyKitLabel, string>>

/** 打招呼生成的硬约束：只放大可验证能力，不主动暴露短板 */
export const GREETING_RULES = `打招呼纪律（必须严格遵守）：
1) 开场身份只写「届数 + 专业 + 姓名」，绝不出现任何学校名称。
2) 只放大简历中真实存在、可由 GitHub 仓库 clone 验证的能力；不会的、没做过的技术一个字都不提，也不写"概念通/上手快/没做过"这类自我设限或反向提醒。
3) JD 里未接触过的加分项，用同类且更硬的能力顶上（例如要 Redis 就只讲 MySQL；要 Vue 就讲 React）。
4) 技术数字口径必须与简历一致：5 个项目 / 6 个仓库 / 508 条测试（146 + 71 + 79 + 48 + 129 + 35）、9 条评测，不得出现其它数字。
5) 长度贴住对方问题的强度：问一个词就回 2-3 行；只有对方问技术才展开。
6) 用口语化的自己的话，保留一处不完美，不要每句都踩点、不要三项并列等长、不要照搬简历原句、不要引用对方 JD 原文。
7) 不承诺无法兑现的事，不虚构经历。`
