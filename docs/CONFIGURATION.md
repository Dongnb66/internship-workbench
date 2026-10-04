#-- 8) 【仅验证用，不作占比】事件侧当场算出的系统（手机识别是否生效；样本只有开过 ?diag=1 的台）
select detail->>'os' as os, count(distinct anon_id) as 台数
from public.usage_events where event = 'diag' group by 1 order by 2 desc;
 CONFIGURATION · 云端与数据库配置

## 1. 前端唯一需要改的地方

`src/cloud.ts`：

```ts
export const publicConfig = {
  endpoint: 'https://<app>.app.workbuddy.host',
  publishableKey: 'wbpk_...',
}
```

`publishableKey` 是可公开的发布级 key（名字里的 publishable 就是这个意思），把它写进前端源码是设计如此。
**数据隔离不靠藏 key，靠数据库 RLS。** 所以「key 泄露」不等于「数据泄露」——别人拿到 key 也只能登自己的账号、看自己的数据。

## 2. 数据表（11 张）

| 表 | 用途 | 归属 |
| --- | --- | --- |
| `jobs` | 岗位池：目标岗位、JD 与匹配度 | 私有（按用户隔离） |
| `jobs_public` | **岗位广场**：公共岗位库，所有人只读 | **公共（只读）** |
| `applications` | 投递记录：阶段流转看板 | 私有 |
| `interviews` | 面试与笔试跟进：日程、问题与复盘 | 私有 |
| `offers` | Offer 对比：待遇与多维评分 | 私有 |
| `resumes` | 简历库：多版本简历与投递使用记录 | 私有 |
| `tasks` | 待办与提醒：截止 / 笔试 / 面试日程 | 私有 |
| `ai_reports` | AI 分析记录：JD 七维评估与打招呼话术 | 私有 |
| `messages` | 沟通流水：招呼语发送、HR 回复、约面与结果 | 私有 |
| `knowledge` | 个人知识库：八股、面经与话术沉淀 | 私有 |
| `profile` | 个人画像与目标条件（每用户一行） | 私有 |

### 2.1 岗位广场为什么是一张单独的表

工作台按用户隔离数据（RLS），所以**新用户打开岗位池必然是空的** —— 空表看不出这个工具的任何价值。参照项目没有这个问题，是因为它的岗位在用户自己机器上（Electron + 本地 PostgreSQL），每个用户打开都要自己跑一次抓取；它之所以没撞上多用户问题，是因为它根本没有多用户。

解法不是放松隔离，而是把「公共数据」和「私有数据」分成两个库：

| | 岗位广场 `jobs_public` | 岗位池 `jobs` |
| --- | --- | --- |
| 谁能读 | 所有人 | 只有自己 |
| 谁能写 | **没有人**（只有服务端灌数据） | 只有自己 |
| 有没有 `owner_id` | 没有 | 有 |
| 有没有私有字段（status/notes/匹配度） | 没有 | 有 |

用户在广场点「加入岗位池」= 把这一行**复制**一份到自己的 `jobs`，快照就是快照：广场后续更新不影响他已在跟踪的记录，同一条岗位被多人加入后各自的进度互不干扰。

**内容怎么进去**：只有服务端。`db/migrations/001_jobs_public.sql` 建表与策略，`db/seed/*.json` 存源数据，`node db/build-seed.mjs` 生成 INSERT 语句，由工作台侧执行。生成器会拒绝「公司名带竖线」这类标签行，避免把脏数据写进公共库。

## 3. RLS 策略（安全模型的核心）

**除 `jobs_public` 外的每张表**都执行了同一套三件套：

```sql
-- 1) 归属列：默认取当前登录用户，前端永不传
ALTER TABLE public.<table>
  ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT auth.uid();

-- 2) 授权
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO authenticated, anon;

-- 3) 策略（PostgreSQL 无 CREATE POLICY IF NOT EXISTS，必须先 DROP 保证幂等）
DROP POLICY IF EXISTS <table>_own ON public.<table>;
CREATE POLICY <table>_own ON public.<table>
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());
```

已上线实例的现状（10 张私有表 × 1 条 `ALL` 策略，`USING` 与 `WITH CHECK` 均为 `owner_id = auth.uid()`）：

```
jobs_own / applications_own / interviews_own / offers_own / resumes_own /
tasks_own / ai_reports_own / messages_own / knowledge_own / profile_own
```

`jobs_public` 走的是另一套（公共只读，没有 owner 概念）：

