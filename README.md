# 实习管理工作台 · Internship Workbench

[![CI](https://github.com/Dongnb66/internship-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/Dongnb66/internship-workbench/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-f2542d.svg)](./LICENSE)
[![React](https://img.shields.io/badge/React-19-3b82f6.svg)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6.svg)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8-8b5cf6.svg)](https://vite.dev)
[![Tests](https://img.shields.io/badge/tests-192%20passed-12a150.svg)](./src/lib/__tests__)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-f59e0b.svg)](../../pulls)

一个面向在校生的实习 / 校招求职工作台：**岗位池 → 投递看板 → 沟通台账 → 面试跟进 → Offer 对比**，全流程一条线管到底。

**线上地址：<https://internship-workbench-47024.app.workbuddy.host/>**

Web 端（React + TypeScript + Vite）+ 微信小程序端（原生，共用同一套云后端）+ 云服务后端（数据库 / 认证 / 大模型），外加一个 Chrome 扩展做岗位采集与网申表单自动填充。
完整架构图见 [`docs/architecture.html`](docs/architecture.html)。

> 参考产品形态：Offerbiu（投递管理工作台）、ai-job-search-cn（JD 七维评估）、本地「秋招工作台」（岗位池 + 投递记录看板）、Offertong（网申一键填表）。

## 它解决什么问题

求职信息散在 BOSS、实习僧、邮箱、备忘录、Excel 里，导致三件事做不好：**该投的没投、投了的没跟进、聊过的忘了聊到哪。**
这个工作台不替你做决策，只保证每一条线索都不会因为流程混乱而丢掉。

## 功能

| 模块 | 说明 |
| --- | --- |
| 总览 | 五个核心指标；**今日投递节奏**（已发 / 上限 / 时间窗 / 冷却）；**超期未回复**（≥7 天）集中提醒；近 14 天投递节奏与阶段分布 |
| 岗位广场 | **公共岗位库**：所有人共享、只读，关键字 / 城市 / 类型筛选，可只看「未加入」；点「加入岗位池」把岗位**复制**一份到你的池子（支持批量），已加入的标出「已在池中」并禁止重复加入 |
| 岗位池 | 录入 JD、公司、城市、类型、截止日期；**批量导入**（整段粘贴 → 本地拆分 / AI 结构化 / 采集数据直读三种入口，核对后才入库；也可**直接选本地抓取器产出的文件**）；按画像自动算匹配度；**批量 AI 评分**（本地预筛 → AI 七维深评，串行可中断、失败可重试） |
| 投递看板 | 已投递 / 笔试 / 面试 / Offer / 已挂 五列看板，**支持拖拽改阶段**；可切表格视图；超期卡片标红 |
| 沟通台账 | 每个投递一条会话时间线；6 个快捷记录（已发招呼 / 已读 / HR 回复 / 约面 / 婉拒 / 超时未回）；**登记前强制过 6 条自检清单**，记录后自动推进阶段与下一步 |
| 面试跟进 | 笔试 / 面试日程与轮次、结果标记、问到的问题与复盘；AI 押题 + AI 整理结构化复盘 |
| Offer 对比 | 日薪 / 月薪 / 补贴 / 时长，七维评分（技能、经验、成长、薪资、强度、稳定性、通勤）排序与逐项对比 |
| 简历库 | 多版本简历登记、方向、目标岗位、亮点摘要；统计每个版本被投递使用次数 |
| 网申填写包 | 网申常见字段一键复制、一键复制全部、导出 `applykit.json` 给浏览器插件；AI 生成期望薪资 / 实习时长 / 为什么选择我们 等开放题 |
| AI · JD 评估 | 粘贴 JD → 匹配度、一句话结论、七维打分、亮点、缺口、可直接发送的打招呼话术；历史留档可复用 |
| 提醒日历 | 月视图 + 未来事项，汇总岗位截止、面试笔试、投递跟进与自建待办 |
| 个人知识库 | 八股、面经、项目、打招呼话术、公司情报沉淀，可搜索与分类 |
| 目标条件 | 个人画像（专业 / 届数 / 技能 / 项目数字口径 / 可实习时长）+ **投递节奏守则配置** + 账号与数据导出 |

## 几个有意的设计选择

**AI 只做辅助，发送键始终由人按。**
不登录招聘平台、不自动投递、不自动发消息、不抓取平台会话。理由是平台风控收益极低、风险极高，且这类动作的收尾责任在人身上。所以自动化停在「帮你把话术写好、把表填好、把该跟进的挑出来」。

**岗位获取停在「你自己看得见的那一屏」。**
岗位池默认是空的，它不会自己长出数据 —— 这是刻意的。平台化的岗位库背后是常驻服务端 + 浏览器内核在跑爬虫，而本项目只有云上的静态站点 + 云数据库，**没有常驻进程，服务端抓取在架构上没有落点**；就算有，绕过反爬去批量抓取，风控后果（限流、封号、验证码升级）全部落在使用者的账号上，收益却是别人的。

但「每个新用户打开都是空岗位池」本身是个产品硬伤 —— 空表看不出这个工具的任何价值。所以拆了一对概念：**岗位广场**（公共岗位库，所有人都能读、没有人能写）与**岗位池**（私有，按账号隔离）。在广场点「加入岗位池」会把那一条复制进你自己的池子，之后的匹配度、备注、投递状态都只属于你。

广场的内容由工作台侧灌入（真人跑一次抓取 → 清洗 → 入库），不是每个用户自己抓；它也不会自己更新，新鲜度取决于最后一次灌入时间。

所以这里给四条路，它们的区别只是「谁来点」，不是「读什么」—— 读的都是浏览器**已经渲染出来的 DOM**，都不调平台接口、不绕过登录 / 验证码：

| 通道 | 自动化程度 | 跑在哪 |
| --- | --- | --- |
| **岗位广场** | 点一下「加入」，零成本 | 公共库（服务端灌入） |
| **整段粘贴 → 结构化** | 全手动 | —（连扩展都不用装） |
| **浏览器助手** | 手动点一次，读完当前这一屏 | 你的浏览器，权限仅 `activeTab`，不发网络请求 |
| **本地抓取器 `crawler/`** | 自己翻页 + 逐个补 JD，可断点续跑 | **你自己的机器**（驱动你已装的 Edge / Chrome，用你的网络出口与登录态） |

本地抓取器是参照「爬虫必须跑在用户自己机器上才勉强可控」这个前提做的；服务端那一半我没有做，也不打算做。

**打招呼话术带硬约束。**
`src/lib/constants.ts` 的 `GREETING_RULES` 约束模型输出：开场只写「届数 + 专业 + 姓名」不出现校名；只放大可信仓库能验证的能力，没做过的技术一个字不提；技术数字口径必须与简历一致；长度贴住对方问题的强度。另外，登记「已发打招呼」前必须勾满 6 条自检清单——那是投递纪律的可执行版本。

**两段式评分流水线。**
本地关键词 + 画像规则先打预筛分（秒出、零成本），通过阈值 45 的才送 AI 七维深评。批量评分故意串行：并发容易触发限流，且失败后难以定位；串行 + 实时进度 + 可中断 + 失败单独重试更实用。

**业务逻辑与 React 解耦。**
打分、节奏判断、会话聚合全部是 `src/lib/` 下的纯函数（`now` 可注入），因此可以脱离浏览器单测。详见 [`src/lib/__tests__`](src/lib/__tests__)。

## 技术栈

- **前端**：React 19 + TypeScript 6 + Vite 8（网页端）；原生 WXML / WXSS / JS（小程序端）。纯手写 CSS（无 UI 库）、原生 SVG / DOM 绘图（无图表库）、React 内置 hooks（无状态管理库）
- **后端**：WorkBuddy 云服务 —— PostgREST 风格数据库 + 认证（网页端邮箱验证码 / 邮箱密码，小程序端手机号短信 + 微信登录）+ 免密钥大模型调用，无自建服务器
- **数据安全**：11 张表中 10 张私有表开启 RLS，`owner_id TEXT NOT NULL DEFAULT auth.uid()` + `WITH CHECK`；前端永不传 `owner_id`；写操作返回空数组即判为被拒绝并抛错。第 11 张是岗位广场 `jobs_public`，走「公共只读」模式：只给 `SELECT` 授权 + 一条 `USING (true)` 读策略，**不建任何写策略**（RLS 默认拒绝）
- **浏览器扩展**：Chrome MV3，仅 `activeTab` + `scripting` + `storage`，数据不出本机
- **本地抓取器**：Node + `playwright-core`，驱动系统已装的 Edge / Chrome（**不下载自带内核**）；提取逻辑与扩展共用 `extension/collector.js`，不写第二份
- **质量**：Vitest 单测（前端 + 抓取器纯逻辑，含跨端**契约测试**）+ oxlint + `tsc -b` + GitHub Actions CI；需真浏览器的那部分单独跑 `cd crawler && npm run selftest`（本地夹具，不碰真实站点）

## 数据模型（11 张表）

**私有（按账号隔离，10 张）**：`jobs` · `applications` · `messages` · `interviews` · `offers` · `resumes` · `tasks` · `ai_reports` · `knowledge` · `profile`

**公共（所有人只读，1 张）**：`jobs_public` —— 岗位广场。没有 `owner_id`，没有 `status` / `notes` / 匹配度这些私有字段，内容只由服务端灌入。

网页端用全部 11 张表；小程序端用其中 6 张（`jobs` · `applications` · `messages` · `tasks` · `ai_reports` · `profile`）—— 面试日程、Offer 对比、简历库、知识库留在桌面端做，手机端只承载高频的「记一笔 / 看一眼」。岗位广场是新增的独立页面，需登录后自桌面端进入。

字段清单与 RLS 策略见 [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)。

## 本地开发

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # 类型检查 + 生产构建
npm start            # 构建 + 预览（监听 $PORT，绑定 0.0.0.0）
npm test             # Vitest：前端 src/lib + 抓取器 crawler/（不需要浏览器）
```

另有三个子包各自独立安装，主包跑测试**不需要**它们：`miniprogram/`（小程序）、`extension/`（扩展，免安装直接加载）、`crawler/`（本地抓取器，需要 `playwright-core`）。

> 账号体系：**验证码登录即注册**（填邮箱收码，首次使用自动创建账号），也支持邮箱密码登录与找回密码。手机号 / 短信与微信登录在网页端拿不到——这是认证服务的平台边界而非本项目缺失。
>
> 邮箱验证码登录 / 注册仅在应用的正式发布域上可用（服务端做 Origin 校验），本地预览只能看到登录页。

## 微信小程序端

同一套云后端、同一批表、同一个账号体系，手机端只换了前端。存在的意义不是「再做一个端」，而是**补上网页端拿不到的两条登录通道**：

| 登录方式 | 网页端 | 小程序端 |
| --- | --- | --- |
| 邮箱验证码（登录即注册） | ✅ | — |
| 邮箱密码 / 找回密码 | ✅ | — |
| 手机号短信验证码 | ❌ 上游未开放 | ✅ |
| 微信一键登录 | ❌ 上游未开放 | ✅ |

（小程序端还能通过邮箱通道登录，但这里没做——手机端的目标用户手上就有微信和手机号，多一条入口只是多一屏。）

```bash
cd miniprogram
npm install          # 装云服务 SDK
# 用微信开发者工具打开 miniprogram/ 目录 → 工具 → 构建 npm → 编译
```

- `app.json` 已开启 `lazyCodeLoading: "requiredComponents"`；`project.config.json` 的 `miniprogramRoot` 指向本目录。
- 7 个页面：总览 / 岗位池 / 投递 / AI 评估 / 我的（tabBar 五项）+ 登录 + 会话详情。
- **规则逻辑与网页端同源**：本地打分（`utils/score.js`）、投递节奏守则（`utils/pace.js`）、6 条打招呼纪律（`utils/constants.js`）都是同一份口径的移植，不是另写一套。
- 小程序的网络出口是云服务固定网关（微信的 request 白名单不接受通配符且有条数上限，所有小程序共用），因此配置里没有本应用自己的域名。

## Chrome 扩展（岗位采集 + 网申自动填表）

见 [`extension/README.md`](extension/README.md)：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选 `extension/` 目录。

- **采集岗位**：在招聘结果页点「采集本页岗位」→ 自动复制 → 工作台「岗位池 → 批量导入」粘贴 → 入库。只读当前已渲染的 DOM，权限仅 `activeTab` + `scripting` + `storage`，不发网络请求。
- **网申填表**：导入工作台导出的 `applykit.json` → 一键填充。

提取逻辑用本地模拟页面验证，可复跑：见 [`extension/__fixtures__/README.md`](extension/__fixtures__/README.md)。

## 本地抓取器（`crawler/`）

跑在你自己机器上的批量岗位抓取：驱动你已装的 Edge / Chrome，按站点表逐个打开招聘页，翻页读完列表，再逐个打开岗位详情页补全 JD，产出一份可以直接导入的 JSON。

```bash
cd crawler
npm install                                  # 只装 playwright-core，不下载浏览器
npm run sites                                # 看内置站点表（27 个）
npm run crawl -- --site tencent --keyword 前端   # 抓腾讯的「前端」
npm run selftest                             # 用真浏览器跑本地夹具自检
```

产出在 `crawler/output/<站点>-<时间>.json`，在工作台「岗位池 → 批量导入 → 选择抓取结果文件」里选它即可。

- **提取算法与浏览器扩展共用** `extension/collector.js` 一份实现，所以两条通道读出来的字段一致，不会一边准一边不准。
- 抓取器比扩展多做的：翻页（下一页 / 加载更多 / 滚动 / URL 页码）、逐个补 JD、标题筛选（`--mode all|intern|campus`）、跨轮次去重 + 断点续跑。
- **站点表 27 条**，覆盖腾讯 / 字节 / 华为 / 阿里 / 百度 / 美团 / 京东 / 网易 / 小米 / 快手 / 米哈游 / 科大讯飞 / 比亚迪 / 中兴 / 拼多多 / 华泰 / 招行 / 海康 / 顺丰 / 联想 等公司官方招聘门户，以及 BOSS / 实习僧 / 牛客 / Moka / 飞书 / 北森等平台。各站点的真跑验证状态在 `crawler/README.md` 里逐条标注（只有真跑通过的才写 `live`）。
- **边界没变**：只读浏览器渲染出来的 DOM，不调平台接口、不解密参数、不绕验证码；严格串行 + 请求间隔带随机抖动；需要登录的站点（如 BOSS）由你自己 `node login.mjs` 登录一次，脚本只复用那个会话，全程不读写、不上传任何 cookie 内容。
- 详细用法、站点验证状态与已知限制见 [`crawler/README.md`](crawler/README.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/QUICKSTART.md`](docs/QUICKSTART.md) | 5 分钟跑起来 + 第一次使用建议顺序 |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | 云端配置、RLS 策略 SQL、新增表的完整步骤、节奏配置字段 |
| [`docs/FAQ.md`](docs/FAQ.md) | 设计取舍问答：为什么不做自动投递、为什么不用 UI 库、匹配度怎么算 |
| [`docs/architecture.html`](docs/architecture.html) | 手绘架构图（单文件，随代码版本管理） |
| [`AGENTS.md`](AGENTS.md) | AI 协作规范：人的职责边界、硬性约束、代码约定、提交前验证 |
| [`crawler/README.md`](crawler/README.md) | 本地抓取器：用法、站点验证状态、已知限制 |
| [`CHANGELOG.md`](CHANGELOG.md) | 版本变更记录 |

## 说明

求职辅助工具。AI 结论仅基于用户录入的 JD 与画像生成，**不构成任何录用承诺或结果保证**；投递动作由用户本人执行。
数据存于用户登录的云服务实例，按账号隔离，仅本人可见，可随时导出完整 JSON 备份。

MIT License © 2026 杨运栋
