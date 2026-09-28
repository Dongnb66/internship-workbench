const STAGES = [
  { key: 'applied', label: '已投递', color: '#3b82f6' },
  { key: 'written', label: '笔试', color: '#f59e0b' },
  { key: 'interview', label: '面试', color: '#8b5cf6' },
  { key: 'offer', label: 'Offer', color: '#12a150' },
  { key: 'rejected', label: '已挂', color: '#9aa3af' }
]

// ⚠️ 必须与 src/lib/constants.ts 的 CHANNELS 逐字一致、顺序一致。
// 少了「浏览器采集」「岗位广场」两项时，openEdit 里的 indexOf 会返回 -1 →
// 落到 index 0 → 编辑表单显示成「BOSS直聘」→ 保存即把真实来源抹掉。
const CHANNELS = ['BOSS直聘', '实习僧', '官网投递', '内推', '牛客', '浏览器采集', '岗位广场', '其它']
const JOB_TYPES = ['实习', '日常实习', '暑期实习', '校招', '社招']
const INDUSTRIES = ['互联网', '人工智能', '金融', '游戏', '硬件/芯片', '政企/国企', '其它']
const PRIORITIES = ['高', '中', '低']
const DIMS = ['技能匹配', '经验匹配', '成长空间', '薪资结构', '工作强度', '稳定性', '通勤']

const TASK_KINDS = ['投递', '笔试', '面试', '截止', '跟进', '其它']

/**
 * 「我的」页的一键填入模板：只给字段骨架与填写口径，**不含任何真实个人的信息**。
 * 与 `src/lib/constants.ts` 的 PROFILE_TEMPLATE 同源同口径 —— 改一边必须改另一边，
 * 两端各有一份，漏掉的那份会继续把陌生用户的画像填成同一个人。
 */
const PROFILE_TEMPLATE = {
  full_name: '【姓名，与证件一致】',
  grade: '【年级，如 大三】',
  grad_year: '【毕业届，四位年份 + 届】',
  major: '【专业全称】',
  school: '【学校全称 · 只进网申表单，不进打招呼话术】',
  expect_city: ['【意向城市】', '远程'],
  expect_type: ['实习', '日常实习'],
  expect_daily: null,
  skills: ['【技能，逐个填 · 只写能对着公开仓库核对的】'],
  directions: ['【投递方向，如 AI Agent 应用】'],
  available_days: '【每周几天、可连续几个月】',
  self_intro: '【一段话：届别 + 专业 + 做过什么；写进去的数字要能在公开仓库里核对】',
  resume_summary: '【项目 / 仓库 / 测试条数，逐条可核对；不写无法验证的形容词】'
}

function stageLabel(key) {
  for (let i = 0; i < STAGES.length; i += 1) {
    if (STAGES[i].key === key) return STAGES[i].label
  }
  return key || '未设置'
}

function stageColor(key) {
  for (let i = 0; i < STAGES.length; i += 1) {
    if (STAGES[i].key === key) return STAGES[i].color
  }
  return '#9aa3af'
}

/**
 * 打招呼生成的硬约束。这份文案直接决定 AI 输出的可用性，
 * 改动前先想清楚：每一条都对应一个真实踩过的坑。
 */
const GREETING_RULES = [
  '打招呼纪律（必须严格遵守）：',
  '1) 开场身份只写「届数 + 专业 + 姓名」，绝不出现任何学校名称。',
  '2) 只放大真实存在、能被 GitHub 仓库 clone 验证的能力；不会的、没做过的技术一个字都不提，也不写「概念通/上手快/没做过」这类自我设限。',
  '3) JD 里未接触过的加分项，用同类且更硬的能力顶上（例如要 Redis 就只讲 MySQL；要 Vue 就讲 React）。',
  '4) 技术数字口径必须与简历一致：5 个项目 / 6 个仓库 / 508 条测试（146 + 71 + 79 + 48 + 129 + 35）、9 条评测，不得出现其它数字。',
  '5) 长度贴住对方问题的强度：问一个词就回 2-3 行；只有对方问技术才展开。',
  '6) 用口语化的自己的话，保留一处不完美，不要每句都踩点、不要三项并列等长、不要照搬简历原句、不要引用对方 JD 原文。',
  '7) 不承诺无法兑现的事，不虚构经历。'
].join('\n')

module.exports = {
  STAGES: STAGES,
  CHANNELS: CHANNELS,
  JOB_TYPES: JOB_TYPES,
  INDUSTRIES: INDUSTRIES,
  PRIORITIES: PRIORITIES,
  DIMS: DIMS,
  TASK_KINDS: TASK_KINDS,
  PROFILE_TEMPLATE: PROFILE_TEMPLATE,
  stageLabel: stageLabel,
  stageColor: stageColor,
  GREETING_RULES: GREETING_RULES
}
