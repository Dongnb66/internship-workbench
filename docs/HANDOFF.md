# 交接单 · 实习管理工作台（internship-workbench）

> 给接手本项目的**另一个智能体**（Codex / Claude Code / ZCode / Cursor…）。
> 本文件只写「不看代码就不知道、看代码也未必猜得到」的东西。先读本文件，再读 `AGENTS.md`（协作硬约束），
> 然后才动代码。`docs/BENCHMARK.md` 记录了对标结论与待办路线。

## 0. 一句话与坐标

一个**校招/实习投递管理工作台**：岗位池 → 本地预筛 → AI 匹配评估 → 打招呼话术 → 投递进度 → 面试复盘。

| 项 | 值 |
| --- | --- |
| 本机路径 | `C:\Users\dong\Documents\GitHub\internship-workbench` |
| 技术栈 | React 19 + Vite + TypeScript（前端）/ 平台云服务 BaaS（DB + Auth + Storage + LLM） |
| 线上地址 | https://internship-workbench-47024.app.workbuddy.host/ （发布方式见第 12 节） |
| 远程仓库 | `git@github.com:Dongnb66/internship-workbench.git` —— **已转 public**（匿名可读，2026-09-28 15:33 +0800 实测 `github.com/...` 与 `api.github.com/...` 均 200） |
| 分支 | `master`，跟踪 `origin/master`；HEAD = `7b51717`，与远端对齐（`0 0`），工作树干净 |
| 规模 | **266** 个已跟踪文件 / **56 个测试文件 / 738 条断言全绿** + 59 条真浏览器夹具断言（`cd crawler && npm run selftest`）（2026-09-28 15:33 +0800 `npm test` 实测） |

> ⚠️ **本表在 2026-09-28 15:33 前写的是「私有 / 260 文件 / 54 文件 716 条」——两者都已过期，原文按本仓库惯例不抹、在此更正。**
> 私有→public 的变更发生在 15:00 前后（`docs/sync/README.md` 规则 2 那条更正里已记：转 public 后匿名
> `GET /actions/runs` 从 404 变 200）。**这一条对交接影响最大**：第 11 节的授权步骤整节失效，见该节更正。

## 1. 五分钟上手

```bash
npm install
npm run dev          # 本地起前端（vite，5173）
npm run typecheck    # tsc -b —— 改动后必跑，类型即契约
npm test             # vitest run —— 见第 4 节的纪律，这不是可选项
npm run lint         # oxlint
npm run build        # tsc -b && vite build
```

抓取器与 OfferBiu 数据源（独立的 node 包）：

```bash
cd crawler && npm install
npm run sites                                    # 列出站点适配表
npm run crawl -- --site tencent --pages 2        # DOM 翻页抓取
node sources/offerbiu.mjs --season 2027 --limit 300 --out output/offerbiu-2027.json   # API 源
```

## 2. 架构地图（按职责找文件，别按目录名猜）

