/**
 * 项目教练：把「想做个项目」变成一份可以直接派活的四周任务包（AGENT_PLAN 第四步）。
 *
 * 定位是**教练不是代做**。本模块产出的不是代码，而是「每一步该要什么、怎么验收」：
 * 用户拿这些指令去派给任意智能体（WorkBuddy / Claude Code / Cursor…），
 * 自己 review、自己跑通、自己讲清。这一步刻意不能省——
 * agent 写的代码如果用户讲不清，简历上那句「我做了 X」在面试第二轮就穿帮了（实测教训）。
 *
 * 因此这里有三条硬规矩，每条都对应一条断言：
 * 1. 每步都要有**可核对的验收**（测试条数下限、README 要求、必须能讲清的点），
 *    没有验收的任务包等于让人凭感觉交差。
 * 2. 每步指令都必须写明**用户必须亲自参与**，并且永远不出现「帮你写完 / 无需理解」这种代做口吻。
 * 3. 遵守 AGENTS.md §2.2 的口径纪律：**不出现学校名称、不替用户断言个人短板**，
 *    技术数字一律要求「与简历口径一致」（面试官会 clone 仓库核对）。
 */
import type { Profile } from '../types'

export const WEEKS_DEFAULT = 4

export interface TaskPackGoal {
  direction: string
  /** 零基础 / 入门 / 进阶 */
  level: string
  weeks?: number
}

export interface TaskAcceptance {
  minTests: number
  readmeRequired: string[]
  mustExplain: string[]
}

export interface TaskStep {
  index: number
  week: number
  title: string
  /** 可直接粘贴给任意智能体的完整指令 */
  instruction: string
  acceptance: TaskAcceptance
}

export interface TaskPack {
  direction: string
  level: string
  weeks: number
  stack: string[]
  /** true = 这个方向没有专门模板，按通用工程档给 */
  fallback: boolean
  note: string
  steps: TaskStep[]
}

type Track = 'rag' | 'agent' | 'backend' | 'frontend' | 'general'

function pickTrack(direction: string): { track: Track; matched: boolean } {
  const d = direction.toLowerCase()
  if (/rag|检索|召回|知识库|向量|embed|retriev/.test(d)) return { track: 'rag', matched: true }
  if (/agent|智能体|工具调用|function call|react|编排/.test(d)) return { track: 'agent', matched: true }
  if (/后端|服务|api|java|go|python|spring|数据库|分布式/.test(d)) return { track: 'backend', matched: true }
  if (/前端|react|vue|typescript 全栈|小程序|可视化/.test(d)) return { track: 'frontend', matched: true }
  return { track: 'general', matched: false }
}

/** 每步的技术抓手：写进指令里，让验收标准落在具体可查的东西上 */
const TRACK_TECH: Record<Track, string[]> = {
  rag: ['文档切分与向量化', '检索召回与重排', '生成侧引用与溯源', '离线评测指标（命中率 / 召回率）'],
  agent: ['工具注册与函数调用', '多步循环与最大步数', '失败重试与回退', '每步审计日志'],
  backend: ['接口分层与参数校验', '数据模型与迁移', '并发与幂等', '集成测试覆盖主流程'],
  frontend: ['组件拆分与状态管理', '首屏与包体积', '可访问性与响应式', '关键交互的组件测试'],
  general: ['最小可运行闭环', '模块化与接口', '自动化测试', '可复现的运行说明'],
}

/** 每步「用户必须能独立讲清」的问题——面试官就是问这些 */
const TRACK_EXPLAIN: Record<Track, string[]> = {
  rag: ['为什么这样切分文档，切错了会怎样', '召回不准时你用什么指标发现它', '引用溯源怎么做到不让模型编造'],
  agent: ['循环为什么必须设最大步数', '工具失败的观测结果由谁填、为什么不能由模型填', '审计日志里哪一条最能说明它没瞎编'],
  backend: ['为什么这样分层，跨层调用会带来什么', '这个接口的幂等性靠什么保证', '迁移为什么必须可回退'],
  frontend: ['状态为什么放在这一层', '这个组件边界怎么划的、理由是什么', '包体积变大你会先查什么'],
  general: ['这一版和上一版的差别与取舍', '哪个设计如果重做会换一种做法', '怎么证明它跑通了，而不只是「看着对」'],
}

