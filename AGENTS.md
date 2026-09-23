# AGENTS.md · AI 协作规范

本仓库的开发过程由「人定方向 + AI 写代码」协作完成。这份文件约束 AI 在本仓库里能做什么、不能做什么，以及必须遵守的业务口径。
放在仓库根目录，任何 AI 工具（Claude Code / Codex / WorkBuddy / Cursor 等）进入仓库前都应先读它。

## 1. 人的角色与 AI 的角色

| 事项 | 归属 |
| --- | --- |
| 功能优先级、技术选型、架构分层 | 人 |
| 数据模型设计、RLS 策略、字段命名 | 人拍板，AI 实现 |
| 组件与工具函数的具体代码 | AI |
| 文案与话术模板的措辞 | AI 起草，人改成自己的语气后定稿 |
| 是否合并、是否发布、是否推送到远端 | 人 |

判断标准：**任何会写进简历或给 HR 看的内容，最终措辞权在人。** AI 只提供候选，不直接对外发送。

## 2. 硬性约束（违反即视为改坏）

### 2.1 云端数据安全
- 所有表必须开启 RLS，策略为 `owner_id = auth.uid()`，`USING` 与 `WITH CHECK` 都要写。
  - **唯一例外**是 `jobs_public`（岗位广场）：它是公共只读库，只有一条 `FOR SELECT TO authenticated, anon USING (true)` 策略，**不建任何写策略**（RLS 默认拒绝写入）。这张表的定位是「所有人都能读、没有人能写」，不要给它加 `owner_id`，也不要把 `GRANT` 扩到 INSERT/UPDATE/DELETE。
- 前端**任何**写操作都不得传 `owner_id`，让它走列默认值 `auth.uid()`。
- 前端必须把「写操作返回空数组」当作失败处理（`insertRow` / `updateRow` 里已有守卫，不要移除）：
  ```ts
  if (!rows.length) throw new Error('写入被拒绝：请确认已登录且数据归属当前账号')
  ```
- 新增表时必须同步更新三处：`src/lib/api.ts` 的表名、`src/pages/Settings.tsx` 的 `TABLES`（用于数据导出）、本节与 README 的表清单。
  - `TABLES` 的取舍标准是「是不是用户自己的数据」。公共数据（如 `jobs_public`）**不进** `TABLES`。

### 2.1.1 岗位广场（`jobs_public`）与其他表的区别

普通表都是「私有数据 + 按 owner 隔离」，`jobs_public` 是**公共数据 + 只读**。这个区别带来三条必须遵守的纪律：

- **广场只有读**。`src/lib/api.ts` 只提供 `listPublicJobs()`，没有对应写函数 —— 不是还没写，是不该有。
- **「加入岗位池」= 复制快照，不是引用**。用户在广场点加入时，把那一行复制进自己的 `jobs`（来源标 `岗位广场`），此后他的 `status` / `notes` / `match_score` 与广场、与其他用户完全无关。广场刷新也不会改动任何人已在跟踪的记录。
- **「已在池中」判定必须走 `dedupeKey`**（`src/lib/square.ts` 的 `inPool`），与导入查重同源。写成字符串比较会漏掉大小写与「实习/校招」这类后缀差异，症状是广场说没加过、实际池子里已有。

### 2.2 求职话术口径（本项目最敏感的部分）
打招呼与自荐类文案受 `src/lib/constants.ts` 的 `GREETING_RULES` 强制约束，要点：
- **开场身份只写「届数 + 专业 + 姓名」，绝不出现学校名称。**
- 只放大简历中真实存在、可被 `git clone` 验证的能力；没做过的技术一个字不提，也不写「概念通 / 上手快 / 没做过」这类自我设限。
- 技术数字口径必须与简历一致：**5 个项目 / 6 个仓库 / 508 条测试**（146 + 71 + 79 + 48 + 129 + 35），不得出现其它数字。改数字必须同步改简历与所有衍生材料。
- 长度贴住对方问题的强度：对方问一个词，回 2–3 行；只有问技术才展开。
- 用口语，留一处不完美；不照搬简历原句、不引用对方 JD 原文、不三项并列等长。