| 位置 | 职责 | 动它之前要知道 |
| --- | --- | --- |
| `src/cloud.ts` | 云服务客户端（endpoint + publishableKey） | 这两个值是**应用标识**，不含权限；不要手工拼 `/.cloud/**` 请求，走 SDK |
| `src/lib/ai.ts` | **唯一的模型调用入口** `streamChat` + prompt 组装 | 所有外部文本必须经 `wrapUntrusted` 或 `build*UserMessage`（有推导式断言守着）；`StreamOptions.task` 是**必填**（额度归属），漏标编译期就红 |
| `src/lib/quota.ts` | 限额护栏：三道上限（每日任务数 / 每任务步数 / 每日调用总数）+ localStorage 台账 | 纯函数 + 存储适配器分开，断言全部打在纯函数上；降级时**故意 fail-open** 但 `degraded` 必须可见 |
| `src/lib/agentLoop.ts` · `agentTools.ts` · `agentRun.ts` | 求职智能体：ReAct 循环 / 工具注册表 / 接到 streamChat 的接线 | 循环的模型调用是**注入**的（单测不烧额度）；工具全部调用 `src/lib/` 既有纯函数，**不要在工具里重写算法**；`agentRun` 的 `buildAgentUserMessage` 做不可信包装，删掉它等于把抓来的 JD 裸拼进 prompt |
| `src/lib/untrusted.ts` | 外部文本隔离（边界 + 声明 + 中和伪造边界） | 中和那一步有回归断言，别删 |
| `src/lib/aiChannels.ts` | 厂商白名单表（**谁的 Key 发给哪家、能不能浏览器直发、谁付钱**）+ 转发闸 + Key 脱敏 | `browserDirect` 是 **2026-09-27 实测 CORS** 的结果不是文档抄的：deepseek/moonshot/openrouter/dashscope 为 true，`open.bigmodel.cn` 为 false；本机 Ollama 档是 https 规则的唯一例外（只认 `127.0.0.1:11434`）。`findPreset` 与 `assertForwardTarget` **共用同一条匹配规则**，别再写第二遍 |
| `src/lib/byoSend.ts` | 自备 Key 的**浏览器直发器**（用户 Key 不过本项目任何服务端） | 发送前再过一次白名单；Key 只进鉴权头；厂商错误体**全部脱敏**后才进文案；`browserDirect:false` 的厂商根本不发（免得把 CORS 伪装成"你的 Key 有问题"）。`fetchImpl` 是注入点，单测不发真请求 |
| `src/lib/billing.ts` | 计费门：`decideAccess` 是「谁能用 AI」的唯一判定点 | 顺序 byo → （配好但发不出 ⇒ **拒绝**，`paidBy:'nobody'`）→ 试用 → 拒绝；读不到/抛错一律按关。**「配置好了」跟着所选档位走**（要 Key 的看 Key，本机档看探活） |
| `src/lib/byoSetup.ts` | 设置页那张卡的全部判定 + 自检 | 页面只显示不判断；Key 的掩码在**读到它的同一处**完成（`keyHint`），所以视图层拿不到原文——由 `byoHygiene.test.mjs` 从源码目录推导守着 |
| `src/lib/registration.ts` | 注册收口：新邮箱要凭邀请码 | 出厂只有 `PLACEHOLDER_CODE` = **关闭状态**（含创建者自己）。门挡在 `verifyOtp` 之前，那一步是账号唯一的产生点。占位符**永远不算可用码** |
| `src/lib/ownerAccount.ts` | 「这是不是创建者本人的账号」 | `OWNER_EMAIL` 出厂空串 = 谁都不算。「试用」开关只对创建者显示，且 `toggleTrial` 里**再判一次**（界面是入口不是授权） |
| `miniprogram/utils/billing.js` | 小程序那一端的同名门 | **这一端没有自备 Key 那条路**（`wx.request` 域名要后台白名单），所以默认拒绝且界面上**不给开关**——使用者都能翻的 flag 等于把创建者钱包放台面上 |
| `src/lib/blockers.ts` | 硬门槛检测（届数/学历/证书/年限/院校/地点） | 三条约束见文件头；**不得编码个人短板事实** |
| `src/lib/import.ts` | 采集数据 → 岗位草稿（`parseCollectorJson`） | 与 `crawler/`、`extension/` 共享 JSON 契约，改字段要同步三处 |
| `src/lib/constants.ts` | 字段清单的**唯一事实源**（填写包、渠道、岗位类型…） | `APPLY_KIT_FIELDS` 有三个消费者，别在别处再抄一份 |
| `src/lib/score.ts` | 本地关键词预筛 + 硬门槛拦截 | 批量 AI 评分靠它省额度，顺序不能反 |
| `src/pages/*.tsx` | 页面 | `ApplyKit.tsx` 的取值映射类型是 `Record<ApplyKitLabel, string>`，加字段会编译报错 |
| `extension/` | Chrome MV3 扩展：岗位采集 + 网申一键填表 | 与填写包字段清单有契约测试（`extension/__tests__/contract.test.mjs`） |
| `crawler/` | 本地抓取器（DOM 翻页）+ `sources/offerbiu.mjs`（API 源） | 两条通道**产出同一套 JSON 契约**，字段名必须逐字一致 |
| `gateway/server.mjs` | 本地网关（`npm run gateway`） | 与部署无关，别当成后端 |
| `db/` | 迁移 SQL + `db/exec/` 可粘贴执行的拆分脚本 | schema 工具当前不可用，新增表要手工执行并同步文档 |
| `src/lib/mentor.ts` · `githubVerify.ts` · `pages/Coach.tsx` | 项目教练：四周任务包生成 + 公开仓库只读验收 | 两者都**不打模型**（不消耗创建者额度）；验收读不到的东西一律说「无法确认」，不编判定 |
| `miniprogram/` | 微信小程序端 | **发布时要先移出目录**，见第 6 节。`utils/billing.js`（计费门）与 `utils/quota.js`（三道上限）是网页端同名规则的**端口**，数字由跨端契约测试钉住；agent 循环 / 工具表 / 项目教练**只在网页端**，别去 `miniprogram/utils/` 找它们 |

## 3. 不可违反的不变量

这些是「改坏了不会报错，但会出事」的一类，违反即视为改坏：

1. **RLS**：所有表 `owner_id = auth.uid()`，`USING` 与 `WITH CHECK` 都要写。
   **唯一例外** `jobs_public`（岗位广场）：只有一条 `FOR SELECT ... USING (true)`，**不建写策略**。
2. **前端写操作绝不传 `owner_id`**，走列默认值；`insertRow`/`updateRow` 里「返回空数组 = 失败」的守卫不要移除。
3. **隐私红线**：公开仓库里的代码**不得编码任何个人短板事实**（如「某证书是否通过」）。
   工具可以提示「JD 提出了该要求」，不能替用户断言「你不满足」。
4. **不自动投递、不自动发送**：只生成草稿，最终提交由人完成。这是产品承诺，不是暂未实现。
5. **合规边界**（OfferBiu 源，写死在 `crawler/sources/offerbiu.mjs` 注释里）：
   只读公开接口、不登录不带 cookie、默认 1.2 秒间隔且**不做并发**、只取公开字段、产出标注来源、鼓励落盘缓存。
   对方 `robots.txt` 为空**不等于许可**；若将来明确禁止，**删除这条源**而不是改换姿势。
