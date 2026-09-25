# 求职智能体 · 实施计划（待开工）

> **给接手本计划的智能体**：先读 `AGENTS.md`（硬约束）与 `docs/HANDOFF.md`（怎么做才不出错），
> 确认基线（`npm run typecheck && npm test` 当前 **392 条断言全绿**，28 个测试文件），
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

### 第一步：限额护栏（必须最先，否则 agent 烧额度失控）
- 全应用每天 N 次大模型调用硬上限（含 evaluateJD/generateGreeting/generateInterviewPrep/agent 循环）
- 超出给明确提示「今日额度已用完，明天再来」（额度记在创建者账号，文案要说明）
- 实现参考：现有频控框架 `pace.ts` + profile 的 daily_greet_limit 先例；
  计数存 localStorage（设备级）或 profile 表（跨设备）——二选一并写明理由

### 第二步：agentLoop + agentTools + 每日巡检 v1
- 场景：「说一句今天该干嘛」→ agent 自主查跟进/漏斗/截止/日程 → 产出行动清单
- 总览页入口（按钮 + 结果面板 + 每步审计展示——审计可视化本身就是面试演示素材）
- 断言要点：循环步数上限、Observation 不可伪造、final_answer 正常返回、
  工具失败重试上限、审计数组结构

### 第三步：投递决策智能体
- 场景：粘一个 JD → agent 串起 prefilter → keywordCoverage → 对照池内数据 → 投/不投建议
### 第四步：项目教练（任务包生成器）
- 输入方向+水平 → 4 周计划 + 每步一段「可直接粘给 WorkBuddy/Claude Code 的完整指令」
  （含验收标准：至少 N 条测试、README 要求、用户须能独立讲清什么）
- 用户在自己 GitHub 建仓派活给任意智能体；完成后回工作台做验收（GitHub 公开仓库只读 API）
- 定位是教练不是代做：agent 写的代码用户必须 review/跑通/能讲清，否则面试穿帮（实测教训）

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
