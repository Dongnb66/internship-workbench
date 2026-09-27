# 求职智能体 · 实施计划（四步已全部落地，2026-09-27）

> **给接手本计划的智能体**：先读 `AGENTS.md`（硬约束）与 `docs/HANDOFF.md`（怎么做才不出错），
> 确认基线（`npm run typecheck && npm test` 当前 **538 条断言全绿**，40 个测试文件），
> 再回到本文档按顺序实施。本文档是完整设计，不依赖任何对话上下文。
> 纪律不变：**每个模块先写会变红的断言再实现**（见 HANDOFF 第 4 节）。

## 0. 一句话

把现有「简历工作台」升级为**求职智能体**：给定目标（如「生成今日行动清单」），
智能体自主多步调用领域工具（查跟进、算漏斗、扫截止、排优先级），综合产出带依据的行动方案。
不是给应用改名——是真做 ReAct 循环（模型决定调哪个工具 → 应用执行 → 观察回填 → 下一步）。

## 1. 为什么值得做

- 简历上「开发了一款求职智能体」必须经得起拷打：面试官会问 memory 框架、工具注册、
  失败重试、context 管理。本设计的每一层都有代码对应（见 §3）。
- 现有 8 个纯函数模块**就是智能体的工具集**（全带测试），缺的只是循环器。
- 真实用户价值：智能体替用户每天巡检，是比「记录工具」高一个档次的付费点。

## 2. 已就绪的原料（不要重写）

| 工具 | 位置 | 说明 |
| --- | --- | --- |
| funnelStats | `src/lib/funnel.ts` | 漏斗四层转化率 |
| calibration | `src/lib/funnel.ts` | 评分校准（被拒均分 vs 推进均分） |
| followupDue | `src/lib/followup.ts` | 按状态的到期跟进清单 |
| staleApplications | `src/lib/pace.ts` | ≥7 天无动静检测 |
| todayPicks | `src/lib/daily.ts` | 今日优先投递排序 |
| keywordCoverage | `src/lib/keywordCoverage.ts` | JD 关键词覆盖比对 |
| flagReposts / matchBlacklist | `src/lib/reposts.ts` / `blacklist.ts` | 僵尸岗位与黑名单 |
| interviewFactGate | `src/lib/factGate.ts` | 面试数字 vs 简历口径 |
| localScore / prefilterJob | `src/lib/score.ts` | 本地评分与硬门槛 |
| streamChat | `src/lib/ai.ts` | 唯一模型调用入口（平台通道，流式） |

数据访问工具（agent 需要「查库」能力时）：经 `src/lib/api.ts` 的 listRows（RLS 保证只见本人数据）。

## 3. 架构设计（蒸馏自 huggingface/smolagents，github.com/huggingface/smolagents）

模式来源：smolagents 的 agents.py（1813 行）核心 = 循环 + 工具注册表 + 分型记忆 + max_steps。
蒸馏成 TypeScript，约 200-300 行，不引框架。

### 3.1 循环（新文件 `src/lib/agentLoop.ts`）

```
runAgent(task, tools, maxSteps=8):
  memory = [SystemPrompt, TaskStep(task)]
  for step in 1..maxSteps:
    模型输出（streamChat，JSON 模式）：
      {"thought": "…", "tool": "followupDue", "args": {…}}
      或 {"thought": "…", "final_answer": "…"}
    final_answer → 返回
    否则：应用执行工具 → Observation 回填 memory → 下一步
  max_steps 用尽 → 返回已收集的部分结论 + 明确说明（不假装完成）
```

硬性规则（每条都是 smolagents 实测过的坑）：
- **Observation 只由应用侧填**——模型输出被解析截断，永远不能自己编造工具结果
- **max_steps 硬上限**——超出走「部分结论」路径，不假装完成
- **每步落审计**——ActionStep 结构（thought/tool/args/observation/error/timing），
  存知识库或日志，面试里「全程审计日志」这句话的代码依据
- **工具执行失败**→ 把错误文本作为 Observation 回填，让模型自行决定重试或换路（重试上限 2 次）

### 3.2 工具注册表（新文件 `src/lib/agentTools.ts`）

每个工具 = { name, description（给模型看的用途说明）, schema（JSON 参数说明）, fn }。
description 质量 = agent 成败的一半（模型靠它选工具）。fn 一律调 §2 的纯函数。

### 3.3 记忆

