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

/**
 * 出厂模板：只给字段骨架与填写口径，**不含任何真实个人的信息**。
 *
 * 这份模板会被每个注册用户的「一键填入」灌进表单，而提示语还叫人补两格就保存。
 * 早期版本放的是发起人自己的姓名、学校、GitHub 与自我介绍，于是陌生人保存下来的
 * 画像就是发起人的画像 —— 之后的打招呼话术、AI 分析、简历生成全部以他的身份输出。
 * 所以身份字段一律用【】占位：没替换就保存，产物里会明晃晃露出方括号，
 * 而不是悄悄变成另一个人。数字字段留 null：填了数字等于替别人定死期望日薪，
 * 而 `Number('【…】')` 还会变成 NaN 存进库。
 */
export const PROFILE_TEMPLATE = {
  full_name: '【姓名，与证件一致】',
  grade: '【年级，如 大三】',
  grad_year: '【毕业届，如 2028 届】',
  major: '【专业全称】',
  school: '【学校全称 · 只进网申表单，不进打招呼话术】',
  expect_city: ['【意向城市】', '远程'],
  expect_type: ['实习', '日常实习'],
  expect_daily: null as number | null,
  skills: ['【技能，逐个填 · 只写能对着公开仓库核对的】'],
  directions: ['【投递方向，如 AI Agent 应用】'],
  available_days: '【每周几天、可连续几个月】',
  self_intro: '【一段话：届别 + 专业 + 做过什么；写进去的数字要能在公开仓库里核对】',
  resume_summary: '【项目 / 仓库 / 测试条数，逐条可核对；不写无法验证的形容词】',
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