```sql
ALTER TABLE jobs_public ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.jobs_public TO authenticated, anon;

DROP POLICY IF EXISTS jobs_public_read_all ON jobs_public;
CREATE POLICY jobs_public_read_all ON jobs_public
  FOR SELECT TO authenticated, anon
  USING (true);
-- 刻意不建 INSERT / UPDATE / DELETE 策略：RLS 默认拒绝，
-- 任何客户端写入都会失败（42501）。内容只由服务端灌入。
```

这两道门的区别值得记牢：**`GRANT` 决定这个角色能不能碰这张表，`POLICY` 决定能碰哪些行**。广场只给 `SELECT` 授权，从第一道门就关死了写入 —— 即使有人后来误加了一条宽松的写策略，也仍然写不进去。

### 为什么 `WITH CHECK` 不能省

`USING` 只管「能读到哪些行」，`WITH CHECK` 管「能写成哪些行」。
只写 `USING` 的话，攻击者可以 `INSERT` 一条 `owner_id` 为别人的记录，或把自己已有的行 `UPDATE` 成别人的——`USING` 拦不住写入。

### 前端如何识别「被 RLS 拒绝」

PostgREST 语义下，被策略拒绝的写操作**不报错，返回空数组**。所以前端必须显式判空：

```ts
// src/lib/api.ts
const rows = await cloud.database.from(table).insert(payload).select()
if (!rows.length) throw new Error('写入被拒绝：请确认已登录且数据归属当前账号')
```

这条守卫在 `insertRow` 与 `updateRow` 里都有，**不要为了「让它别报错」而删掉**——它是数据隔离的第一道可见防线。

## 4. 新增一张表的完整步骤

1. 建表，`owner_id TEXT NOT NULL DEFAULT auth.uid()`，加上表注释。
2. 执行上面的三件套 SQL（把 `<table>` 换成表名）。
3. `src/lib/api.ts`：确认表名白名单 / 类型提示已包含新表。
4. `src/pages/Settings.tsx` 的 `TABLES` 数组加上表名（否则数据导出会漏这张表）—— **仅限用户自己的数据**，公共表（如 `jobs_public`）不加。
5. `src/types.ts` 加对应的 `interface Xxx extends Row`。
6. 更新 README 与本文档的表清单。

漏掉第 4 步是最常见的坑：表建了、功能也能用，但用户点「导出全部数据」时新表不在备份里。

**迁移 SQL 放哪**：`db/migrations/`，按序号命名（`001_jobs_public.sql`），文件里逐条列出语句并写清为什么这么设计。云上只有数据库、没有跑迁移的后端进程，这些文件是给人复读和评审用的，不会自动执行。

**种子数据**：`db/seed/*.json` 存源数据（可提交、可 diff），`node db/build-seed.mjs` 转成 INSERT 语句后由工作台侧执行。生成器会挡掉「公司名带竖线」这类标签行 —— 公共库脏了影响所有用户，宁可拒绝导入。

## 5. 节奏配置（profile 表）

投递节奏守则由 `profile` 表三个字段驱动，可在「配置 → 投递节奏守则」页修改：

| 字段 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `daily_greet_limit` | integer | `8` | 每日打招呼上限（条） |
| `greet_window` | text | `'09:00-21:00'` | 允许发送的时间窗，格式 `HH:MM-HH:MM` |
| `min_interval_min` | integer | `30` | 两次发送之间的最小间隔（分钟） |

判断逻辑在 `src/lib/pace.ts` 的 `paceStatus()`，是纯函数，可单测：

```ts
const status = paceStatus(messages, { dailyLimit, window, minIntervalMin })
// { sentToday, limit, remaining, inWindowNow, minutesSinceLast, allowed, reasons }
```

`window` 解析失败（格式不对）时 `parseWindow()` 会回落到默认 09:00–21:00，不会抛错。

## 6. 认证能力边界（写代码前必读）

认证服务**不是**「想接什么就接什么」，可用方法是一张封闭清单：

| 登录方式 | 网页端 | 小程序端 |
| --- | --- | --- |
| 邮箱验证码 | ✅ | ✅ |
| 邮箱 + 密码 | ✅ | ✅ |
| 手机号短信验证码 | ❌ | ✅ |
| 微信登录 | ❌ | ✅ |

上表是**平台能力**。本项目的实际实现：网页端做邮箱验证码 + 邮箱密码；小程序端做手机号短信 + 微信（邮箱通道在小程序里没做，不是做不了）。

三条结论，方向不同但都容易踩错：