/** 四周六步的骨架：每一步是一个能被验收的成果，不是一个形容词 */
const STEP_BLUEPRINTS: Record<Track, string[]> = {
  rag: [
    '跑通最小检索闭环：一篇文档进去，一条相关片段出来',
    '把切分与向量化做成可配置，并对比两种切分策略',
    '加上重排与「只根据检索内容回答」的约束，杜绝凭空生成',
    '建离线评测集，用命中率 / 召回率量化改动前后',
    '把评测与日志接进接口，给出可复现的报告',
    '整理成可交付项目：README、脚本、演示数据与取舍说明',
  ],
  agent: [
    '定义工具注册表：每个工具有名称、用途说明与参数说明',
    '实现单轮「模型选工具 → 应用执行 → 结果回填」的循环',
    '加上最大步数与「部分结论」出口，禁止假装完成',
    '工具失败重试与错误回填，让模型自己改路',
    '每步落审计（想法 / 动作 / 观察 / 错误 / 耗时）',
    '整理成可交付项目：README、演示脚本、限额与失败路径说明',
  ],
  backend: [
    '跑通最小接口闭环：一条请求进来，一条数据出去',
    '把数据模型与迁移拆出来，做到可回退',
    '参数校验与错误码统一，补齐边界用例',
    '并发与幂等：给出会被压坏的点与修法',
    '集成测试覆盖主流程，接进一条命令跑完',
    '整理成可交付项目：README、启动脚本、设计取舍说明',
  ],
  frontend: [
    '跑通最小页面：数据进来、渲染出去、能改能存',
    '拆组件与状态：把重复逻辑抽成可测的纯函数',
    '处理空 / 错 / 慢三种状态，别只演示顺利路径',
    '关键交互补组件测试，并说明为什么测这些',
    '查首屏与包体积，给出一次真实优化前后对比',
    '整理成可交付项目：README、演示地址或截图、取舍说明',
  ],
  general: [
    '先定最小可运行闭环，并把它跑起来',
    '把功能拆成模块，接口先写清楚再实现',
    '补自动化测试，覆盖最关键的那条路径',
    '让运行说明可复现：换一台机器也能一条命令起来',
    '做一次前后对比，写清为什么这样选',
    '整理成可交付项目：README、脚本与取舍说明',
  ],
}

/** 测试下限逐步变严：第一步只要求「有测试」，最后一步要求「测试撑得住别人接手」 */
const TEST_FLOOR = [3, 6, 10, 14, 18, 24]

function levelAdjust(level: string): { firstStepExtra: string; explainExtra: string[] } {
  const l = level.toLowerCase()
  if (/零基础|没有.*经验|beginner/.test(l)) {
    return {
      firstStepExtra: '环境怎么装、命令是什么，全部写进 README，我要能在第二台机器上照着跑通。',
      explainExtra: ['这一版是怎么跑起来的，逐条命令说清'],
    }
  }
  if (/进阶|熟手|advanced/.test(l)) {
    return {
      firstStepExtra: '先给我两种做法的对比与你的取舍理由，再动手；不要直接给结论。',
      explainExtra: ['被否掉的那种做法为什么否，说得出代价'],
    }
  }
  return {
    firstStepExtra: '先跑起来再谈优化，跑不起来的方案一律不算完成。',
    explainExtra: ['这一版能跑通的证据是什么'],
  }
}

function stackOf(profile: Profile | null): string[] {
  const skills = (profile?.skills ?? []).map((s) => String(s).trim()).filter(Boolean)
  return skills.length ? skills.slice(0, 4) : ['按我简历里写过的技术栈']
}

/**
 * 生成四周任务包。
 *
 * 【约束】那一栏刻意写死三件事：只用已有技术栈、技术数字与简历口径一致、必须由用户亲自 review 与讲清。
 * 这是给外部智能体的边界，也是「不替用户做作业」这条定位在文本层面的落点。
 */