6. **不绕验证码/风控/登录墙**：抓取器与扩展遇到就停。
7. **钱与身份**：三条承诺各自有断言，改动前先读它们。
   - **自备 Key 失败不许改用平台额度**（用户以为花自己的钱、实际记在创建者账上，且一声不吭）。
     执行点在 `streamChat`，由 `aiQuotaCoverage.test.mjs` 从源码推导守着 + `aiBilling.test.ts` 从行为守着。
   - **用户的 Key 只在「用户设备 ↔ 厂商」之间流动**：不进 URL、不进日志、不进错误文案、不进界面 DOM。
     读取点被 `byoHygiene.test.mjs` 推导成白名单（多一处读取点就红），掩码必须在读到它的同一处完成。
   - **"花钱"的默认值一律是关**：试用开关、创建者邮箱、存储读失败——没配置就拒绝，而不是先按能用处理。
     花钱的授权不能靠"反正没人会去勾"。**注册不是这一类**：它默认开放，因为自备 Key 落地之后
     开号本身不再产生创建者的成本（这条当天被推翻过一次，理由见 5b 第 1 条）。

## 4. 工程纪律（本仓库最值钱的部分，别降低标准）

1. **契约测试优先于功能测试**。跨模块的 JSON 契约（抓取器↔前端、填写包↔扩展、payload 字段）必须有断言，
   因为这类错位的症状是**静默的**：导入成功、字段全空、不报错。
2. **断言必须「关掉就变红」**。写完一条断言，临时把被保护的行为改回去，确认它失败**且失败信息指向具体位置**
   （文件名#序号，或直接点名缺失的字段）。做不到就说明断言是装饰。
3. **覆盖率检查必须是派生式的，不能是手写清单**。手写清单只列已知项，新增调用点不会被发现
   （本项目真实踩过：漏了第 8 个模型调用点）。正确做法是「任何出现某特征的文件都必须带某标记」，
   让新增点**默认失败**。见 `src/lib/__tests__/aiPromptCoverage.test.mjs`。
4. **扫描/解析类断言要先「钉住扫描本身」**（如「至少扫到 N 个且包含已知文件」），
   否则扫描逻辑一失效，下游断言全部假绿。
5. **改完必须跑 `npm run typecheck && npm test && npm run lint && npm run build` 四件套**，
   并把测试数变化写进提交信息（当前基线 **738**，56 个测试文件；另有 59 条真浏览器夹具断言，见第 6 节）。
   基线由 `npm test` 打印的 `Tests N passed` 为准，**不要抄这份文档里的数字**——它已经错过 4 次。
   （`.github/workflows/ci.yml` 注释里那个「716 条全绿」是**当时**的描述，属历史记录，不改。）
6. **提交信息写「为什么」**，不写「改了什么」。历次提交都遵循这个风格，可以 `git log` 看。

## 5. 当前状态快照（2026-09-28）

- **`docs/AGENT_PLAN.md` 四步全部落地**：限额护栏 → ReAct 循环 → 投递决策智能体 → 项目教练。
- **计费与通道改造落地**：AI 默认走「用户自备 Key」，且是**浏览器直发**（用户的 Key 不过本项目任何服务端）；
  小程序那一端挂了同名计费门（默认拒绝，且**故意不给界面开关**）；试用档只认创建者账号。
  **注册是默认开放**——同日先收成邀请码、当天被推翻（理由见 `CHANGELOG.md` Unreleased/Changed 与
  `src/lib/registration.ts` 文件头）：自备 Key 之后开号不再产生创建者成本，而码的代价是"每来一个用户都要亲自发一次"。
  旋钮仍在：`INVITE_CODES` 里填进真码就自动回到"要码"模式。
- 测试：**56 个文件 / 738 条断言全绿**（2026-09-28 15:33 +0800 本机实测 `npm test` → `Test Files 56 passed`、`Tests 738 passed`，
  该文档此前写的「54 个文件 / 722 条」是 09-28 早间的旧读数），部分历史轮次在 **13 个时区配置**下逐个跑过（偏移 UTC-14 … UTC+14）；
  另有 **59 条真浏览器夹具断言**（`cd crawler && npm run selftest`，
  对着 `extension/__fixtures__/` 的 7 个页面跑本机 Edge）；`tsc -b`、`oxlint`（0 error / 26 warning）、`vite build` 均通过。
- 最近提交（倒序）：日期口径收敛成一条 + CI 加时区守卫 → 时区守卫第一跑抓出的第二批
  （followup / pace / companyHistory + 4 处夹具）→ 出厂模板不再把发起人身份灌进陌生用户画像（0.8.2 止血）
  → 锁与 package.json 一致性进 CI → CI 触发器指向不存在的分支（四道门从未跑过）→ 版本号升 0.8.1。更早的见 `CHANGELOG.md`。
- **`origin/master` = 本地 = `78f6f6a`**；CI run **36378774891 全绿**（lint → typecheck → tests →
  **换非 UTC 时区再跑一遍** → build → 产物上传，全程 41 秒）。这是本项目**第一次 CI 真的绿**：
  `CI 触发器` 那条修完之后，四道门才第一次在 CI 上跑到，而第一跑就红了四轮（全红在 `Unit tests`）。
