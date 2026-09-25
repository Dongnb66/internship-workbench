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
| 远程仓库 | **`git@github.com:Dongnb66/internship-workbench.git`（私有，已推送）** |
| 分支 | `master`，跟踪 `origin/master`，工作树干净 |
| 规模 | 191 个已跟踪文件 / 1.2 MB / 21 个测试文件 / 348 条断言（全绿） |

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
| `src/lib/ai.ts` | **唯一的模型调用入口** `streamChat` + prompt 组装 | 所有外部文本必须经 `wrapUntrusted` 或 `build*UserMessage`（有推导式断言守着） |
| `src/lib/untrusted.ts` | 外部文本隔离（边界 + 声明 + 中和伪造边界） | 中和那一步有回归断言，别删 |
| `src/lib/blockers.ts` | 硬门槛检测（届数/学历/证书/年限/院校/地点） | 三条约束见文件头；**不得编码个人短板事实** |
| `src/lib/import.ts` | 采集数据 → 岗位草稿（`parseCollectorJson`） | 与 `crawler/`、`extension/` 共享 JSON 契约，改字段要同步三处 |
| `src/lib/constants.ts` | 字段清单的**唯一事实源**（填写包、渠道、岗位类型…） | `APPLY_KIT_FIELDS` 有三个消费者，别在别处再抄一份 |
| `src/lib/score.ts` | 本地关键词预筛 + 硬门槛拦截 | 批量 AI 评分靠它省额度，顺序不能反 |
| `src/pages/*.tsx` | 页面 | `ApplyKit.tsx` 的取值映射类型是 `Record<ApplyKitLabel, string>`，加字段会编译报错 |
| `extension/` | Chrome MV3 扩展：岗位采集 + 网申一键填表 | 与填写包字段清单有契约测试（`extension/__tests__/contract.test.mjs`） |
| `crawler/` | 本地抓取器（DOM 翻页）+ `sources/offerbiu.mjs`（API 源） | 两条通道**产出同一套 JSON 契约**，字段名必须逐字一致 |
| `gateway/server.mjs` | 本地网关（`npm run gateway`） | 与部署无关，别当成后端 |
| `db/` | 迁移 SQL + `db/exec/` 可粘贴执行的拆分脚本 | schema 工具当前不可用，新增表要手工执行并同步文档 |
| `miniprogram/` | 微信小程序端 | **发布时要先移出目录**，见第 6 节 |

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
   并把测试数变化写进提交信息（当前基线 **348**）。
6. **提交信息写「为什么」**，不写「改了什么」。历次提交都遵循这个风格，可以 `git log` 看。

## 5. 当前状态快照（2026-09-25）

- 测试：**21 个文件 / 348 条断言全绿**；`tsc -b`、`oxlint`（0 error）、`vite build` 均通过。
- 最近 5 个提交（倒序）：OfferBiu 接入 → 推导式覆盖率 → 填写包字段契约 → 对标吸收三项 → 计费口径。
- 线上站已发布过 13 次，最近一次与 `ba5c7c7` 对应。
- 已知缺口与优先级在 `docs/BENCHMARK.md` 第二节（P0：渠道能力边界表、漏斗转化统计、跟进节奏）。

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
- **不要为了交接而把仓库推成公开仓库**：`src/lib/constants.ts` 的 `PROFILE_TEMPLATE` 内含真实姓名与学校
  （它是「一键填入已知事实」的模板，服务于使用者本人的网申表单，不是示例数据）。
  本项目**目前没有远端**；要交接建议用**私有仓库或直接给本机路径**。
  若确实要公开，必须先决定 `PROFILE_TEMPLATE` 里的个人信息怎么处理。

## 10. 接手后的第一件事建议

按顺序做，别跳：

1. `npm install && npm run typecheck && npm test` —— 确认基线是 348 全绿（不是就先查环境）。
2. `git log --oneline -15` 读提交信息，理解近期决策的「为什么」。
3. 读 `AGENTS.md` 的硬约束 + 本文件第 3 节的不变量。
4. 从 `docs/BENCHMARK.md` 第二节挑一个 P0 缺口开工，并在动手前先写会变红的断言。

## 11. 私有仓库的访问方式（接手方必读）

仓库地址：`git@github.com:Dongnb66/internship-workbench.git`（私有）。

```bash
git clone git@github.com:Dongnb66/internship-workbench.git
cd internship-workbench && npm install && npm run typecheck && npm test   # 基线 348 全绿
```

**私有仓意味着接手方必须先能认证**，两条路：

| 接手方运行位置 | 需要什么 |
| --- | --- |
| 本机（同一台 Windows） | 直接用现有 SSH key（`~/.ssh/id_ed25519` 已加到 GitHub 账号），无需额外配置 |
| 其他机器 / 云端 | 需要单独授权：把该环境的 SSH 公钥加成**仓库 Deploy Key**（只读即可），或在 GitHub 网页把它加成 Collaborator |

**首次推送的完整经过（记下来，避免重复踩）**：
1. AI 侧**建不了仓**——GitHub 集成对 `POST /user/repos` 返回 403（`Resource not accessible by integration`）。
2. AI 侧**走 HTTPS 推不了**——报 `could not read Username`（本机 git 只有 WorkBuddy 的
   `helper-selector`，不外露用户凭据）。**必须用 SSH remote。**
3. GitHub Desktop 的 `Publish branch` 也失败了，原因是 **Desktop 自己没登录 GitHub 账号**
   （`File → Options → Accounts` 登录可修）。它失败在建仓那一步之前，所以没有留下半成品仓库。
4. 最终路径：**人在网页建一个空私有仓**（不勾 README/.gitignore/license）→ AI 用 SSH 推送成功。

推送后核对过四项：远端 `master` = 本地 HEAD、远端 190 个文件、分支跟踪已建立、
**未登录访问 `github.com/Dongnb66/internship-workbench` 与 API 均返回 404**（确认私有）。


**仓库里确实存在个人信息的 3 类**（私有仓可接受，转公开前必须处理）：

| 内容 | 处数 | 位置 |
| --- | --- | --- |
| 真实姓名 | 9 | `src/lib/constants.ts`（`PROFILE_TEMPLATE`）、测试夹具、小程序端 `miniprogram/` |
| 学校名 | 1 | `src/lib/constants.ts` 的 `PROFILE_TEMPLATE` —— **转公开前必须先改成占位符** |
| GitHub 用户名 | 8 | `README.md`、`LICENSE`、`docs/QUICKSTART.md`、`src/pages/*` |

（QQ 邮箱扫描为 0 处。）


## 12. 线上发布（App 发布 / Sites）

线上地址：**https://internship-workbench-47024.app.workbuddy.host/**（以 `http-service` 形式部署，非静态页）。

发布入口：用平台的 App 发布能力，`directory` 指向本目录、`language: node`、`startCmd: npm run serve`。

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
```

站点管理入口在平台侧：**设置—数据管理—应用**。