- **不要**因为「顺手补齐」就加手机号 tab —— 短信按条计费，且会扩大必须验证的面。
- **不要**在网页端生成手机号路径，**即使使用者明确要求**。上游没给网页端开短信通道，代码能编译但运行时必失败。正确做法是说明边界，并指向小程序端（本仓库的 `miniprogram/` 已经做了）。
- **不要**在小程序端拒绝或含糊对待「手机号登录」——在那里这是完整闭环的普通需求。

**不要在面向用户的文案里暴露某个邮箱是否已注册**（账号枚举）。因此本项目的登录页只有一个「验证码登录 / 注册」入口，密码字段常显且标注为可选，不做「已注册 / 未注册」的分支提示。

认证相关代码的硬性约定：

- 发码（`sendOtp` / `resetPasswordForEmail`）与验码（`verifyOtp`）必须绑定到**两个独立的用户动作**。挑战对象存在事件处理函数之外，只有成功的显式重发才替换它，登录成功才清空。
- 重试一个填错的验证码时**绝不能**再次调用发码方法，否则会重复计费并让旧码失效。
- `verifyOtp` 必须原样回传发码时的 `email`、`verificationId` 和发码返回的 `isExistingUser`，**不要**根据 UI 上选中的标签去猜。
- 不要把邮箱、手机号、令牌写进日志或错误提示。

## 7. 大模型调用

走云服务内置的免密钥 LLM 通道，**不需要在项目里配任何 API Key**：

```ts
const stream = await cloud.llm.chat.completions.create({
  model: pickModel(...),
  messages: [...],
  stream: true,
})
```

模型由 `src/lib/ai.ts` 的 `pickModel()` 按任务挑选（评估类任务用推理更强的模型，话术生成用响应更快的）。
所有 System Prompt 都在 `src/lib/ai.ts` 里，其中打招呼相关的一定要读 `GREETING_RULES`（见 `src/lib/constants.ts`）。

## 8. 小程序端（`miniprogram/`）

独立目录、独立 `package.json`，但**共用网页端那一个云服务环境**（数据库 / 认证 / LLM 全同源）。

```
miniprogram/
├── project.config.json     # miniprogramRoot: "./"、compileType: "miniprogram"
├── app.json                # pages + tabBar(5) + lazyCodeLoading: "requiredComponents"
├── app.js / app.wxss
├── package.json            # 只有 @tencent-ai/workbuddy-cloud-sdk
├── utils/                  # cloud / api / ai / score / pace / constants / format / auth
└── pages/                  # index · jobs · pipeline · ai · me · login · conversation
```

要点：

- **SDK 必须用小程序子路径**：`@tencent-ai/workbuddy-cloud-sdk/miniprogram` 的 `createMiniProgramWorkBuddyCloud`。根入口是小程序里跑不了的。
- 小程序的 endpoint 是**云服务固定网关**，不是本应用自己的域名 —— 微信的 request 合法域名白名单不接受通配符且有条数上限，所以所有小程序共用同一个网关。**不要**改成别的域名，也不要手工拼请求路径。
- npm 依赖装完后，必须在微信开发者工具里执行一次「构建 npm」，否则 `require` 找不到包。
- `lazyCodeLoading: "requiredComponents"` 必须在 `app.json` 顶层（不是在页面 json 或开发者工具设置里）。漏了会在真机上出现白屏。
- `utils/constants.js` 的 `GREETING_RULES`、`utils/score.js`、`utils/pace.js` 是网页端同名模块的移植，**两端口径必须一起改**，否则同一份简历在两端评出两个分数。
- 页面逻辑只通过 `utils/api.js` 访问数据，页面里不直接调 SDK —— 与网页端同一条纪律。

## 9. 本地抓取器（`crawler/`）

独立目录、独立 `package.json`，**不需要任何云端配置**（它不连数据库，只产出 JSON 文件让你导入）。

```
crawler/
├── package.json        # 只有 playwright-core（不下载浏览器内核）
├── run.mjs             # 主 CLI：翻页 + 补 JD + 去重 + 产出
├── login.mjs           # 需要登录的站点，手动登录一次
├── selftest.mjs        # 真浏览器跑本地夹具（需本机有 Edge / Chrome）
├── sites.mjs           # 站点表 + BOARD_COMPANY + 按域名反查
├── lib/browser.mjs     # 浏览器启动（Edge → Chrome → 自带 Chromium 三级回退）
├── lib/normalize.mjs   # 纯逻辑：标题筛选 / 去重 / 断点 / 参数解析
├── __tests__/          # vitest 跑，不需要浏览器
├── .profile/           # 浏览器档案（含登录态，gitignore）
└── output/             # 产出 JSON / TXT + 去重历史 + dump 快照（gitignore）
```