- **日期口径只有一条规则**（`format.ts#parseDate`）：纯日期串按**本地零点**构造、带 `Z`/偏移的时间戳保留时区语义；
  「按本地日历日比较」由 `daysLeft` / `daysFrom` / `staleApplications` / `followupDue` / `companyHistory` 共用。
  跨端一致性由 `crawler/__tests__/contract.test.mjs` 钉住，时区敏感性由 CI 的 `America/New_York` + `Asia/Shanghai` 两遍复跑钉住。
  ⚠️ **本机验证的坑（实测）**：Windows 上的 Node **只认 POSIX 形式**的 `TZ`（`EST5EDT` / `GMT+12` 有效），
  `TZ=America/New_York` 这类 IANA 名会被**静默忽略**、回落到系统时区（UTC+8）——
  拿 IANA 名"验证过多时区"等于没验证，本机要么用 POSIX 写法，要么交给 CI（Ubuntu 认 IANA）。
- **线上站 = `9c7ba8c` 的前端构建（0.8.6，0.8.5 那处泄露已清）**：2026-09-28 14:32 发布并实测
  `curl -s <线上>/ | grep app-version` → `<meta name="app-version" content="0.8.6" />`，首页 HTTP 200，
  域名仍是 `-47024`，sandbox 仍是 `f15f04a3222d4d6b87b8720b95f52d07`（复用原应用，未新建）。
  产物逐字节对上本目录 `npm run build`：`index-B1Lj0CS5.js` **586,387 字节**、
  sha256 `59c17f71d424bcf4ae562850bcc9557d7dfed8b18f154ac5dd9241f62b3d188a`；
  首屏引用的 3 个资源（js / css / favicon）全 200。
  **止血复核全 0**：`杨运栋` / `吉首大学` / `Dongnb66` / 邮箱本地段 / 完整地址 **各 0 命中**；
  `【姓名，与证件一致】` 命中 1 次、`example@qq.com` 命中 2 次（示例文案已中性化）。
- 历史（2026-09-28 13:4x）：线上站曾是 **`b364538` 的构建（0.8.5）**，`index-BrQBKmBl.js`
  586,390 字节、sha256 `28bf5e56…`。⚠️ **那一版的止血复核第一次报红，抓住的是我自己**：
  同一遍复核里 `Dongnb66` 是 0 命中，但发起人邮箱那串**命中 1 次** —— 0.8.5 的兜底文案把它当成了
  示例邮箱，而且它不止是"@ 前那一段"，是**带 `@qq.com` 后缀的完整地址**（第一轮汇报我把它说小了，
  照 `grep -o -- "<完整串>" | wc -l` 的读数复述，别凭印象降级）。改成 `example@qq.com` 后升 **0.8.6**，
  并把该段加进 `profileTemplate.test.mjs` 的 `IDENTITY`，由既有的全仓扫描守住
  （变异核对：改回去立刻红在 `src\lib\email.ts`）。
  ⇒ **教训：凡给用户看的示例文案，一律不许出现任何真实账号。** 这条复核清单本身是有价值的，
  它这次报的是 1 而不是 0，不是噪声。
- **线上归因方法（2026-09-28 起）**：要回答"线上跑的是哪个提交"，不再靠比文件名 / 字节数，
  而是在候选提交上开临时 worktree 重建、与线上产物比 sha256（`0.8.5` 那次重建得同名同字节同哈希
  ⇒ 线上就是 `b364538`）。重构类提交（行为不变、无可 grep 特征）只有这一招能证。
  命令与 Windows 下的坑见 `docs/sync/INBOX.md` #8 与技能 `web-project-publish-pitfalls` 陷阱 10。
- 历史（2026-09-27）：线上站曾是 `6ce185f` 的前端构建。
   **那是本项目第一次能自证成功的发布**，因为判别器换成了内容型：
  `curl -s <线上>/ | grep app-version` → 实测命中 `<meta name="app-version" content="0.8.1" />`
  （`0.8.1` 这个值只存在于 `6ce185f` 之后 ⇒ 线上构建必然 ≥ 该提交）；bundle 也逐字节对上：
  `index-Dg4AeK0-.js` 585,961 字节，sha256 前缀 `fd80e6f2`，与本目录 `npm run build` 完全一致；
  包内 `api.deepseek.com` / `127.0.0.1:11434` / `/v1/models` 命中、旧文案「新邮箱不再自行注册」0 命中。
   ⚠️ 两条口径别再犯（都实测过）：**别拿文件名或字节数当证据**（前端零改动时它们不变，见下一节的例子）；
   **也别拿 ETag / Last-Modified 当证据**——`5f2a30e` 那次发布后 12 分钟内没有任何新提交，mtime 照样被推前
   （沙箱重启也会改它），而首页 ETag 的"大小位"写的是 `292`、实际响应体 658 字节，连文件大小都不是。
   比对首屏文件时还要注意**行尾**：本机 checkout 是 CRLF、沙箱产物是 LF，同一份内容会差出 14 字节。

