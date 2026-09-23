export const STAGES = [
  { key: 'applied', label: '已投递', color: '#3b82f6' },
  { key: 'written', label: '笔试', color: '#f59e0b' },
  { key: 'interview', label: '面试', color: '#8b5cf6' },
  { key: 'offer', label: 'Offer', color: '#12a150' },
  { key: 'rejected', label: '已挂', color: '#9aa3af' },
] as const

export const JOB_TYPES = ['实习', '日常实习', '暑期实习', '校招', '社招']
export const CHANNELS = ['BOSS直聘', '实习僧', '官网投递', '内推', '牛客', '浏览器采集', '岗位广场', '其它']
export const INDUSTRIES = ['互联网', '人工智能', '金融', '游戏', '硬件/芯片', '政企/国企', '其它']
export const PRIORITIES = ['高', '中', '低']
export const DIMS = ['技能匹配', '经验匹配', '成长空间', '薪资结构', '工作强度', '稳定性', '通勤'] as const
export const TASK_KINDS = ['投递', '笔试', '面试', '截止', '跟进', '其它']
export const KNOW_CATEGORIES = ['八股', '面经', '项目', '打招呼话术', '公司情报']
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

/** 网申填写包字段顺序（也用于 Chrome 扩展的字段匹配） */
export const APPLY_KIT_FIELDS = [
  '姓名',
  '性别',
  '联系电话',
  '电子邮箱',
  '学校',
  '学历',
  '专业',
  '年级',
  '毕业年份',
  '期望城市',
  '期望岗位',
  '期望日薪',
  '可到岗时间',
  '可实习时长',
  '技能关键词',
  'GitHub',
  '作品集',
  '一句话自我介绍',
  '项目经历',
] as const

/** 打招呼生成的硬约束：只放大可验证能力，不主动暴露短板 */
export const GREETING_RULES = `打招呼纪律（必须严格遵守）：
1) 开场身份只写「届数 + 专业 + 姓名」，绝不出现任何学校名称。
2) 只放大简历中真实存在、可由 GitHub 仓库 clone 验证的能力；不会的、没做过的技术一个字都不提，也不写"概念通/上手快/没做过"这类自我设限或反向提醒。
3) JD 里未接触过的加分项，用同类且更硬的能力顶上（例如要 Redis 就只讲 MySQL；要 Vue 就讲 React）。
4) 技术数字口径必须与简历一致：5 个项目 / 6 个仓库 / 508 条测试（146 + 71 + 79 + 48 + 129 + 35）、9 条评测，不得出现其它数字。
5) 长度贴住对方问题的强度：问一个词就回 2-3 行；只有对方问技术才展开。
6) 用口语化的自己的话，保留一处不完美，不要每句都踩点、不要三项并列等长、不要照搬简历原句、不要引用对方 JD 原文。
7) 不承诺无法兑现的事，不虚构经历。`