```bash
cd crawler
npm install                                   # 装 playwright-core
npm run sites                                 # 列站点表
npm run crawl -- --site tencent --keyword 前端  # 抓取
npm run selftest                              # 离线自检（真浏览器 + 本地夹具）
```

要点：

- **浏览器来源**：优先驱动系统已装的 Edge（`channel: 'msedge'`），其次 Chrome，最后才是 Playwright 自带 Chromium。所以正常情况下**不需要**跑 `npx playwright install`。
- **登录态只存在 `crawler/.profile`**，是本机一个独立档案目录，与用户日常浏览器互不影响。需要登录的站点跑一次 `npm run login -- --site boss` 即可，脚本不读也不打印任何 cookie 内容。
- **提取逻辑不在这里重复**：抓取器把 `extension/collector.js` 注入页面后调用同一个函数。改提取算法要意识到两条通道同时受影响。
- **口径必须与前端一致**：`lib/normalize.mjs` 的 `JOB_TYPES` / `dedupeKey` / `normalizeJobType` 与 `src/lib/import.ts` 同源，由 `__tests__/contract.test.mjs` 钉住。
- 产出 JSON 的字段名与浏览器扩展的采集结果**逐字一致**（`company / title / city / salary / url / raw`），外加一个 `channel` 字段用于来源标签 —— `src/lib/import.ts#parseCollectorJson` 优先用它，没有才按域名猜。
- 抓不到东西时的排查顺序：`--dump` 存渲染快照看页面结构 → `--wait` 加长渲染等待 → `--headed` 亲眼看 → `npm run login` 确认登录态。

## 10. 环境变量

本项目**没有**必需的环境变量。`npm start` 会读 `$PORT`（不设时用默认端口），仅此一个。

## 有多少人在用（匿名计数 · 2026-10-04 起）

数据全在 usage_users / usage_events 两张表（定义见 db/migrations/005_usage_events.sql；
**匿名端只能 INSERT，没有任何 SELECT 策略**，只有管理端读得到）。

⚠️ **活跃一律从事件表推导，不要用 usage_users.last_seen**：2026-10-04 用 pg_stat_user_tables 判出
那条匿名 UPDATE 从来没成功过（n_tup_ins=31 / n_live_tup=10 ⇒ 21 次撞主键，而 n_tup_upd=1 且是管理员手工改的），
前端统计又刻意静默 ⇒ 症状是「界面正常、活跃永远停在首访那天」。现已删掉 UPDATE 通道（迁移 006），
所以 last_seen 只等于 first_seen，别拿它当活跃。

```sql
-- 1) 人数：首次访问过的浏览器（一台浏览器一行）
select count(*) as 总人数 from public.usage_users;

-- 2) 活跃：按事件算（去重到「台」）
select count(distinct anon_id) filter (where received_at > now() - interval '1 day')  as 近24小时活跃,
       count(distinct anon_id) filter (where received_at > now() - interval '7 days') as 近7天活跃
from public.usage_events;

-- 3) 漏斗五格（人数与次数都给）
select event, count(distinct anon_id) as 人数, count(*) as 次数
from public.usage_events group by event order by 人数 desc;

-- 4) 已连过助手的台数（约等于「装过并跑起来」）
select count(distinct anon_id) as 已连过助手 from public.usage_events where event = 'agent_connected';

-- 5) 按系统分布
select os, count(*) as 台数 from public.usage_users group by os order by 台数 desc;

-- 7) 真实使用者：至少产生过一个交互事件（免疫发布预热门/探针 —— 它们只会 app_open）
select count(distinct anon_id) as 有交互的台数
from public.usage_events where event <> 'app_open';
-- 6) 最近 30 天每日打开（看抖音/帖子带来的波峰）
select received_at::date as 日期, count(distinct anon_id) as 人数
from public.usage_events where event = 'app_open' group by 1 order by 1 desc limit 30;
```

**口径提醒（写简历前必读）**：是「N 台浏览器」不是「N 个用户」（匿名 id 本机随机，清缓存/换设备会重算）；
**隐私边界**：只存事件名 + 时间 + 版本 + 匿名 id，不存岗位/简历/投递内容；GPC 或用户关掉开关 ⇒ 一个事件都不发。