### 2.3 边界
- 本工作台**不登录**招聘平台、**不自动**发送任何消息、**不抓取**用户的平台会话数据。沟通记录全部由用户手工登记。
- **不做服务端抓取**：不新增常驻后端进程，不在云上放浏览器内核。本地抓取器（`crawler/`）是唯一允许的抓取形态，它跑在用户自己机器上。
- 浏览器扩展只使用 `activeTab` + `scripting` + `storage` 权限，数据不出本机，不请求任何远程接口。
- 任何抓取通道都**只读浏览器已经渲染出来的 DOM**：不调平台接口、不解密参数、不翻页绕风控、不绕登录与验证码。抓取器额外要求：严格串行、每次请求之间强制等待并带随机抖动、单站点页数有上限。
- 不实现验证码识别、不限速批量提交等对抗平台风控的功能。

## 3. 代码约定

- 纯手写 CSS（`src/styles.css`），**不引入 UI 组件库**；图表用原生 SVG / DOM 绘制，不引入图表库。
- 状态用 React 内置 hooks，不引入状态管理库。
- 所有外部数据访问集中在 `src/lib/api.ts`，页面不直接调 SDK。
- 时间统一用 `src/lib/format.ts` 的辅助函数（`todayISO` / `fmtDate` / `fmtDateTime` / `pad`），不在组件里手写日期格式化。
- 纯计算逻辑（打分、节奏判断、会话聚合）必须放 `src/lib/` 下且为纯函数，便于单测。
- 中文文案，标点用中文标点；代码注释只在非显然处写，且用中文。

### 3.1 小程序端（`miniprogram/`）额外约定

- 小程序**不是**网页端代码的编译产物，是同一套云后端上的另一个前端。规则逻辑以网页端为准，`utils/` 下同名模块是移植 —— **改一边必须改另一边**。
- SDK 固定用 `@tencent-ai/workbuddy-cloud-sdk/miniprogram`，endpoint 固定用云服务网关，**不要**改成应用自己的域名，也**不要**手工拼 `/.cloud/**` 请求。
- 数据访问统一走 `miniprogram/utils/api.js`，页面不直接调 SDK。
- 表结构、RLS 策略、字段名与网页端完全一致；小程序只用到 6 张表（`jobs` / `applications` / `messages` / `tasks` / `ai_reports` / `profile`）。
- 改 `app.json` 的 `pages` 时必须同时建好对应的 `.wxml` + `.js`；`tabBar` 的 2–5 项必须都在 `pages` 里。`lazyCodeLoading: "requiredComponents"` 不允许删除。

### 3.2 本地抓取器（`crawler/`）额外约定