export function buildTaskPack(goal: TaskPackGoal, profile: Profile | null): TaskPack {
  const weeks = goal.weeks && goal.weeks > 0 ? Math.round(goal.weeks) : WEEKS_DEFAULT
  const { track, matched } = pickTrack(goal.direction ?? '')
  const blueprints = STEP_BLUEPRINTS[track]
  const tech = TRACK_TECH[track]
  const explain = TRACK_EXPLAIN[track]
  const adj = levelAdjust(goal.level ?? '')
  const stack = stackOf(profile)

  const steps: TaskStep[] = blueprints.map((title, i) => {
    const minTests = TEST_FLOOR[Math.min(i, TEST_FLOOR.length - 1)]
    const isLast = i === blueprints.length - 1
    const mustExplain = [
      explain[i % explain.length],
      ...(i === 0 ? adj.explainExtra : []),
      isLast ? '整个项目从头到尾的设计取舍，以及你会怎么改' : '',
    ].filter(Boolean)

    const instruction = [
      `【目标】${title}`,
      `【技术抓手】${tech[i % tech.length]}`,
      `【约束】`,
      `1. 只用我已有的技术栈（${stack.join(' / ')}），不要引入我没写过的框架或语言。`,
      '2. 涉及数字（测试条数、接口数量、性能数据）必须与简历口径一致，写不出证据的数字一律不写。',
      '3. 不要出现学校名称；也不要替我写「我不擅长 X」这类自我设限的表述。',
      '4. 每一步完成后停下，等我自己跑通、逐条讲清为什么这样写，再继续下一步——不许一次把全部代码写完。',
      `5. ${adj.firstStepExtra}`,
      `【验收】`,
      `- 至少 ${minTests} 条可重复运行的测试，一条命令跑完全部测试。`,
      `- README 必须写清：怎么装、怎么跑起来；以及为什么这样设计（哪里是取舍、被否掉的方案是什么）。`,
      `- 我必须能独立回答下面每个问题，答不出的部分请指出来让我补：\n${mustExplain.map((q) => `  · ${q}`).join('\n')}`,
      isLast ? '- 最后一步交付前，把我 review 时发现的问题与修改一并记进 README 的「我知道的不足」。' : '',
    ]
      .filter(Boolean)
      .join('\n')

    return {
      index: i + 1,
      week: Math.min(weeks, 1 + Math.floor((i * weeks) / blueprints.length)),
      title,
      instruction,
      acceptance: {
        minTests,
        readmeRequired: ['依赖与安装步骤', '一条命令启动与运行测试', '为什么这样设计：关键取舍与被否掉的方案'],
        mustExplain,
      },
    }
  })

  return {
    direction: goal.direction ?? '',
    level: goal.level ?? '',
    weeks,
    stack,
    fallback: !matched,
    note: matched
      ? `按「${goal.direction}」方向的工程套路给出 ${weeks} 周 ${steps.length} 步任务包；派活给智能体前，把【约束】里的技术栈改成你自己的。`
      : `「${goal.direction}」没有专门的教练模板，这一版按通用工程档给（最小闭环 → 模块化 → 测试 → 可复现运行 → 取舍说明）；派活前请按你的实际技术栈调整【约束】。`,
    steps,
  }
}

/** 一段可直接粘贴给任意智能体的 Markdown（也适合存进个人知识库） */
export function renderTaskPack(pack: TaskPack): string {
  const head = [
    `# 项目任务包：${pack.direction || '未命名方向'}`,
    '',
    `- 水平：${pack.level || '未填'} · 周期：${pack.weeks} 周 · 共 ${pack.steps.length} 步`,
    `- 技术栈：${pack.stack.join(' / ')}`,
    `- ${pack.note}`,
    '',
    '> 用法：把每一步整段复制给智能体（WorkBuddy / Claude Code / Cursor 等），',
    '> 它给完代码后**你必须自己跑一遍、逐条讲清为什么这样写**，讲不清的那部分不要写进简历。',
    '',
  ].join('\n')

  const body = pack.steps
    .map((s) =>
      [
        `## 第 ${s.index} 步（第 ${s.week} 周）｜${s.title}`,
        '',
        s.instruction,
        '',
        '### 验收清单',
        `- [ ] 至少 ${s.acceptance.minTests} 条测试，一条命令全部跑通`,
        '- [ ] README：安装 / 运行 / 为什么这样设计（含被否掉的方案）',
        ...s.acceptance.mustExplain.map((q) => `- [ ] 我能独立讲清：${q}`),
        '',
      ].join('\n'),
    )
    .join('\n')

  return `${head}${body}\n派活前请把上面的技术栈与数字口径改成你自己的，逐条核对一遍再发出去。\n`
}
