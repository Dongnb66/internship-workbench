import type { Row } from '../types'

/**
 * 首次进入岗位池时的一键示例数据。
 *
 * 存在的理由：这个工具的价值在「有数据之后」才看得出来 —— 匹配度、超期提醒、投递节奏、
 * 批量评分都需要岗位池里先有东西。空表上看不到任何价值，用户就流失了。
 *
 * 刻意的取舍：公司名一律用「示例·」前缀的虚构名称，不写真实公司在招的真实岗位 ——
 * 具体 JD 是我写的，挂真实公司名就成了伪造招聘信息。岗位内容本身按真实校招/实习 JD 的
 * 结构写（职责 + 要求 + 技术栈），这样评分与话术生成的效果和真实数据一致。
 */
export interface SampleJob {
  company: string
  title: string
  city: string
  job_type: string
  industry: string
  education: string
  salary: string
  source: string
  tags: string[]
  url: string | null
  jd_text: string
  notes: string
  /** 期望落点：用来验证两段式评分是否把高低分拉开了 */
  expect: string
}

export const SAMPLE_JOBS: SampleJob[] = [
  {
    company: '示例·星野智能',
    title: 'AI Agent 应用开发实习生',
    city: '广州',
    job_type: '实习',
    industry: '人工智能',
    education: '本科',
    salary: '200-300/天',
    source: 'BOSS直聘',
    tags: ['Python', 'FastAPI', 'LangGraph', 'RAG', 'LLM'],
    url: null,
    expect: '高匹配：技能命中密度大，应落到 75 以上',
    notes: '示例数据，可一键清空。技术栈与主力项目高度重合。',
    jd_text: `岗位职责
1. 参与多智能体应用的设计与开发，基于 LangGraph / LangChain 编排工具调用与多轮对话流程；
2. 负责 RAG 检索链路的实现与调优，包括文档切分、向量/关键词混合召回、重排与答案引用；
3. 设计并维护 Agent 的记忆体系与状态管理，保证长对话下的上下文一致性；
4. 编写接口与单元测试，配合后端完成服务化部署。

任职要求
1. 本科及以上在读，计算机相关专业，每周到岗 4 天以上，可连续实习 6 个月；
2. 熟悉 Python，掌握 FastAPI 或同类 Web 框架，能独立完成接口开发与调试；
3. 了解 LLM 应用的常见范式（Prompt 工程、Function Calling、RAG），有实际项目经验优先；
4. 有良好的代码习惯，写得出可读的注释与测试；有开源项目或技术博客加分。`,
  },
  {
    company: '示例·云图数据',
    title: 'Python 后端开发实习生（数据服务）',
    city: '深圳',
    job_type: '日常实习',
    industry: '互联网',
    education: '本科',
    salary: '180-250/天',
    source: '实习僧',
    tags: ['Python', 'MySQL', 'Docker', 'REST API'],
    url: null,
    expect: '中匹配：命中 Python / MySQL / Docker，但不涉及 LLM',
    notes: '示例数据，可一键清空。典型的后端实习，考察接口与数据库基本功。',
    jd_text: `工作内容
1. 参与数据服务平台的后端开发，负责 REST 接口的设计、实现与联调；
2. 编写 SQL 与数据校验脚本，配合数据同学完成指标口径落地；
3. 参与服务容器化改造，维护 Docker 镜像与本地开发环境；
4. 编写 pytest 单元测试，参与日常代码评审。

任职要求
1. 计算机相关专业本科在读，大三或研二优先，每周到岗至少 3 天；
2. 熟悉 Python，了解 Flask / FastAPI / Django 中至少一种；
3. 熟悉 MySQL 基本使用：建表、索引、常用查询与慢查询排查思路；
4. 了解 Linux 常用命令与 Git 协作流程；
5. 有良好的沟通习惯，能把自己的进度说清楚。`,
  },
  {
    company: '示例·矩石科技',
    title: '前端开发实习生（可视化方向）',
    city: '广州',
    job_type: '实习',
    industry: '互联网',
    education: '本科',
    salary: '150-220/天',
    source: 'BOSS直聘',
    tags: ['React', 'TypeScript', 'Vue', 'ECharts'],
    url: null,
    expect: '中低匹配：命中 React/TypeScript，但 JD 主推 Vue',
    notes: '示例数据，可一键清空。用来验证「JD 里未接触的加分项」如何处理。',
    jd_text: `岗位职责
1. 负责公司数据看板的前端开发，使用 Vue 3 + TypeScript 实现图表与交互；
2. 与设计、后端协作，完成从接口对接到上线验收的完整链路；
3. 优化首屏加载与渲染性能，处理大数据量表格与图表的卡顿问题；
4. 沉淀可复用组件，维护团队组件库。

任职要求
1. 本科在读，计算机或相关专业，每周到岗 4 天以上；
2. 熟练掌握 Vue 3 及周边生态（Vue Router、Pinia），有完整项目经验；
3. 熟悉 TypeScript、ES6+、CSS 布局，了解常见性能优化手段；
4. 熟悉 ECharts 或同类可视化库，能独立完成图表配置；
5. 对交互细节有要求，愿意主动找设计确认，而不是照图硬写。`,
  },
  {
    company: '示例·海岳网络',
    title: '后端开发实习生（高并发服务）',
    city: '北京',
    job_type: '暑期实习',
    industry: '互联网',
    education: '本科',
    salary: '250-350/天',
    source: '官网投递',
    tags: ['Go', 'Redis', 'Kafka', 'Kubernetes', 'MySQL'],
    url: null,
    expect: '低匹配：技术栈大面积未接触，预筛应判为不值得投',
    notes: '示例数据，可一键清空。刻意放进未接触的技术栈，用来看预筛怎么挡住它。',
    jd_text: `岗位职责
1. 参与核心交易链路的后端研发，负责高并发场景下的服务设计与实现；
2. 基于 Redis 设计缓存与分布式锁方案，处理热点 key 与缓存一致性；
3. 使用 Kafka 构建异步消息链路，保障消息不丢不重；
4. 服务部署在 Kubernetes 集群，参与容量评估与线上问题排查。

任职要求
1. 本科及以上在读，计算机相关专业，有扎实的数据结构与算法基础；
2. 熟练使用 Go 语言，熟悉 GMP 调度模型与常用并发原语；
3. 熟悉 Redis、Kafka、MySQL 的原理与常见问题定位；
4. 了解 Kubernetes 基本概念，能看懂 Deployment 与 Service 配置；
5. 有 ACM / 开源项目 / 高质量技术博客者优先。`,
  },
  {
    company: '示例·拓维教育',
    title: '数据工程实习生',
    city: '远程',
    job_type: '日常实习',
    industry: '互联网',
    education: '本科',
    salary: '150-200/天',
    source: '内推',
    tags: ['Python', 'SQL', '数据清洗', '报表'],
    url: null,
    expect: '中匹配：Python 与数据处理对得上，方向略有偏差',
    notes: '示例数据，可一键清空。远程岗，用来验证「远程」是否命中期望城市。',
    jd_text: `岗位职责
1. 负责业务数据的抽取与清洗，维护每日指标报表；
2. 用 Python 编写数据处理脚本，处理脏数据与异常值；
3. 配合产品同学定义口径，输出可复用的 SQL 视图；
4. 参与数据质量巡检，发现并上报数据异常。

任职要求
1. 本科在读，计算机、统计或数学相关专业；
2. 熟悉 Python（pandas 为主）与 SQL，能独立完成数据清洗任务；
3. 对数据敏感，遇到异常数字会追问原因而不是直接交差；
4. 远程办公，需要自驱与及时同步进度；
5. 每周可投入 20 小时以上。`,
  },
]

export const SAMPLE_NOTE_TAG = '示例数据'

/** 示例岗位 → 入库 payload；匹配度仍由调用方按当前画像计算 */
export function sampleToRow(sample: SampleJob, score: number): Row {
  return {
    company: sample.company,
    title: sample.title,
    city: sample.city || null,
    job_type: sample.job_type,
    industry: sample.industry,
    education: sample.education,
    salary: sample.salary || null,
    source: sample.source,
    url: sample.url || null,
    jd_text: sample.jd_text,
    tags: sample.tags,
    priority: score >= 75 ? '高' : score >= 55 ? '中' : '低',
    status: 'pool',
    deadline: null,
    notes: `${sample.notes}\n（${sample.expect}）`,
    match_score: score,
  }
}

/** 判定一条库内记录是不是示例数据，供「一键清空」使用 */
export function isSampleRow(row: Row): boolean {
  return String(row.company ?? '').startsWith('示例·')
}