- **`extension/collector.js` 是扩展与抓取器共用的唯一提取实现。** 不要在 `crawler/` 里复制第二份提取逻辑：抓取器把它 `addScriptTag` 注入页面后调用 `window.__iwbCollectJobs(options)`。改提取算法等于同时改两条通道，这是刻意的。
- 该文件被注入后必须是**纯读取**：不发网络请求、不翻页。翻页与导航属于 `crawler/run.mjs`。
- `crawler/lib/normalize.mjs` 的 `JOB_TYPES` / `dedupeKey` / `normalizeJobType` 必须与 `src/lib/import.ts` 逐字一致。`crawler/__tests__/contract.test.mjs` 钉住这一点 —— **这组测试红了就是改坏了，不许改测试来让它变绿**。这类错位不报错，只会安静地把数据弄脏（假重复、来源认错、筛选器漏项）。
- 站点表（`crawler/sites.mjs`）的 `channel` 必须落在 `src/lib/constants.ts` 的 `CHANNELS` 里，否则工作台按渠道筛选会漏掉抓进来的岗位。
- 单一公司招聘板（页面里没有「公司」字段）在 `BOARD_COMPANY` 里登记公司名，**必须在去重之前补** —— 去重键含公司名，补晚了会算出一批假的「不重复」。
- **单公司招聘板的公司名是「覆盖」不是「填空」。** 页面里没有公司字段时，卡片内的公司名启发式只能在卡片里挑一个「像公司名」的短行，**必然误判**（实测美团挑出过「更新于2026/08/17」「核心本地商业-基础研发平台」）。站点表已知答案就是事实，要无条件覆盖。`contract.test.mjs` 会检查「所有单公司招聘板都在 `BOARD_COMPANY` 里」和「多公司平台都不在里面」。
- **卡片检测的排序不能只按数量。** 真实反例：美团真卡片 10 个、卡内 JD 段落 20 个，`数量 × 1000` 会让碎片赢。修法是**硬门槛**而非调权重（碎片永远更多，软乘数压不住）：真卡片的父容器是「列表壳」（文本 ≈ 全部卡片拼起来），碎片的父容器就是卡片本身。改动 `findCards` 前先读它函数头的实测注释。排序算术已抽成纯函数 `scoreCardGroup` 并挂到 `window.__iwbScoreCardGroup`，**可单测**。
- `crawler/output/.seen-*.json` 是跨轮次去重历史；改了 `dedupeKey` 算法要意识到旧历史会失配。调试时若怀疑去重掩盖了真相，用 `--purge` 强制全量重出。
- 需要真浏览器的验证**不进 vitest**（CI 上不一定有 Edge / Chrome），单独跑 `cd crawler && npm run selftest`。新增站点适配时，先 `--dump` 存一份渲染快照看清页面结构再改，不要凭猜测写选择器。
- **报「没有可用的浏览器」时先怀疑 `.profile/lockfile`**，不要急着让人去装浏览器。上一次抓取被强杀（超时 / Ctrl+C）会留下 Chromium 的 user-data-dir 锁，三种内核会全部启动失败 —— 症状和「没装浏览器」一模一样，处置却相反。
- 加命令行参数时注意**解析 ≠ 接线**：`parseArgs` 里加字段、`--help` 里加说明，还要真的在调用处用上。`--profile` 曾长期只被解析而从未传给 `launchBrowser`，导致档案目录被占用时无路可绕。
- 调试脚本放 `crawler/tools/`（`show-output.mjs` 看产出字段、`show-dom-tree.mjs` 导 DOM 父子树），**不要散在 `crawler/` 根目录**，也不要让它们进入产品链路。
- **判定站点是否可用，必须逐条看标题，不能数条数。** 本轮真跑踩到三个「数量好看但不是岗位」的坑，三个都曾被误标成 `live`：招行 23 条（首页员工风采轮播 `div.staff-item`）、华泰 4 条（招聘新闻稿）、顺丰 3 条（方向栏目名）。抓到一批数据后，先 `show-output.mjs` 逐条看标题像不像岗位名，再决定标什么。`contract.test.mjs` 里钉了这三个站点，要求它们的 `notes` 写明「抓到的不是岗位」。
- **新增站点后必须补最后一公里验证**：`looksLikeCollectorJson` + `parseCollectorJson` 能不能吃下产出。合并文件手写 JSON 时字段名易错（`jobs` 必须是数组、`channel` 要对上 `CHANNELS`），用工作台自己的解析函数跑一遍比肉眼看可靠。这一步不需要真浏览器，可以写一次性测试跑完即删。
- 需要真浏览器的验证**不进 vitest**（CI 上不一定有 Edge / Chrome），单独跑 `cd crawler && npm run selftest`。新增站点适配时，先 `--dump` 存一份渲染快照看清页面结构再改，不要凭猜测写选择器。
- `crawler/.profile*`（登录态，换目录时会产生 `.profile2` 等）与 `crawler/output`（岗位数据）已在 `.gitignore` 里，不要提交，也不要在日志里打印 cookie 内容。

## 4. 提交与验证

提交前必须全绿：

```bash
npm run typecheck   # tsc -b，零类型错误
npm run test        # Vitest：前端 src/lib + 抓取器 crawler/（不需要浏览器）
npm run lint        # oxlint
npm run build       # 生产构建
```

动了提取逻辑（`extension/collector.js`）或抓取器，**额外**跑一次（需要本机有 Edge / Chrome）：

```bash
cd crawler && npm run selftest   # 真浏览器跑本地夹具，不碰真实站点
```

- 新增纯函数 → 必须补单测。
- 改动 RLS 或数据模型 → 必须在 PR 描述里写清迁移 SQL。
- 不提交 `.env`、密钥、导出的 JSON 备份（已在 `.gitignore` 中）。
- **绝不提交** `crawler/.profile`（含用户登录态）与 `crawler/output`（含岗位数据）。

## 5. 给 AI 的工作方式建议

1. **先读 `docs/architecture.html` 与 `src/lib/`**，再动页面代码，避免重复实现已有工具函数。
2. 改数据模型前先搜索该字段在 `src/` 下的全部引用，一次改完。
3. 涉及话术模板的改动，必须把 `GREETING_RULES` 作为约束读一遍再写。
4. 不确定产品意图时，优先做「用户可以手工确认」的方案，而不是全自动方案。