- ⚠️ **已知口径不一致（2026-09-28 15:33 +0800 复核，未修，待发起人定夺）**：仓库里硬编码的技术数字口径是
  **`5 个项目 / 6 个仓库 / 508 条测试`**，而发起人简历现行口径是 **`518 条测试`**（2026-09-25 逐项复核后更新，差在
  主项目 `python-learning-agent` 由 146 升到 156）。落点共 5 个产品文件 + 2 份文档 + 1 个测试：
  `src/lib/constants.ts`(#128 `GREETING_RULES`)、`miniprogram/utils/constants.js`(#64，同一条规则的移植)、
  `src/lib/healthCheck.ts`(#81)、`src/pages/AiLab.tsx`(#478)、`src/pages/ApplyKit.tsx`(#197)、
  `AGENTS.md`(#43)、以及钉住它的 `crawler/__tests__/contract.test.mjs`(#81，`PARTS` 数组含 `'508'` 与 `'146'`)。
  **为什么不在交接时顺手改**：① 它是产品代码（会进用户可见文案），改完必须升版本 + 重新发布才生效，
  否则线上继续输出旧数字；② `contract.test.mjs` 是跨端契约测试，**改数字等于同时改两端的白名单**，
  漏掉 `miniprogram/utils/constants.js` 会直接红；③ 数字口径本身属于「写进简历与所有衍生材料」的
  发起人决策（`AGENTS.md` §2.2），**不该由 agent 单方面改**。交给接手方：**先问，再改，五处一起改**。
- 已知缺口与优先级在 `docs/BENCHMARK.md` 第二节（P0：渠道能力边界表、漏斗转化统计、跟进节奏）。

### 5b. 只有创建者本人能做的四件事（代码到不了的那一半）

这一轮把"默认不花创建者的钱"做进了代码，但下面四条**必须由人来点**，我做不了：

1. **要不要给注册上锁**（默认**开放**，不做什么就能让人进）：想锁就在 `src/lib/registration.ts` 的
   `INVITE_CODES` 里填一枚真码（`npm run invites 6` 造），登录页会自动开始要码。
   这条当天被推翻过一次：第一版是"一律要码"，理由是防陌生人烧创建者额度；自备 Key + 计费门落地后
   那个前提没了（AI 花使用者自己的钱，创建者那一档默认关且只认创建者账号），而码的代价是
   **每加一个用户你都要亲自发一次码**——正好挡住你想吸引的人。
   仍然开着的两个真实成本都不花钱但会脏：验证邮件额度（套餐上限，代码查不到）、
   岗位广场公共库的写入（注册者就能投稿）。真被灌了就先上锁、再清表，可逆。
   —— **上面那半句 2026-09-28 作废**：`jobs_public` 只有 `GRANT SELECT ... TO authenticated, anon`（`db/exec/004`）
   加一条 `jobs_public_read_all` 读策略（005/006），客户端只有 `listRows('jobs_public')`（`src/lib/api.ts:62`），
   广场页自己写着「所有人可读、无人可写」，入库走 owner 执行的 SQL。**所以注册者写不进公共库**，
   这一条清单上现在只剩"验证邮件额度"一项。原文留着不抹，理由见 `CHANGELOG.md` 顶部那条更正。
2. **决定要不要"本应用额度"这一档**：`src/lib/ownerAccount.ts` 的 `OWNER_EMAIL` 出厂是空串 = 谁都不算创建者，
   所以试用开关对谁都不显示。填成你自己的登录邮箱、用该账号登录，设置页才会出现那道勾。
3. **发布**：见第 6 节（先把 `miniprogram/` 移出目录）。
4. **真点一次**：配好 Key 之后在浏览器里跑一次每日巡检 + 一次投递决策。
   这一步会真的产生厂商侧的调用（花的是使用者自己的余额），所以我不替你点。
   另外本机 Ollama 那条路要你自己装：`ollama pull qwen3:4b && ollama serve`，装不了我也验不了。

## 6. 发布流程（**只能在 WorkBuddy 平台完成**）

线上站通过 WorkBuddy 的站点发布能力部署，域名绑定应用云服务环境。步骤与坑：

1. **先把 `miniprogram/` 移出仓库目录**再发布，否则会被判定为小程序发布而失败：
   ```bash
   mv miniprogram ../_miniprogram_publish_hold
   # …执行发布…
   mv ../_miniprogram_publish_hold miniprogram   # 发布后立刻移回
   ```
2. 发布后**让用户强刷（Ctrl+F5）**。本项目多次出现「功能没生效」的误报，首因都是浏览器拿着旧 bundle。
3. 改完文案/UI 必须真打开线上链接确认，不能只看发布工具返回的 `verified`。
4. **判断"线上是哪一版"只能看内容证据，不能看时间证据。** 这条 2026-09-27 实测踩过：
   发 `5f2a30e` 时前端源码一行没动（`git diff --name-only <旧>..<新> -- src public index.html vite.config.ts` 输出为空），
   于是产物文件名、字节数、内容全与上次相同 —— "已发新码"和"还在跑旧产物"从线上**无法区分**。
   当时唯一像证据的是 `ETag` / `Last-Modified`，而我抓到 mtime 在**没有任何新提交**的情况下自己往前走了 12 分钟
   （沙箱重启同样改它，连抓 3 次值稳定，说明那是一次真的重建）。所以时间戳会被重启推前，**不能**当发布判别器。
   现在有了内容型判别器：`scripts/appVersionPlugin.mjs` 把 `package.json` 的 version 注进 `dist/index.html`，
   一句话可问 —— `curl -s https://internship-workbench-47024.app.workbuddy.host/ | grep app-version`。
   版本号只有 package.json 一个来源，任何地方都不许写死字面量（写死的标记升级后就是假话，比没标记更坏），
   这条由 `scripts/__tests__/appVersion.test.mjs` 双向钉住：既反查配置文件里有没有字面量，也反查插件是否真的挂进 `plugins`。

## 7. 接手方拿不到的东西（交接时最容易被忽略的一节）

| 能力 | 在本项目里的角色 | 接手方能否拿到 |
| --- | --- | --- |
| **站点发布**（`internship-workbench-47024.app.workbuddy.host`） | 线上唯一入口 | ❌ 绑在 WorkBuddy 平台。不在该平台则改不了线上站，只能改代码 + 本地验证，发布交回人工 |
| **云服务环境**（DB / Auth / Storage / **模型通道**） | 数据与 AI 能力的底座 | ❌ 管理入口在 WorkBuddy 控制台。可以读写代码里的 endpoint/publishableKey，但**环境本身**动不了 |
| **模型额度** | 所有 AI 功能的计费来源 | ❌ 额度错误码 `quota_` 的官方语义是 **Creator quota**，记在应用创建者账号上；接手方换不了付款方 |
| 本机 `_benchmark/`（对标克隆） | 三个参考项目的本地副本 | ➖ 与项目无关，可删（不在仓库内） |

**因此：接手方可以完整地改代码、跑测试、本地验证；但"发布到线上"与"管理云环境"两步必须由持有 WorkBuddy 平台权限的人完成。**
这两步的具体命令与操作入口在 `README.md` 与第 6 节。

## 8. 会浪费时间的具体坑（本项目实测）

- **ESM 脚本入口判断不要手拼 `file://${argv[1]}`**：Windows 上会少一道斜杠，脚本**静默不执行**（无报错无输出）。
  用 `pathToFileURL(process.argv[1]).href`。
- **需要在 node 里读文件的检查写成 `.mjs`**：app 的 tsconfig 是 `"types": ["vite/client"]`，
  用 `node:fs` 会 TS2591。`.mjs` 不参与 tsc、只参与 vitest。
- **从 JS 源码抽数组做契约测试**：块边界取「第一个 `]`」会截断最后一条（假红），要用独占一行的 `]` 或括号配对。
- **别给中文别名建白名单**：`真实姓名`/`手机号` 天然不在标签清单里，与「改名后的旧标签」无法靠字符串区分。
  改断言「规则条数 == 字段数」+「主键 ∈ 清单」构成双射。
- **`pickModel()` 的兜底是目录第一个模型**，而实测默认是 `auto`（`onlyReasoning`）——**默认就慢**。
  排查「AI 很慢」先看这里，别先怀疑网络。
- **本机沙箱里 `spawnSync('git', …)` 会报 EBUSY**（子进程被拦）。所以「忽略规则是否生效」这类检查
  **不要写成断言**——一个在别人机器上会 flaky 的测试比没有测试更糟。改为人工核对：
  ```bash
  for p in .env crawler/.profile crawler/output/x.json node_modules/ dist/ gateway/out/x; do
    printf "%-26s" "$p"; git check-ignore -q "$p" && echo ignored || echo "⚠ NOT ignored"
  done
  ```
  （2026-09-25 用这条查出 `.env` 实际没被忽略，而 `AGENTS.md` 声称它在 `.gitignore` 里 —— 已修。）

## 9. 关于「换一个智能体接手」这件事本身

- **代码层面可以无缝交接**：`AGENTS.md`（硬约束）+ 本文件（怎么做）已随仓库版本管理，
  任何 AI 工具进仓库先读这两份即可；不需要额外的口头交代。
- **三项能力交接不了**（见第 7 节）：线上发布、云服务环境管理、模型额度付款方。
  这三样都挂在 WorkBuddy 平台上，接手方只能改代码 + 本地验证。
- **仓库已于 2026-09-28 转 public**（原文写「转公开的唯一硬阻塞已经拆掉…接受即可转公开」，此处更正：
  已经转了，2026-09-28 15:33 +0800 实测匿名可读）。拆掉的阻塞正是：`PROFILE_TEMPLATE` 曾内含发起人的真实姓名、学校、
  GitHub 与自我介绍，而它是**任何注册用户都能点**的「一键填入」默认值 —— 所以那不只是交接问题，
  是线上产品缺陷。现在两端模板都是【】占位，产品代码里身份命中 0 处（有断言守）。
  密钥 / cookie / 抓取产物的历史扫描结论见第 11 节：**从没进过 git**。
  转公开同时接受了两件「非密钥暴露」（抓取器手法可读、提交节奏可见），见第 11 节。

## 10. 接手后的第一件事建议

按顺序做，别跳：

1. `npm install && npm run typecheck && npm test` —— 确认基线是 **738 全绿 / 56 个文件**（不是就先查环境）。
   历史教训：这份文档里的基线数字曾连续 4 处写旧（716/722/54），**照抄它会把正常环境误判成坏了**。
   唯一权威是 `npm test` 自己打印的 `Tests N passed`。
2. `git log --oneline -15` 读提交信息，理解近期决策的「为什么」。
3. 读 `AGENTS.md` 的硬约束 + 本文件第 3 节的不变量。
4. 从 `docs/BENCHMARK.md` 第二节挑一个 P0 缺口开工，并在动手前先写会变红的断言。

## 11. 仓库的访问方式（接手方必读）

仓库地址：`https://github.com/Dongnb66/internship-workbench`（**已转 public**）。

```bash
# 已转 public ⇒ 匿名 HTTPS 即可，无需任何凭据（2026-09-28 15:33 +0800 实测）
git clone https://github.com/Dongnb66/internship-workbench.git
cd internship-workbench && npm install && npm run typecheck && npm test   # 基线 738 全绿 / 56 个文件

# 本机（同一台 Windows）要推送时走 SSH：
# git remote set-url origin git@github.com:Dongnb66/internship-workbench.git
```

> ⚠️ **本节原标题是「私有仓库的访问方式」、正文要求「先配 SSH / Deploy Key / Collaborator」——
> 原文按惯例不抹，在此更正：仓库转 public 后这些步骤全部不需要了。**
> 2026-09-28 15:33 +0800 实测：`github.com/Dongnb66/internship-workbench` → **200**、
> `api.github.com/repos/Dongnb66/internship-workbench` → **200**（转 public 前两者都是 404）。
> 下表与「首次推送经过」保留，作为历史记录：

| 接手方运行位置 | 需要什么（**已转 public，读代码不再需要任何授权**） |
| --- | --- |
| 任意位置（只读） | 无 —— HTTPS clone 即可 |
| 本机（同一台 Windows，需要推送） | 直接用现有 SSH key（`~/.ssh/id_ed25519` 已加到 GitHub 账号） |
| 其他机器 / 云端（需要推送） | 得是 Collaborator；只读**不需要** Deploy Key 了 |

**首次推送的完整经过（历史，记下来避免重复踩）**：
1. AI 侧**建不了仓**——GitHub 集成对 `POST /user/repos` 返回 403（`Resource not accessible by integration`）。
2. AI 侧**走 HTTPS 推不了**——报 `could not read Username`（本机 git 只有 WorkBuddy 的
   `helper-selector`，不外露用户凭据）。**推送必须用 SSH remote。**
3. GitHub Desktop 的 `Publish branch` 也失败了，原因是 **Desktop 自己没登录 GitHub 账号**
   （`File → Options → Accounts` 登录可修）。它失败在建仓那一步之前，所以没有留下半成品仓库。
4. 最终路径：**人在网页建一个空仓**（不勾 README/.gitignore/license）→ AI 用 SSH 推送成功。

推送后核对过四项：远端 `master` = 本地 HEAD、分支跟踪已建立、
**未登录访问 `github.com/Dongnb66/internship-workbench` 与 API 均返回 404**（当时确认私有 ——
**这句现已失效，转 public 后是 200**）。

### 11b. 已转 public：现在必须多守一条

**仓库公开 ⇒ 任何写进 `docs/` 或提交信息的「原始输出」都可能永久可读。**本轮实测踩过一次：
一条 INBOX 条目贴 `curl` 返回体时把**发起人网络的公网出口 IP** 原样写了进去（已脱敏、`git grep` 复核 0 命中）。
写进公开仓库之前先问一句：**这段输出里有 IP / 邮箱 / cookie / 会话片段吗？**


**个人信息与密钥：转公开前的实测结论（2026-09-28 复扫）**

*已经修掉的*：`PROFILE_TEMPLATE` 曾是发起人的真实画像（姓名 / 学校 / GitHub / 作品集 /
自我介绍 / 508 条测试口径），而「一键填入模板」是**任何注册用户都能点**的产品功能，
提示语还叫人补两格就保存 —— 陌生人存下来的画像是发起人的画像，之后的打招呼话术、
AI 分析、简历生成全部以他的身份输出。这与仓库公不公开无关，线上站点当时就能点到。
现在两端模板（`src/lib/constants.ts` + `miniprogram/utils/constants.js`）一律改成【】占位，
数字字段留 `null`（填数字等于替别人定死期望日薪，而 `Number('【…】')` 还会变成 NaN 入库），
`src/pages/Settings.tsx` 与 `miniprogram/pages/me/me.js` 里硬编码的 GitHub / 作品集链接清空。
断言在 `src/lib/__tests__/profileTemplate.test.mjs`（8 条，4 个变异体全杀，其中「扫描是否空转」
与「骨架断言是否真空」两个手工复核过）。

*剩下的 14 处命中，全部是该留的*（`git grep -o "杨运栋\|吉首大学\|张家界\|Dongnb66\|vibe-portfolio"`）：

| 文件 | 处数 | 为什么留 |
| --- | --- | --- |
| `docs/HANDOFF.md` | 4 | 仓库链接 |
| `README.md` | 3 | 作者与仓库链接 |
| `LICENSE` | 2 | MIT 版权人 |
| `docs/QUICKSTART.md` | 1 | 仓库链接 |
| `src/lib/__tests__/{githubVerify,resume,aiPrompt}.test.ts` | 4 | 测试夹具，不是出厂默认值 |

**产品代码（`src/` + `miniprogram/`，测试夹具除外）命中 0 处**，这条由断言守着。

*密钥扫描*：`crawler/.profile`（浏览器会话 cookie）、`crawler/output`、`.env`、`.git-credentials`
四类**跟踪文件 0 个、历史提交 0 次**（`git log -S` 查过），从没进过 git。全仓唯一像 key 的字符串是
测试夹具假值 `sk-abcdef1234567890wxyz`；`ghp_` / `github_pat_` / `AKIA` / `BEGIN PRIVATE KEY` 命中 0；
手机号模式只命中 `healthCheck.test.ts` 的 `13800000000`。`src/cloud.ts` 与 `db/PASTE-HERE.md` 里的
`publishableKey` / `applicationId` / 线上域名**本来就是 publishable 设计**，已经发给每个打开线上站的
浏览器，不算泄露。

*转公开要接受的两件非密钥暴露*：抓取器对实习僧 / BOSS 的做法变成公开可读；提交节奏
（66 提交 / 8 天）变成公开可见 —— 简历里「2026.09 开源」已经披露了同一件事。

*改历史不建议*：姓名与学校在 git 历史里（`杨运栋` 3 个提交、`吉首大学` 1 个提交），转公开会连历史
一起公开。清理历史要 force push，还会把 `Documents\GitHub` 那份发布源 clone 搞乱，代价远大于收益；
而且这些信息本来就是要公开的（GitHub 主页与简历同源）。

**上面这张表当年漏了一类，别照抄它下"已扫净"的结论。** 当时的扫描口径是「完整邮箱地址（带 `@`）」
与「手机号 `1[3-9]\d{9}`」，而 `4da1190` 抓到的泄露是**发起人邮箱 `@` 前那一段被当示例文案**写进了
`Login.tsx` 的注释 —— 那串既不含 `@`、也不以 1 开头，**两条模式都命中不了**。
现在的守卫是 `profileTemplate.test.mjs` 的 `IDENTITY` 已扩到含该邮箱本地段（拼开写，仓库里不留完整串）。

**转公开前的预检必须做这三件事，缺一不可**：① 跑 `npm test`（含那条全仓身份扫描）；
② 用**扩后的 IDENTITY 列表扫 git 历史**，不只工作树 —— 公开仓库连历史一起公开：
`git log -S"<那串邮箱本地段>" --all --oneline`；③ 逐条到 `docs/sync/INBOX.md` 确认没有 `未证不可引用`
的条目被当成已证用掉了。


## 12. 线上发布（App 发布 / Sites）

线上地址：**https://internship-workbench-47024.app.workbuddy.host/**（以 `http-service` 形式部署，非静态页）。

发布入口：用平台的 App 发布能力，`language: node`、`startCmd: npm run serve`。

> **发布源不是本工作目录，而是 `C:\Users\dong\Documents\GitHub\internship-workbench`。**
> 这条 2026-09-27 实测踩出来的：**应用与目录的绑定由发布记录决定，`deploy` 传 `appId` 改不了目标 ——
> 目录说了算。** 拿本目录（`.zcode\workspace\default\...`）去发，会**新建一个应用并换域名**
> （当时误建出 `wbapp_50AxPC0AsXe0Rerg5kQXZ8` / `-64125`，已下线，那域名现在返回 404）。
> 所以发布前先把本目录的内容推到私有仓，再到 `Documents\GitHub` 那份 clone 里 `git merge --ff-only` 快进过去，
> 然后**从那份目录发**。两份内容可以这样确认一致：两边 `git status` 都 clean + 同一个 HEAD。

### 为什么必须用 `npm run serve` 而不是 `vite preview`

平台注入 `PORT` 环境变量，但 **`vite preview` 只认自己配置文件里的 `preview.port`**，
沙箱里会起在默认 4173 上，导致「服务活着但 3000 无人监听」发布失败。
`scripts/serve.mjs` 在**同一进程内**先 `npm run build`、再调 Vite JS API 起 preview，
把 `host: '0.0.0.0'` / `port: process.env.PORT` / `strictPort` / `allowedHosts` 显式写进
inline config（优先级高于配置文件），从而真正监听 `$PORT`。

其他坑（都踩过）：

- `startCmd` 里写 `--port $PORT` **无效**——沙箱执行时不展开 shell 变量，Vite 报
  `option --port <port> value is missing`；让 Node 脚本自己读 `process.env.PORT` 才行。
- `vite.config.ts` 的 `preview.allowedHosts: true` 不能删，否则反代域名被 Vite 拦成
  `Blocked request. This host is not allowed.`
- 发布目录里**不能有 `miniprogram/`**：它含 `project.config.json` + 带 `pages` 数组的
  `app.json`，会被发布流程识别成小程序项目、走「创建小程序应用」而非 Web 发布。
  发布前临时移出、发完移回（用 `mv` 移动而非复制删除，避免任何内容风险）。

### 发布后核对（照抄即可）

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://internship-workbench-47024.app.workbuddy.host/   # 期望 200
curl -s https://internship-workbench-47024.app.workbuddy.host/ | grep -o "<title>[^<]*</title>"    # 期望「实习管理工作台」
curl -s https://internship-workbench-47024.app.workbuddy.host/ | grep app-version                   # 期望 content="0.8.6"（当前版本）
```

发完**必须**再补两条（等于"两个提交号"）：把线上首屏 bundle 抓下来与本机 `dist/` 比 sha256；
再 grep 一遍 `IDENTITY`（姓名/学校/GitHub 名/邮箱），**必须全 0** —— 见 `docs/sync/INBOX.md` #7/#8/#9。

站点管理入口在平台侧：**设置—数据管理—应用**。