ActionStep[] 数组 + `write_memory_to_messages` 等价物（把历史步骤压成对话消息）。
v1 不做跨会话记忆；审计日志可选存 knowledge 表（category: 'agent_log'），零迁移。

### 3.4 模型选择

agent 循环多次调用，**用蒸馏便宜模型**（GLM-5.3-Flash 0.06x / Deepseek-V4.1-Flash 0.11x）。
本应用的模型选择机制在 `ai.ts` 的 pickModel（用户 localStorage 偏好）——
agent 运行建议强制用便宜模型而非用户所选，避免循环烧高价模型。

## 4. 实施顺序（一步一个发布）

### 第一步：限额护栏（必须最先，否则 agent 烧额度失控）✅ 已落地（2026-09-27）

- 新文件 `src/lib/quota.ts`：纯函数 `quotaStatus` / `canStartTask` + `createQuotaStore`（存储面只要求
  `getItem`/`setItem`，测试注入 Map）。三道上限 `DEFAULT_QUOTA = { dailyTasks: 20, maxCallsPerTask: 8, maxCallsPerDay: 60 }`
  —— `maxCallsPerTask` 与第二步的 `maxSteps` **必须相等**（`quota.test.ts` 钉的是 `<= 8`），否则护栏比循环还松。
- 记账落点选了 **localStorage（设备级）**而不是 profile 表列：后者是一次 schema 迁移，而 AGENTS.md §1
  把数据模型设计划归人拍板；从 `ai_reports`/`knowledge` 反算也不可靠（只有部分调用点落库）。
  **代价已知并写进设置页**：清站点数据或换浏览器会归零，所以它挡的是「失控量」，不是「铁了心的自我攻击」。
- 执行点：`streamChat` 内部（唯一入口），`StreamOptions.task` 做成**必填**——
  漏标的调用点编译期就红，另有 `src/lib/__tests__/aiQuotaCoverage.test.mjs` 从源码推导兜底。
  任务身份 = 能力 + 对象（`taskSubject`），批量评估里每个岗位各算一件事，否则第 9 个岗位会被
  「每任务 8 步上限」当成失控循环误杀。
- 记账时机：请求发出去过就算一次（含随后失败，钱确实花了）；**主动取消不记**。
- 存储坏了 → **fail-open**（放行）但 `degraded: true`，设置页显式提示「额度台账当前不可用」。
- 批量评分撞到护栏会**停整批**并把原因写在进度条上，而不是把剩下的岗位都算成「失败」。
- 测试：392 → **421**（新增 `quota.test.ts` 14、`aiQuotaGate.test.ts` 11、`aiQuotaCoverage.test.mjs` 4）。
  每道闸门都做过变异检查（关掉就变红）：quota 11 个 + streamChat 接线 4 个变异体全部被杀。

### 第二步：agentLoop + agentTools + 每日巡检 v1 ✅ 已落地（2026-09-27）
- `src/lib/agentTools.ts`：8 个工具（followupDue / staleApplications / funnelStats / calibration /
  todayPicks / paceStatus / keywordCoverage / interviewFactGate），**全部是 §2 那些纯函数的一次调用**，
  不重写算法——两边各算一遍迟早对不上，而对不上的症状是「智能体说还有 3 条，页面显示 5 条」。
  每个工具带 `implementedIn`，测试会去读那个源文件确认同名导出还在（注册表指向空气时不会假绿）。
  observation 一律裁剪到 20 条 / 2400 字，并如实带 `truncated` / `hidden`。
- `src/lib/agentLoop.ts`：ReAct 循环，模型调用**注入**（`ask`），所以单测不打网络、不烧额度。
  四条硬规则都有断言且逐个做过变异检查：Observation 只由应用侧填（模型自己写的 observation 被丢弃，
  连回给它的历史都换成结构化复述，免得那句编造以「既成事实」的身份回到上下文）、
  max_steps 硬上限 + 「部分结论」路径、每步审计（thought/tool/args/observation/error/ms）、
  工具失败回填并连续失败 2 次收手。
- `src/lib/agentRun.ts`：接到 `streamChat`。整轮循环用**固定标签「每日巡检」**（台账断言钉住），
  JSON 模式开着，signal 一路传到模型调用。
  ⚠️ 这里的 `buildAgentUserMessage` **不是可有可无的包装**：工具观察结果里带着从招聘网站抓来的
  陌生人文本，是 prompt 注入的入口。第一版接线把它裸拼进 prompt，是**推导式覆盖率检查
  （aiPromptCoverage.test.mjs）自己变红发现的**——那条检查当初就是为了「第 8 个调用点漏网」而改成推导的。
- 入口在总览页「求职智能体 · 每日巡检」卡：按钮 + 每步审计展示 + 停止 + 剩余额度，
  并写明只出清单与建议、不替你发任何东西（AGENTS §2.3）。
- 断言：421 → **457**。本步新增三个文件当时的条数是 agentTools 12 / agentLoop 17 / agentRun 7，
  到第三步又长到 15 / 17 / 12（见本节末尾的总表）——**按当时增量记账，不看现存条数**。
- **§3.4 已补上**（2026-09-27 同日）：`StreamOptions.cheap` + `pickCheapModel`，循环强制走目录里倍率最低的一档。
  漏标由推导式断言兜底（agentRun 的每个 streamChat 调用点必须带 `cheap: true`）。
- 场景 v1 只用**已有数据**跑通。

**以下是本步的原始设计要点（实现即照此，保留给后来人对照）：**

- 场景：「说一句今天该干嘛」→ agent 自主查跟进/漏斗/截止/日程 → 产出行动清单
- 总览页入口（按钮 + 结果面板 + 每步审计展示——审计可视化本身就是面试演示素材）
- **与第一步接上的两条硬约束**（改这里之前先看，别推翻护栏）：
  1. `maxSteps` 必须 **= `DEFAULT_QUOTA.maxCallsPerTask`（当前 8）**。每任务熔断按调用次数算，
     循环比闸松等于没有闸；`quota.test.ts` 有 `maxCallsPerTask <= 8` 这条断言钉着。
  2. agent 的每一圈都调 `streamChat`，而 `StreamOptions.task` 是**必填**。整轮循环用**同一个固定标签**
     （如「每日巡检」）——这样 8 圈才算「一件事转了 8 步」并被熔断；每圈换标签就等于绕过这道闸。
     固定标签还会被 `aiQuotaCoverage.test.mjs` 的推导式扫描看见，漏标编译期就红。
- 断言要点：循环步数上限、Observation 不可伪造、final_answer 正常返回、
  工具失败重试上限、审计数组结构

### 第三步：投递决策智能体 ✅ 已落地（2026-09-27）
- 新纯函数 `src/lib/companyHistory.ts`（9 条断言）：一家公司在池子里挂了几条、投过几条、到哪一步、
  平均匹配分、最近一次沟通。两条容易悄悄算错的口径被单独钉住：**投递没有 job_id 时按公司名归集**
  （只按 job_id 会漏掉整段历史），**没评分的岗位不能当 0 分**（`Number(null) === 0`）。
- 工具表加到 10 个：`prefilterJob`（本地分 + 硬门槛，命中就别再花模型额度）与 `companyHistory`。
- 新场景 `runApplyDecision(ctx, {jd, company, title})`（`agentRun.ts`）：串 prefilter →
  companyHistory → keywordCoverage → 投/不投建议。入口在「AI·JD 评估」页按钮「让智能体判断投不投」。
- **原始 JD 不进 prompt**：它只放在 `ctx.focus` 里由工具读取。模型看到的只有工具返回的派生结果，
  而那些都在不可信数据区里。粘贴的 JD 是陌生人写的文本，少一处原文进对话就少一处注入面
  ——`agentRun.test.ts` 用「JD 尾部埋一个标记串，任何一轮都不许出现它」来钉这条。
- 工具在 args 缺省时回落 `ctx.focus`：**不要让模型把 JD 抄回 args**，几百字抄一遍必然抄错，
  抄错之后算的是另一个岗位，结论就挂在不存在的东西上。
- 额度标签由 `decisionLabel(company, title)` 单点生成：页面预检与 streamChat 记账必须同名，
  两边各拼一次迟早对不上（症状是「提示还能用，一调就熔断」）。
  `aiQuotaCoverage.test.mjs` 扫页面，见到自己拼标签就红。
- 断言：457 → **475**；本步 8 个变异体全部被杀（含「把 JD 塞回 prompt」「页面自己拼额度标签」这两个）。

- 场景：粘一个 JD → agent 串起 prefilter → keywordCoverage → 对照池内数据 → 投/不投建议
### 第四步：项目教练（任务包生成器）✅ 已落地（2026-09-27）
- 新纯函数 `src/lib/mentor.ts`（17 条断言）：方向 + 水平 + 周期 → 四周六步任务包，
  每步都带**可核对验收**（测试条数下限逐步变严、README 必须写「怎么跑起来」与「为什么这样设计」、
  以及「你必须能独立讲清」的具体问题）。
- 新纯函数 + 只读接口层 `src/lib/githubVerify.ts`（12 条断言）：对着公开仓库核 README / 运行说明 / 设计说明。
- 入口：新页面「项目教练」（`src/pages/Coach.tsx`，资产组，icon 🧭）。
- **定位是教练不是代做**，而且这条不是口号：
  - 指令里每步都写「你必须自己跑通、逐条讲清」，任务包全文禁出现「帮你写完 / 无需理解 / 原样提交」
    这一类代做口吻（有断言逐条扫）。
  - 只读接口**看不到测试条数**，所以验收把这条归入「请你本地跑一次再核对」而不是「判你没过」也不是「判你过了」。
    把读不到的东西写成判定，是这类工具最常见的假精确。
  - 404 / 403 / 限流一律 `unreachable` → verdict `unknown`（「无法确认」），绝不折算成「你没做完」。
- 三条边界写死在代码里：仓库名不合法就不发请求（防 `a/../evil` 拼进 URL）、
  `FetchOptions` **没有 headers 这个口子**（只读公开接口不需要凭据，类型上一旦允许传，
  「我们从不携带凭据」就变成假的）、请求只 GET `api.github.com/repos/...`。
- **生成与验收都不打模型**：任务包是本地模板产物，验收走公开只读接口，两者都不消耗创建者额度。
- 隐私与口径：任务包不出现学校名称、不替用户断言个人短板（断言逐条扫），
  并强制要求「数字与简历口径一致」。
- **变异检查按实况记**：四步合计约 55 个变异体，其中 **2 个一度存活**，而两次存活都挖出了真问题、
  不是测试噪声——① 工具层那句 `filter(i => i.ok === false)` 是**死代码**（`interviewFactGate`
  本来就只返回违规项），删掉；② 「每步的技术抓手」当时**没有任何断言守着**，补断言之后那个变异体才被杀。
  在补上断言之前就说「全部被杀」是假的，所以这里不那么写。

**以下是本步的原始设计要点（实现即照此，保留给后来人对照）：**

- 输入方向+水平 → 4 周计划 + 每步一段「可直接粘给 WorkBuddy/Claude Code 的完整指令」
  （含验收标准：至少 N 条测试、README 要求、用户须能独立讲清什么）
- 用户在自己 GitHub 建仓派活给任意智能体；完成后回工作台做验收（GitHub 公开仓库只读 API）
- 定位是教练不是代做：agent 写的代码用户必须 review/跑通/能讲清，否则面试穿帮（实测教训）

### 四步落地后的总账（2026-09-27，数字由测试跑出来，不是手抄）

| 测试文件 | 现存条数 |
| --- | --- |
| `quota.test.ts` | 14 |
| `aiQuotaGate.test.ts` | 11 |
| `aiQuotaCoverage.test.mjs` | 5 |
| `agentTools.test.mjs` | 15 |
| `agentLoop.test.ts` | 17 |
| `agentRun.test.ts` | 12 |
| `companyHistory.test.ts` | 9 |
| `mentor.test.ts` | 17 |
| `githubVerify.test.ts` | 12 |
| **新增合计** | **112** |

基线 392 + 112 = **504**，37 个测试文件；`tsc -b`、`oxlint`（0 error）、`vite build` 全绿。
各步的**增量**记在各自小节里（29 / 36 / 18 / 29），与本表合计一致。

## 5. 红线与成本（不可让步）

- 额度是**创建者额度**（记在应用创建者账号）——所有模型调用都在烧创建者的钱，
  限额护栏不是可选项。限额单位建议按「任务数」（每天 N 次巡检/评估）而非调用次数
- 智能体自主性越高，幻觉风险越大——每步审计 + max_steps + 「部分结论」路径缺一不可
- 「代做项目」不做：只做计划/规格/验收，用户必须全程参与（面试可验证性是产品地基）
- 不自动投递、不自动发消息（AGENTS.md §2.3，agent 也不行——它只生成草稿和清单）

## 6. 发布与验证

- 四件套全绿后发布；发布方式见 HANDOFF 第 6/12 节（平台发布，先移出 miniprogram/）
- 线上验证三板斧：部署记录新条目 → 线上 HTML 取 bundle 文件名 → grep bundle 中文标记
- 已知坑：HANDOFF 第 8 节全部读一遍（ESM 入口、.mjs 约定、块边界解析等，都是实测踩出来的）
