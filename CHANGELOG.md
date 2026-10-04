# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed

- **⚠️ 手机访客的抓取卡片折叠成一句话 + 可展开**（`src/pages/Crawler.tsx`；`b46e842`，DSH 真机发现）。**为什么**：0.8.31 已经能正确认出手机、说出「本地助手是电脑上的程序」，但**下面那一整块照旧摆着** —— 安装三步、「连不上本地助手」、「开始抓取」按钮在手机上全都没有意义，**看着像坏掉了**。现在 `os === 'mobile'` 时只显示一句「**手机上看不了本地助手** —— 它是电脑上的程序」+ 一个「**点这里看你能做什么**」的 `<details>` 折叠（展开才是四条替代路径）；**安装三步 / 「连不上本地助手」整块 / 「开始抓取」按钮对手机全部隐藏**。**桌面端不受影响**：Windows 照旧安装三步 + 下载入口；mac/linux 照旧「你现在的系统是 macOS/Linux」+ 四条路径（**不折叠**）。
  **本机已核**：三处隐藏的条件都是 `os !== 'mobile'`（`Crawler.tsx:431` 与 `:540`），配合已验过的 `hostOs(iPhone)=mobile` ⇒ 条件链成立；**真机渲染由 DSH 用 iPhone-14 模拟直接验并截图**。
- 四件套（本机实跑）：typecheck exit 0 / **72 files 893 tests** 全绿 / lint 0 error（**25 warnings**，**201 files**）/ build exit 0（主 bundle **`index-issZZ8HG.js`**，623766 字节，sha256 `457ca64fb89e8c4ee4193391b47bffc3d74edcb401a4e43c4cda3cff4e0454c3`）。**判别器**：产物**含 `0.8.32`**、**不含 `0.8.31` / `0.8.30`**、全部 `0.8.x` 字面量只有 `['0.8.32']`；新文案「手机上看不了本地助手」✅「点这里看你能做什么」✅；前几批标记（手机/macOS 引导、首选、桥接、未保存、SmartScreen 提示）一个没丢 ✅。⚠️ **本批不换助手包**，线上继续 r7（`5e9840ba…` / `0f42913a…`，已用 `verifyPublish --sha256` 全量复核未变）。

### Fixed

- **⚠️ 埋点把每一批都报成上一版 —— 同页面两套版本号，其中一套是假的**（`scripts/appVersionPlugin.mjs` + `src/lib/usageEnv.ts`；`ac0cc3d`）。**现象**：0.8.29 上线后，库里每条记录的 `app_version` 都是 `0.8.28`；而 `index.html` 的 `app-version` meta 一直是 `0.8.29`（它构建时从 `package.json` 注入）。**根因**：`usageEnv.ts` 里把版本号写成了**字面量**（生成那个文件时从 `package.json` 读了一次就固化了），升版本时不会跟着变。**为什么它特别危险**：**构建不报错、判别器 sha256 也对、逐字节核验全过** ⇒ 四件套与整套发布纪律**都发现不了它**；危害是「按版本聚合人数」永久失真。**这正是项目自己早写过的那句** ——「写死的标记在升级后会变成假话，而假话比没标记更坏」。**修法**：`appVersionPlugin` 增加 `config() → define.__APP_VERSION__`（构建期注入，单一真相源仍是 `package.json`），`usageEnv.ts` 改读它 + `typeof` 兜底（vitest 直跑源码时给 `'dev'`，不知道就说不知道）。**防复发**：新增 `src/lib/__tests__/versionHygiene.test.mjs` 扫 `src/` 与 `scripts/`，禁止「给版本语义的常量赋值字面量」这种写法；判据刻意收窄，注释里的历史版本叙述与 `127.0.0.1` 这类 IP 都不会被误伤。**本批已验收**：产物里唯一的版本字面量是 `0.8.30`，**不含 `0.8.29`、也不含 `0.8.28`**。
- **⚠️ `agent_installed` 对「后来才装上助手」的老用户永远是 false**（`src/lib/usage.ts`；`98888c8`，我查出的）。**现象**：`touchUser(agentInstalled)` 里 `agent_installed` **只写在 INSERT 那条**（首次插入），而 UPDATE 那条只带 `{ last_seen, app_version }` ⇒ **一个已存在的用户后来连上助手，这个字段永远刷不到 true**。影响的是「有多少人真的把助手跑起来了」这个指标 —— 而它恒为 false，看起来像「没人装成功」。**修法**：抽出纯函数 `userPatch(now, agentInstalled)`，`=== true` 才带上该字段，**`undefined` 就不写**（不把「不知道」写成 false），3 条断言。
- **⚠️ `last_seen` 静默停住 —— PostgREST 的 `UPDATE … eq(anon_id)` 命中 0 行也回 204**（`src/lib/usage.ts`；`98888c8`）。**为什么难查**：命中 0 行是**成功的无操作**，不报错；而前端统计**刻意静默**（吞掉所有错误）⇒ 症状是「人数照常 +1（INSERT 不受影响）但活跃/留存永远停在首见那天」，**且没有任何报错**。**修法**：更新时带 `.select('anon_id')`（正好是列级授权给的那一列，`98888c8` 与权限收紧那笔配套）看命中行数，**0 行就补插一次** ⇒ 做成自愈，而不只是解释。
- **⚠️ 手机访客被误报成 macOS —— 抖音点进来的人大多在手机上**（`src/lib/crawlTask.ts#hostOs` + `nonWindowsGuide`；`9864e23`，DSH 用 iPhone-14 模拟整机发现）。**现象**：iPhone/iPad 的 UA 里**含 `Mac OS X`**（`'CPU iPhone OS … like Mac OS X'`），而 `hostOs` 原来把 Mac 判在手机之前 ⇒ 手机访客看到「**你现在的系统是 macOS**」，而这句话在 0.8.30 上是**实测可见的**。**修法**：**手机/平板先判**（`iPhone|iPad|iPod|Android|Mobile`），并**按系统换说法** —— 手机：「**本地助手是电脑上的程序，手机上装不了**」；mac/linux：「本地助手目前只有 Windows 版，这台机器上装不了」，4 条断言。**本机已用 6 个真实 UA 复核**：iPhone 14（含 `Mac OS X`）→ `mobile` ✅、iPad → `mobile` ✅、Android → `mobile` ✅、macOS 桌面 → `mac` ✅、Windows → `win`（不给引导）✅、Linux → `linux` ✅。
- 四件套（本机实跑）：typecheck exit 0 / **72 files 893 tests** 全绿 / lint 0 error（**25 warnings**，**201 files**）/ build exit 0（主 bundle **`index-BaRIGa4d.js`**，623398 字节，sha256 `c3479802425a708ce504a2c05def04a74477900d7a8bde8f2dc3069c99113918`）。**判别器（本批）**：产物**含 `0.8.31`**、**不含 `0.8.30` / `0.8.29`**、全部 `0.8.x` 字面量只有 `['0.8.31']`；新文案「本地助手是电脑上的程序，手机上装不了」在产物里 ✅。⚠️ 注意「本地助手是电脑上的程序」是 `why` 的**手机分支**，**运行时才按 UA 选**（桌面 UA 走「只有 Windows 版」那句）—— 产物里两个分支都在。⚠️ **本批不换助手包**，线上继续 r7（`5e9840ba…` / `0f42913a…`，已用 `verifyPublish --sha256` 全量复核未变）。
- **记账说明**：`b435a2f`（假「未保存」修复，站点按集合比较）与 `0fdb97a`（其测试断言修正）**已随 0.8.30 上线** —— 0.8.30 发布会自己 build 那一版的源码，所以这两笔在 0.8.30 就生效了，**本批不重复记账**。

### Changed

- **判别器换方式**（`scripts/appVersionPlugin.mjs` + `src/lib/usageEnv.ts`；`ac0cc3d`）。**现象**：0.8.29 上线后，库里每条记录的 `app_version` 都是 `0.8.28`；而 `index.html` 的 `app-version` meta 一直是 `0.8.29`（它构建时从 `package.json` 注入）。**根因**：`usageEnv.ts` 里把版本号写成了**字面量**（生成那个文件时从 `package.json` 读了一次就固化了），升版本时不会跟着变。**为什么它特别危险**：**构建不报错、判别器 sha256 也对、逐字节核验全过** ⇒ 四件套与整套发布纪律**都发现不了它**；危害是「按版本聚合人数」永久失真。**这正是项目自己早写过的那句** ——「写死的标记在升级后会变成假话，而假话比没标记更坏」。**修法**：`appVersionPlugin` 增加 `config() → define.__APP_VERSION__`（构建期注入，单一真相源仍是 `package.json`），`usageEnv.ts` 改读它 + `typeof` 兜底（vitest 直跑源码时给 `'dev'`，不知道就说不知道）。**防复发**：新增 `src/lib/__tests__/versionHygiene.test.mjs` 扫 `src/` 与 `scripts/`，禁止「给版本语义的常量赋值字面量」这种写法；判据刻意收窄，注释里的历史版本叙述与 `127.0.0.1` 这类 IP 都不会被误伤。**本批已验收**：产物里唯一的版本字面量是 `0.8.30`，**不含 `0.8.29`、也不含 `0.8.28`**。
- **权限收紧：匿名端只能写、不能整表读**（`db/migrations/005_usage_events.sql` 追加两句；已执行）。`REVOKE SELECT ON public.usage_users, public.usage_events FROM anon, authenticated;` + `GRANT SELECT (anon_id) ON public.usage_users TO anon, authenticated;`。**为什么不能只做全表 REVOKE**（这是我上一轮建议的漏洞，DSH 指出）：`UPDATE … WHERE anon_id = $1` **需要被读列的 SELECT 权限**，全表收回会把 `usage_users.last_seen` 的更新打死；而前端统计是**刻意静默**的 ⇒ 症状是「界面正常、数据变哑」：人数照常 +1（INSERT 不受影响）但**活跃/留存永远停在首见那天**，且没有任何报错。所以只把 WHERE 用到的那一列授回来；**真实可读性仍由「RLS 已开 + 无 SELECT 策略」兜住** —— 有列权限也读不到任何一行。两条都幂等、可逆。

### Added

- **非 Windows 用户第一眼就能看清「本地助手装不了」，并给四条替代路径**（`src/pages/Crawler.tsx` + `src/lib/usageEnv.ts` 的 `hostOs()`/`nonWindowsGuide()`；`89efa1e`）。**为什么必须做**：0.8.29 上线后第一批真实数据是「4 人打开、0 人下载」，其中 **3 人是 mac/linux** —— 他们不是「提示不够」，是**路径根本不存在**（本地助手只有 Windows 版）。现在非 Windows 用户会看到「**你现在的系统是 macOS** —— 本地助手目前只有 Windows 版，这台机器上装不了。**但下面这些在任何系统上都能用**」，随后四条替代：**岗位广场 / AI 评估 / 批量导入 / 从仓库源码跑抓取器（进阶）**。同时**不再给非 Windows 显示 Windows 的安装三步**，底部 exe/zip 入口也只对 Windows 显示。`hostOs()` **只按 UA 判到 win/mac/linux**（不采集指纹）；`nonWindowsGuide()` 是**纯函数**（5 条新断言）。

### Changed

- **判别器换方式**：从本批起**不用固定 bundle 名**。原因正是上面的修复 —— **版本号进了产物**，升版本会改变内容哈希，`index-XXXX.js` 这个名字随之变（0.8.29 是 `index-BbuHdbME.js`，0.8.30 变成 `index-IMqrLf9m.js`）。**新的判据**：产物里**含 `0.8.30` 且不含 `0.8.29`**，外加三句本批新文案（「本地助手目前只有 Windows 版」「但下面这些在任何系统上都能用」「从仓库源码跑抓取器」）。版本号唯一真相仍是 `app-version` + 逐字节 sha256。
- 四件套（本机实跑）：typecheck exit 0 / **72 files 889 tests** 全绿 / lint 0 error（**25 warnings**，**201 files**）/ build exit 0（主 bundle **`index-IMqrLf9m.js`**，622998 字节，sha256 `3bdcb6a542a1709e8f34a0633a1cc103b037830371b56bc52edb8e178a08eb60`）。⚠️ **本批不换助手包**，线上继续 r7（`5e9840ba…` / `0f42913a…`，已用 `verifyPublish --sha256` 全量复核未变）。

### Added

- **匿名使用计数 —— 从此能回答「有多少人在用 / 卡在哪一步」**（新 `src/lib/usage.ts` + `src/lib/usageEnv.ts` + `db/migrations/005_usage_events.sql` + `src/lib/__tests__/usage.test.ts`；`a70980b`）。**为什么要有**：项目要发出去拉真实用户，而此前代码里**没有任何计数** ⇒ 发出去也拿不到人数，简历/作品集上只能写「自用」。**这不是自己拍脑袋想的**，按老规矩先读了三份开源实现再定：
  - **garrytan/gstack**（`supabase/migrations/001_telemetry.sql`）→ 除事件表外**必须还有一张「用户表」**（`first_seen` / `last_seen`）：人数与活跃直接查它，**不用扫事件表**；事件带 `schema_version` 做前向兼容。
  - **var-raphael/Gnat** → 稳定匿名 id（`distinct_id`）+ `track(事件名, 属性)` + 漏斗视角。
  - **OpenLabs-so/openanalytics** → 隐私模型：**无 cookie、无指纹、不跨站**，尊重 Global Privacy Control。
  - **落地**：`usage_users`（一台浏览器一行）+ `usage_events`（5 个事件 `app_open` / `agent_download` / `agent_connected` / `crawl_ok` / `import_ok`，**按天唯一索引防刷**）。前端：匿名 id 是**本机随机串**（清 localStorage 即换身份、不绑账号）；`app_open` / `agent_connected` **会话内只记一次**；`detail` **只允许数字**（岗位内容塞进来会被丢掉）；**上报失败一律静默**（功能不受影响）；GPC 为真或用户在「设置」里关掉 ⇒ **一个事件都不发**。隐私说明常驻抓取卡底部 + 「设置」页开关。聚合 SQL（人数/活跃/漏斗/每日波峰）见 `docs/CONFIGURATION.md`「有多少人在用」。
  - **⚠️ RLS 是刻意与 gstack 不同的一处**：它整库都是匿名遥测所以放开了 SELECT；**我们这两张表旁边是别人的简历与投递记录**，所以**故意不建任何 SELECT 策略** —— 匿名端只能 INSERT/UPDATE，**统计一律走管理端**。匿名键不能变成读库通道。
- 四件套（本机实跑）：typecheck exit 0 / **71 files 882 tests** 全绿 / lint 0 error（**25 warnings**，**200 files**）/ build exit 0（主 bundle **`index-BbuHdbME.js`**，621487 字节，sha256 `7c7c296ea825581d774ccbc24df99f6fa3ee2d15db40b2841d8fcf3915ae6e14`）。**判别器与交接单预判逐字符一致。** ⚠️ **本批不换助手包**，线上继续 r7（`5e9840ba…` / `0f42913a…`，已用 `verifyPublish --sha256` 全量复核未变）。

### Fixed

- **`005_usage_events.sql` 里那条唯一索引**在执行通道上报 `42601 syntax error at or near "::"`（2026-10-04 首次执行时踩到，WorkBuddy 报）。**现象**：`(received_at AT TIME ZONE 'UTC')::date` 放进 `CREATE INDEX` 的表达式上下文就挂；**同样的 cast 放在 `SELECT` 里是合法的**（实测 `SELECT (now() AT TIME ZONE 'UTC')::date` 能跑）⇒ **不是 cast 本身非法，是索引表达式上下文不接受**。**修法**：改用等价的函数形式 `date(received_at AT TIME ZONE 'UTC')`，语义相同、能正常建索引；文件里已加注释说明「重放本文件请用下面这一行」，**免得下一个执行的人再撞一次**。
- **⚠️ 一处待你决定的权限收紧建议（本轮我没擅自做）**：`role_table_grants` 显示 `anon` / `authenticated` 对两张表**有 SELECT 授权**（来自平台默认，005 本身只授了 INSERT/UPDATE）。**当前匿名端读不到** —— 靠的是「RLS 已开 + 无 SELECT 策略」这**单层**兜住。**风险**：若将来有人 `ALTER TABLE … DISABLE ROW LEVEL SECURITY`，那些授权会立刻生效。建议补一条把边界做成双保险：
  ```sql
  REVOKE SELECT ON public.usage_users, public.usage_events FROM anon, authenticated;
  ```
  **不影响管理端统计**（走 `exec_sql` 的管理员角色，既绕过 RLS 也不是这两个角色），**也不影响前端**（已核 `src/lib/usage.ts`：只有 `insert` / `update`，**无任何 `select`**）。可随时 GRANT 回来。**这属于你的数据边界决策，我等你点头再动。**

### Changed

- **给「别人用」：权限放行改首选，桥接窗口降为备选并写明代价**（`src/pages/Crawler.tsx`；`535a523`）。**为什么要改**：0.8.24 把桥接做成「不用翻浏览器设置」的好事，但界面**先摆桥接按钮** ⇒ 等于把**更麻烦的那条路当默认**（每次刷新都要重新点一次）。发给别人用时，默认路径该是**一次性成本最低**的那条。现在卡片上：
  - **首选（一次性，之后每次打开都直连）= 放行「设备上的应用 / 本地网络访问」**，带「**复制设置地址**」按钮（浏览器设置页不能点链接跳转，只能复制）；
  - **备选（不想动浏览器设置）= 桥接窗口**，并**明说代价**：这个页面每次刷新后要重新点一次；放行权限则没有这一步。- **桥接连上后补一句「想免掉这一步？」**（`535a523`）：给「**把本地网络访问放行一次就永远直连**」的指引 + 复制设置地址按钮 —— 用过一次桥接的人最容易接受这条建议。
- **明说「本地助手目前只支持 Windows」**（`535a523`；用系统里的 Edge / Chrome 抓取）：别让人在 Mac/Linux 上白折腾。
- **「选站点」加「只看实测可用（7/27）」勾选**（`535a523`）：**27 个站点里只有 7 个实测可用**，新人乱挑会白等一轮。默认只看实测可用的那些。
- 四件套（本机实跑）：typecheck exit 0 / **70 files 873 tests** 全绿 / lint 0 error（**25 warnings**，**197 files**）/ build exit 0（主 bundle **`index-CojUE4vU.js`**，617919 字节，sha256 `d85933fba4a2608338a38732b25f4b297a958d0ef46a6e7fad9b52ee7f5f6fbd`）。**判别器与交接单预判逐字符一致。**
- ⚠️ **本批不换助手包**：四处全在网页端，**线上继续用 r7**（安装包 `5e9840ba…` / zip `0f42913a…`，两者哈希均未变，已用 `verifyPublish --sha256` 复核）。

### Fixed

- **⚠️ 桥接的「写」全被 403 —— 读能通、写不通**（`crawler/agent/server.mjs`；`5625afb`）。**现象**（发起人截图暴露）：在网页上保存定时抓取，右上角弹红条「**来源不被允许**」。**根因**：助手的 Origin 白名单只有**工作台域**与 5173 开发端口，**没有助手自己的源**；而**桥接页的源就是 `http://127.0.0.1:<PORT>`**（它与助手同源），它替工作台转发时浏览器会给 **POST** 带上这个 Origin ⇒ 撞闸门 403。**为什么之前没暴露**：**GET 不带 Origin** ⇒ 之前验通的桥接（探测 / 站点 / 任务状态）**全是读操作**，而**写操作（保存计划、发起抓取）一条都没试过** —— 一个「只验过读」的接口等于没验。**修法**：白名单补 `SELF_ORIGINS = ['http://127.0.0.1:<PORT>', 'http://localhost:<PORT>']`（用 `PORT` 变量，换端口自动跟随），并把闸门与桥接判定统一成 `isAllowedOrigin()`。**实测**：桥接页 Origin 的 POST → **200**（原来 403）；工作台域 → 200；`https://evil.example` → **仍 403**（闸门没有被放宽）。
  - **两处刻意保持不变**（别误读成漏改）：`/bridge?origin=…` 那个校验仍**只认工作台域** —— 那里校验的是**工作台**的 origin，不是助手的；CORS 响应头也仍只对工作台域发 —— 桥接页与助手**同源**，本来就不需要 CORS 头。
- **保存失败却「看起来像成功」**（`src/lib/localAgent.ts#scheduleDirty` + `src/pages/Crawler.tsx`；`5625afb`）。**现象**：定时抓取的状态文字原来按**编辑中**的状态渲染 ⇒ 保存失败（403 或任何错误）时界面照显示新值，**用户以为已经存好了**。**修法**：新增 `scheduleDirty(schedSaved, 编辑中的值)`（比较 `enabled` / `at` / `sites` / `keyword`，7 条断言），不一致就在摘要后显示「**（有改动未保存）**」。**教训：「看起来像成功」比报错更危险** —— 报错用户会去找，假成功用户不会。
- 四件套（本机实跑）：typecheck exit 0 / **70 files 873 tests** 全绿 / lint 0 error（**25 warnings**，**197 files**）/ build exit 0（主 bundle **`index-lQLZi6tD.js`**，616687 字节，sha256 `c270c83ab09fa696b28e1595fdaaaafc41426d9141a403924727fbcc041e70ef`）。**判别器与交接单预判逐字符一致。**

### Changed

- **助手包换代（r7）**：zip **53,579,505** 字节 / sha256 `0f42913ae74b86e19f9f928a52262241d764a1854197a535c2ae1dc02cccf882`；安装器 **53,592,576** 字节 / sha256 `5e9840ba6ea907f72ab8fa40e78400333735759de48f4edfc04e087f1e0ff1b4`。**线上文件名不变**（仍叫 `internship-workbench-agent.zip`）。**r6 的哈希已作废。** ⚠️ **Origin 白名单在助手侧** —— 不换包，桥接的写操作照样 403。

### Added

- **助手定时抓取 —— 第 2 层 3/3 收口**（新 `crawler/agent/scheduler.mjs` + `crawler/agent/server.mjs` 的 `GET/POST /schedule` + 每分钟 tick；网页侧 `src/lib/localAgent.ts` 的 `getSchedule`/`setSchedule` + `src/pages/Crawler.tsx` 的开关/时间/保存/上次结果；新 `crawler/__tests__/scheduler.test.mjs`；`b0124d7`，由 DSH 完成）。**为什么做**：前两层解决的是「装得上」和「连得上」，这一层解决「**不用一直盯着**」—— 到点自动跑，用户只看结果。
  - **到点判定五个条件全要满足**：开着 + 勾了站点 + 已过点 + **今天没跑过** + **距到点 ≤ 6 小时**。最后一条两头都防：既防「开机晚了就整天不跑」，也防「隔天补跑一次把昨天的岗位混进来」。
  - **抓取复用既有 `/crawl`（并发互斥）且无头跑** —— 不另造一条抓取路径，也就**不会有第二套去重 / 解析逻辑**；无头跑 ⇒ 不弹窗口。
  - 配置持久化在 `crawler/.schedule.json`，**已进 `.gitignore`（每台机器一份）**；**默认关闭**。
  - 网页侧：开关 + 时间 + 「保存自动抓取」+ 「上次自动抓取：日期 时间 · 新增 N 条」+「**导入这 N 条**」。导入走既有 `JobImportModal` ⇒ **入库零新代码**。
  - **老包没有 `/schedule` ⇒ 拿不到就不显示这个块（不是错误）**：界面按 `sched` 为空自然隐藏，不给老用户添乱。
  - **真机 E2E**：配「2 分钟前到点」→ 自动触发 → `lastRun = { ok:true, newJobs:5 }`，产出文件名带时间戳。

### Fixed

- **`POST /schedule` 把非法时刻静默改成 09:00**（`crawler/agent/server.mjs`；`17f75ad`）—— 传 `"99:99"` 原来**静默「猜」成 09:00 并回 200**：用户以为自己设了 99:99，系统替他挑了个 9 点他毫不知情。**静默地猜比报错危险** —— 现在 strict 校验，非法直接 **400**。
- 四件套（本机实跑）：typecheck exit 0 / **70 files 872 tests** 全绿 / lint 0 error（**25 warnings**，**197 files**）/ build exit 0（主 bundle **`index-Dd1JU9dX.js`**，616373 字节，sha256 `35a35540824d84699616d499f933aed1e5bec943fd0d921be8fa53069025222f`）。**判别器与交接单预判逐字符一致。** ⚠️ **lint 扫描文件数 195 → 197**（本批新增的 `scheduler.mjs` / `scheduler.test.mjs` 进了扫描）⇒ 仍是 **25 warnings**，但**口径是「197 files 下的 25」**。
- ⚠️ **一处事实更正（以 git 为准）**：交接单把定时抓取写作 `c92082a + 17f75ad`，但 **`c92082a` 在本仓库查不到**（`git cat-file -t c92082a` → `fatal: Not a valid object name`）—— 实际提交是 **`b0124d7`**（feat）+ **`17f75ad`**（fix strict）。**发布源按你明确指定的 `17f75ad` 走，它在 master 上，不受影响。**

### Changed

- **助手包换代（r6）**：zip **53,579,333** 字节 / sha256 `dbbc229c3b1c100673d09c1ee099f0ae9cd74d5519d46af4aaf3d523a016bce9`；安装器 **53,592,576** 字节 / sha256 `4b8ebd53fab3f0fe49e925e19cec82d0b1980e0ad8aa99f9afcea1bae7bf3458`。**线上文件名不变**（仍叫 `internship-workbench-agent.zip`）。**r4 / r5 的哈希已作废。** ⚠️ **定时抓取必须换包才生效** —— `/schedule` 与每分钟 tick 都在助手侧，网页上的开关只是它的遥控器。

### Fixed

- **⚠️ 结清挂了好几批的测试 flake 口径**（`vitest.config.ts`；`4d47e09`）。**现象**：默认 `testTimeout` 5 秒对本仓库偏紧 —— 有 **7 处断言会走整棵源树做源码推导**（`profileTemplate` / `byoHygiene` / `rlsGuards` / `aiPromptCoverage` / `aiQuotaCoverage` / `agentTools` / `channelCapability`），并行负载下会越过 5 秒，表现为「**看着像真失败的假红**」：失败形态是**超时**而不是断言不成立。2026-10-03 受控三路并发可稳定复现（3/3 全红，4 / 5 / 12 条，耗时 5.0–12.4 s）。**修法按构造消掉这一类**：全局提到 **20 s**（4 倍余量），不再逐条给用例加 timeout。**真正卡死的用例仍会失败，只是晚一点。**
- **桥接页在 Edge 里脚本根本没执行 —— 页面静默停在「正在与工作台建立桥接…」**（`crawler/agent/bridge.html` + `crawler/agent/server.mjs`；`4e0355d`）。**这是桥接真机验证时暴露的**：把该站点的「设备上的应用」设为**阻止**后强刷，点「用桥接窗口连上」—— 小窗一直停在初始文案。**根因**：`bridge.html` 原来用 `<script type="module">` + `import '/bridge.js'`，模块脚本走的是另一条加载路径（跨源与 CSP 任一不满足就**无声失败**）。**页面不动、不报错、控制台也不一定出声** ⇒ 表现与「连不上助手」一模一样，**没法区分**。**修法两条**：① 改成**服务端原地注入的经典脚本**（无 `import`，不依赖模块加载）；② 加 `try/catch`，出错**写进小窗 + 回传工作台** —— 「静默不执行」以后不会再无声无息。
- **权限被浏览器拒绝时，界面把原因说反了**（`src/pages/Crawler.tsx`；`5cd7657`）。**现象**：LNA 权限被阻止时失败是**立即的网络错误**，不是超时；而 LNA 指引只在超时分支显示 ⇒ 界面落到兜底文案「连不上助手…去跑 `npm run agent`」—— **助手其实一直在跑**，这句话把人指向完全相反的方向。**修法**：**任何失败都去查权限状态**，被拒时明说「**浏览器拒绝了本地网络访问，这不代表助手没装或没在跑**」，并指向桥接窗口。
- **桥接页自己的报错接不到卡片上**（`src/lib/localAgent.ts` + 其测试；`865c688`）：配合上一条，桥接侧一失败，小窗里看得到、工作台上看不到。现在两边都看得到。
- **底部常驻那行文案写重了**（`src/pages/Crawler.tsx`；`a27f851`）：「手动安装（zip）」后面又跟了一遍 zip 说明，读起来像重复了两遍。
- 四件套（本机实跑）：typecheck exit 0 / **69 files 858 tests** 全绿 / lint 0 error（**25 warnings**，195 files）/ build exit 0（主 bundle **`index-Bmsa_Bde.js`**，614258 字节，sha256 `65459b5e851ccf3ed30a57f4a6af3852584d009be9193a18c2d73c449a44501c`）。**判别器与交接单预判逐字符一致。**

### Changed

- **助手包换代（r4）**：zip **53,574,185** 字节 / sha256 `5f5fd20ad7e6eb3799a4c404b0564e36315aa8c4ad52eb9c9e099d1d28d6c824`；安装器 **53,587,456** 字节 / sha256 `dc1e79d7b7a9dcb76c32e714a195ca98f635dae1b8a63735de982c093664db1d`。**线上文件名不变**（仍叫 `internship-workbench-agent.zip`）。**r3 哈希（zip `c7d11470…` / 安装器 `ff6e84cf…`）已作废** —— **桥接页在助手包里**，上面那条脚本修复不换包就到不了用户手上。

### Added

- **第二层第二项：桥接窗口 —— 绕过浏览器「本地网络访问」（LNA）权限，用户不用再翻浏览器设置**（`crawler/agent/bridge.js`、`crawler/agent/bridge.html`、`crawler/agent/server.mjs` 两条路由、新 `crawler/__tests__/bridge.test.mjs`（8 条）、接口契约补一节；工作台侧 `src/lib/localAgent.ts#bridgeUrl/isBridgeMessage/openBridge/bridgeCall` + `src/pages/Crawler.tsx` 的按钮与提示；`302b321`，由 DSH 完成）。**机制（一句说清为什么能绕）**：LNA 只管**页面自己发起的 fetch**，而**顶层导航到 `127.0.0.1` 是豁免的**；于是工作台在**用户点击**里开一个小窗到助手的 `/bridge` 页（**与助手同源**），由它代工作台调接口，再用 `postMessage` 把结果送回；工作台侧 `call()` 在桥接可用时**优先走它**。**安全边界（服务端 + 协议两侧都校验，一条都不许过）**：服务端只对**白名单 origin** 提供桥接页（外来 → **403**，实测）；消息两侧都校验 **origin + nonce**；桥接只转发**助手自己的路径**（`http://…`、以 `//` 开头、含 `..` 一律拒）—— 不能被当成任意代理。**⚠️ 前提是助手包换代**：`bridge.js` 在助手包里，**旧包没有 `/bridge`，桥接根本用不了** ⇒ 所以这批同时换了包（见下）。卡片上新增「用桥接窗口连上（不用改浏览器设置）」按钮与「正通过桥接窗口连接」提示。

### Changed

- **助手包换代（r3）：`InternshipWorkbench-Agent-Setup.exe` 与 `internship-workbench-agent.zip` 都换成带桥接的新包**。zip **53,573,421** 字节 / sha256 `c7d11470b0f946ead6315bd9eab00162b3e64042ae2754f69412eebddd79dd6b`；安装器 **53,586,432** 字节 / sha256 `ff6e84cfff0feb58a16dfe9077387d28018e6dd5ab46f4e570ab1772945d0f9e`。**线上文件名不变**（仍叫 `internship-workbench-agent.zip`，常量就指向它）。⚠️ **请求 8 里给的 r2 哈希（安装器 `6ada6441…` / zip `ca219063…`）已作废** —— r2 是在 `bridge.js` 变更与两处 lint 清理**之前**打的，产物已过期。真机核对：装后 `/health` `ready` / `problems:[]`、`/bridge` 200（含 `bridge.js`）、外来 origin **403**、11 个产出文件 + `.profile` 保住。

### Fixed

- 四件套（本机实跑）：typecheck exit 0 / **69 files 858 tests** 全绿 / lint **0 error**（**25 warnings，基线已回 25**）/ build exit 0（主 bundle **`index-Cop7l6ow.js`**，613596 字节，sha256 `5813da4cf21e73a6c51f5abf171da83f251ee48f06fbb51c07f106cd9a3716c7`）。**判别器与交接单预判逐字符一致。**
- **回执 #71 点名的 lint 债（25 → 26）已结清**：`c2c1cfe` 删掉 `scripts/build-agent-installer.mjs` 里未使用的 `REPO`；`868857a` 再去掉 `bridge.js` 的两处未使用（`log` / `catch (e)`）。**另记一条口径变化**：oxlint 扫描文件数 **191 → 195**（本批新增的 `bridge.js` / `bridge.test.mjs` 等进了扫描）⇒ 「25 全在基线」这句话**在把新文件算进去后**才重新成立 —— 它不是「回到旧口径」，是「新口径下的 25」。
- **DSH 自报三处自己的错（都被闸门或现象当场抓住，照实记）**：① 回包解析改成 `res.text()` 后 **11 条既有测试红了**（测试桩只有 `json()`）→ 收敛成 `parseBody(body, status)`、桥接单独 `parseBridgeText`，两条路共用同一套状态码判定；② 重建安装器那条命令**漏了 workdir**，脚本没找到却**继续跑了旧安装器**（现已加「exit≠0 即中止」）；③ `Start-Process -Wait` 在 PowerShell 5.1 会等**整棵进程树**，而安装器启动的助手永不退出 ⇒ 命令被提升成后台、kill 时把助手一起带走（已起回，改用 `$p.WaitForExit(180000)`）。

### Changed

- **下载入口从「zip 手动包」换成「安装包 exe（双击即装）」**（`src/lib/localAgent.ts`、`src/pages/Crawler.tsx`；`1ad6c48`）。**为什么要换**：0.8.20/0.8.21 的入口给的是一条 51 MB 的 zip —— 用户拿到手要自己解压、认准哪个是 `start-hidden.vbs`、再双击（装了 0.8.22 的「解除锁定」提示也只是把这道坎说清楚，没有消掉它）；真机走一遍就发现这步对普通用户是门槛。现在主入口是**单文件 `.exe`**：双击即装（脚本内嵌整包；装完写开机自启），**装完自动变绿**（配合 0.8.22 起的每 5 秒自动重试探测）。**旧的 zip 一条都没删** —— 常量改名为 `AGENT_PORTABLE_URL`（`AGENT_DOWNLOAD_URL` 让给 exe），给不想/不能跑 exe 的人留着，也用于排查。**单测同步收紧**：`AGENT_DOWNLOAD_URL` 只允许空或 https 的 `.exe`/`.zip` 直链，另新增一条钉住 `AGENT_PORTABLE_URL` 必须是 https 的 `.zip` —— 挡的是占位符 / 相对路径 / HTML 中间页这类值。
- **`scripts/verifyPublish.mjs` 改成核验两个下载物**（`1ad6c48`）。原先只看 zip 的 Content-Type；现在同时核验**安装包不能返回 `text/html`**（返回 HTML = 这次发布没把 `public/downloads/` 里的 exe 带上，链接被静默换成 SPA 回退页）+ **zip 必须是 `application/zip`**。两个包都放在发布源树的 `public/downloads/` 里、**都不在 git 里**（`.git/info/exclude` 排除整个目录）⇒ 漏带一次就会静默变成一个网页，而状态码仍是 200；这条工具就是钉这个坑的。

### Added

- **安装器：`scripts/installer/Installer.cs`（C# 5）+ `scripts/build-agent-installer.mjs`**（`1ad6c48`，由 DSH 完成）。**为什么用系统自带的 `csc.exe` 编译**：零依赖 —— 用户机器上只要有 .NET Framework（Windows 10/11 自带）就能编出产物，不需要装任何 SDK；**C# 只能是 C# 5 语法**（不能用字符串插值 / `?.` / `nameof`）。**设计**：单个 exe，把整包 zip 作为资源**内嵌**；运行时释放到 `%LOCALAPPDATA%\InternshipWorkbench`、跑自检、写开机自启、启动助手；**不覆盖用户的产出与登录态**。**真机验过**：释放 2592 条目，`output/` 11 个产出文件 + `.profile` + 4 个 `.seen` 缓存**全保住**；四个关键件哈希全对；pid 换新（16196 → 19012）、`/health` `ready:true`。**产物**：`InternshipWorkbench-Agent-Setup.exe`，53,581,824 字节，sha256 `2c2ee010c701c2a5c6ab7d8689f9c1b8ba20f0aae036843f880a80c2949e5004`。⚠️ **未签名** ⇒ 用户首次运行可能撞「Windows 已保护你的电脑」→「更多信息」→「仍要运行」，**卡片文案里已经写了这句**；以后有代码签名证书再签，就彻底没这一步。

### Fixed

- 四件套（本机实跑）：typecheck exit 0 / **68 files 848 tests** 全绿 / lint 0 error / build exit 0（主 bundle **`index-DX1RJj5e.js`**，610707 字节，sha256 `7c4eb358b468e25d8f00917c23ba4d5f9dcb0d0fc3b6fbfd7bba7df7ef382d1d`）。**判别器与交接单预判逐字符一致**（这批交接单把判别器绑到了 `1ad6c48`，一次对上 —— 对上批「判别器对不上」的直接验证：问题出在没绑提交，不在判别器本身）。
- ⚠️ **lint warnings 基线位移：25 → 26**（`0 errors`、exit 仍为 **0**）。新增的那条是 `scripts/build-agent-installer.mjs:23` 的 `REPO` 声明后未使用（`no-unused-vars`）。⇒ **从本批起，「25 warnings 全在基线」这句话要改成 26**。**如实记下，没有顺手压掉**（要改就是给脚本动一刀，属独立一笔）。

### Fixed

- **「旧批次的产出冒充本次结果」—— 用户会看到一个他这次根本没抓到的导入预览**（`src/lib/localAgent.ts#freshOutputs` + `src/pages/Crawler.tsx`；`aaa00a0` 首次修法、`94c00b3` 改用 mtime 判据、`2ae504e` 修 tsc）。**现象**（DSH 真机实测）：同一站点 + 同一关键词再抓一次，爬虫的默认去重（`.seen-*.json`）会跳过全部历史岗位，日志是「与历史产出重复 5 条 → 合计 0 条」、**根本不写文件**；而助手 `result.outputs` 的语义是「`output/` 里最近几个文件」—— 于是线上 0.8.21 会拿**上一批**冒充本次结果，弹出一个「共 10 条」的导入预览。**修法**：抓取前后各取一次 `GET /outputs` 快照，按 **mtime 判据**筛出本次真正写出的产出（新文件名，或同名但 mtime 变新）。**为什么用 mtime 而不是文件名的集合差**：`output/` 里的文件名不保证会变（同名覆盖），只有 mtime 能区分「这次写的」与「上次留下的」。**空数组的语义被明确下来**：本次没有新增岗位 → 界面**如实这么说**，不再拿旧文件顶上。**快照拿不到时退化成旧行为**（`freshOutputs` 里 `if (!before) return all`）—— 宁可显示旧行为，也不静默吞掉用户的结果。**真机双场景验证**（同机同助手）：同站点+关键词再抓 → 服务端 2 文件 / 10 条，修复后 **0 条**；换关键词「算法」→ 服务端 3 文件 / 15 条，修复后 **1 文件 / 5 条**。
- **`freshOutputs` 的 `after` 参数允许 `null`**（`2ae504e`）—— `94c00b3` 的 tsc 是红的（`TS2345`）。红法和 0.8.20 那次同源：**把「跑三件套」与「提交」放在同一条命令里、没在 tsc 失败时中止**，`npm run build` 被 `&&` 挡下、`dist` 仍是上一代，提交照样出去了。这是同一流程坑第二次出现（DSH 自报）。
- 四件套（本机实跑）：typecheck exit 0 / **68 files 848 tests** 全绿 / lint 0 error（25 warnings 全在基线）/ build exit 0（主 bundle `index-BvNiRJ_2.js`，610343 字节，sha256 `8b118ef1cab34d76822dd1db2c17847d93de328c637cfb7eea36f3d889069047`）。
- **两处数字更正（以实测为准）**：① 交接单写「67 files 841 tests」，本机实测 **68 files 848 tests**（差的正是最后一笔 `75c9443` 新增的 `crawlerPrefs.test.ts`，+7）；② **交接单预判的主 bundle `index-D9MpSCgZ.js` 在本机复现不出来**：本机在发布源 `75c9443` 上构建得到 `index-BvNiRJ_2.js`（610343 字节）。**已做对照实验定位原因**：产物里**不含版本号字符串**（`grep -o '0\.8\.2[0-9]'` 零命中），且把版本号临时改回 0.8.21 重建，产物名与 sha256 **完全不变** ⇒ 版本号不影响 bundle 哈希；再叠加本仓 `core.autocrlf = true`（工作树是 CRLF，而 bundle 哈希对换行敏感）⇒ **「预判的 bundle 名」只在生成它的那台机器上有效**。**结论：判别器改用 `app-version` + 逐字节 sha256 + 文案标记，不要跨机器比 bundle 名。**

### Added

- **卡在「本地网络访问」那一关的用户，现在有可照做的指引了**（`src/lib/localAgent.ts#lnaHelpFor` / `lnaPermissionState`，`aaa00a0`）。**为什么必须有**：Edge ≥142 起，从线上 https 页面访问 `127.0.0.1` 要单独授权（Edge 里的名字是「设备上的应用」/ `loopback-network`），**没授权时 `fetch` 既不 resolve 也不 reject**，界面只能超时；而**很多浏览器根本不弹提示**，用户无从下手 —— 这就是发起人当天卡住的那一关。现在按 UA 分岔：Edge → `edge://settings/privacy/sitePermissions/allPermissions/loopbackNetwork`（手动路径「设置 → Cookie 和网站权限 → 所有权限 → 「设备上的应用」→ 允许」）、Chrome → `chrome://settings/content/localNetworkAccess`、其它浏览器给通用说法。**浏览器设置页不能点链接跳转，所以界面给的是「复制」按钮而不是 `<a>`**；权限状态查不到就返回 `unknown` —— **不猜**。
- **第 1 层便利：第二次抓取不用重新勾站点、重新打关键词**（新 `src/lib/__tests__/crawlerPrefs.test.ts` + `src/lib/crawlTask.ts` + `src/pages/Crawler.tsx`，`75c9443`）。四项：① 记住上次的站点/关键词/参数（设备级 `localStorage`；**解析失败退化成默认值**，不让坏数据把页面卡死）；② 装助手期间**每 5 秒自动重试探测、最多 24 次（约 2 分钟）** —— 装好一起来就自动变绿，不用用户回来手点「重新检测」；③ 四步安装引导；④ 失败时一键「用上次的参数重试」。都是用户视角实测出来的卡点。

### Changed

- **开发者用的 `npm run agent` 收进「进阶」折叠**（`aaa00a0`）：主路径只留「下载 → 解压 → 双击 `start-hidden.vbs`」。**那条命令一条都没删** —— 只是不再跟主路径抢注意力（它要求用户自己有仓库和 Node，本就属于开发者路径）。

### Fixed

- **下载入口改成常驻 —— 旧包用户在界面上拿不到新包**（`src/pages/Crawler.tsx`，`78809b0`；发起人刷新线上页面时撞出来的缺口）。**现象**：发起人刷新线上 `#crawler`，卡片显示「本地助手已连接 · 27 个站点」，但**看不到任何下载入口**。**根因不是实现 bug，是状态机漏了一格**：上一版把下载链接**只**放在「助手没在跑」与「装得不完整」两处，而他的助手是**旧版本**（不上报 `ready` / `problems`）却**连通正常** ⇒ 两个状态都不成立 ⇒ 这类用户在界面上**没有任何入口**能拿到新包 —— 而他们恰恰是最需要新包的人。**修法三条**：① 下载入口**常驻**在卡片底部一行（「没装过、或抓取报『装得不完整』？下载最新版本地助手（zip，含 Node 运行时）」）；② 助手连通但 `ready === undefined`（自检字段缺失 = 旧版本）时主动提示「这台本地助手是**旧版本**……建议覆盖安装一次」；③ 原来那两处照旧。**为什么用 `ready === undefined` 而不用版本号比大小**：旧包根本不上报版本，唯一可靠信号就是这个字段在不在。
- 四件套（本机实跑）：typecheck exit 0 / **67 files 832 tests** 全绿 / lint 0 error（25 warnings 全在基线）/ build exit 0（主 bundle `index-CUNQ3HeR.js`，605686 字节，sha256 `73a82a5515584bd918bb81491e1ab373a075b017a33cedf1dc856662b4f7f00f`）。另 `node scripts/verifyPublish.mjs` exit 0。
- ⚠️ **本批测试出现一次负载敏感型 flake —— 已定位机制，本轮不改（留证如下）**：
  - **事实**：首次全量跑 **1 file / 2 tests 红**（**超时**，不是断言失败）；复跑即全绿。此后**单独跑共 12 次：11 绿 1 红**，且**始终没复现出第 1 次那两条的名字**。
  - **受控实验（三路并发）**：3/3 全红，分别 **4 / 5 / 12 条**失败 —— 失败全部落在**读全树 / 写临时目录**那类用例上（`crawler/__tests__/selfcheck.test.mjs`、`src/lib/__tests__/profileTemplate.test.mjs`、`rlsGuards.test.mjs`、`miniprogram/__tests__/billing.test.mjs`、`crawler/__tests__/dailyReport.test.mjs`），耗时 **5.0 – 12.4 s**。
  - **机制**：vitest 默认 `testTimeout: 5000ms` 在本机负载下太紧（0.8.19 已为此单独给 `profileTemplate` 那条加过 30 s，属同一根因，当时只是按单条打补丁）。
  - **实验副产物，别误读**：并发实验里 `crawler/__tests__/agent.test.mjs` 那几条**毫秒级**失败，是三路互抢**固定测试端口 8791** 造成的（该文件注释写明「用测试端口，不要抢占用户正在用的 8787」），**单跑不会出现**。
  - **为什么不一起改**：改 `vitest.config.ts` 是独立一笔、要连带回归；建议下一批把 `testTimeout` 提到 30 s，**按构造消掉这一类**，而不是继续逐条加 timeout。

### Added

- **网页端终于有了「下载最新版本地助手」的入口**（`src/lib/localAgent.ts#AGENT_DOWNLOAD_URL` + `src/pages/Crawler.tsx`：「助手没跑」与「装得不完整」两处各多一条下载链接；`21634b1` 先预留常量、`b51d3d2` 填值）。**为什么现在才补**：2026-10-03 用用户视角实测 —— 用户机器上的助手是**单独安装**的（`%LOCALAPPDATA%\InternshipWorkbench`），而网页里**从来没有下载入口**：只给一句可复制的 `npm run agent`（那要求用户自己有仓库和 Node）和一句**无链接**的「重装或更新本地助手」。也就是说助手装不上、装坏了的用户，在界面里**没有任何出路**。常量按构造防呆：**空值 = 不渲染入口**（所以填之前线上行为不变），单测钉住它只能是空、或 https 的 `.zip` 直链（挡占位符 / 相对路径 / HTML 页面这类值）。
- **新 `scripts/verifyPublish.mjs` —— 把「单测钉不住的那个坑」做成工具**（`b51d3d2`，退出码 0/1/2）。它核验三样：`app-version`、主 bundle 可达、下载链接的 **Content-Type**。**为什么必须看 Content-Type 而不是状态码**：发布后实测到，zip 不在 `public/downloads/` 里时那个下载 URL **不报 404**，而是返回 **200 + `text/html`（SPA 回退页）** —— 一次没带上文件的发布会把下载链接**静默**变成一个网页，而状态码仍是 200、URL 形状仍然合法。支持 `--zip` / `--bytes` / `--sha256`（后者全量下载比对，51 MB、慢）。

### Changed

- **`src/pages/` 下 4 个文件的行尾归一为纯 CRLF**（`fe6a564`）。内容逐行不变（`git diff --ignore-cr-at-eol` 为空），但**构建产物哈希随之改变**，属于本批「产物换代」的来源之一。⚠️ **该提交信息写「8 个文件」，`git show --stat` 实为 4 个**（`JobsSquare.tsx` / `Overview.tsx` / `Pipeline.tsx` / `Resumes.tsx`，5 insertions / 5 deletions）—— 记录以 `git show --stat` 为准，按行尾归一不改逻辑照发。

### Fixed

- **`b51d3d2` 的 tsc 是红的（`TS2367`）**（`f52eabe` 修）。下载常量是**字面量类型**，单测里拿它与 `''` 比较，被 TS 判成「不可能的比较」。**根因不是测试写错，而是流程错**：把「跑三件套」与「提交」放在同一条命令里、却没在 tsc 失败时中止 —— `npm run build` 被 `&&` 挡下、`dist` 还是上一代，人却把提交推出去了。修法是先落到 `string` 再比。这条由 DSH 自报，本机复核 `npx tsc -b` exit 0 成立。
- **全树身份扫描那条用例加 30s timeout**（`761fb78`）。`src/lib/__tests__/profileTemplate.test.mjs` 那条「发起人邮箱那串数字在整个工作树 0 命中」是**同步全树 walk**，默认 5000ms 在并行负载下会被挤爆 —— 0.8.19 首次全量跑实测撞线（隔离跑 435ms 通过）。这是 0.8.19 已登记在案的 flake，本批结清。
- 四件套（本机实跑）：typecheck exit 0 / **67 files 832 tests** 全绿 / lint 0 error（25 warnings 全在基线）/ build exit 0（主 bundle `index-DP6PbA8k.js`，605112 字节，sha256 `1818ee6177e0aede9671a710ebe85cf7a4e986d6415641561ff3ef1865f48ce3`）。另 `node scripts/verifyPublish.mjs` exit 0。

### Fixed

- **抓取失败时不再一律说「站点改版或需要登录」**（`src/lib/crawlTask.ts#crawlFailureHint`）：改成按日志签名分派 —— 缺依赖 → 去 crawler 目录 `npm install`；缺 `extension/collector.js` → 本地助手装得不完整；档案目录被占用 → 关掉抓取器开的浏览器；需要登录 → `node login.mjs`。起因是 2026-10-03 用户视角实测：两次失败都是**本地缺件**，卡片却把用户指向站点问题。
- 四件套：typecheck exit 0 / **67 files 831 tests** 全绿 / lint 0 error（25 warnings 全在基线）/ build exit 0（主 bundle `index-CNNbqT3x.js` 604.82 kB / gzip 189.13 kB）。另 `node crawler/selftest.mjs` exit 0、`node crawler/agent/selfcheck.mjs` exit 0（发布前闸门：采集脚本 / 依赖 / 系统浏览器三样都在）。**首次全量跑有 1 条超时**：`profileTemplate.test.mjs` 那条「全工作树扫邮箱串」的用例在并行负载下撞了 vitest 默认 5000ms（隔离跑 435ms 通过，重跑全量 67 files / 831 tests 全绿）；它是同步全树 walk，建议给它单独放宽 timeout —— 本轮不改（不在本批范围）。
- **「一键抓取」卡片永久停在「正在探测本地助手…」，按钮一直灰着，连重试入口都不给**（`src/lib/localAgent.ts` + `src/pages/Crawler.tsx` + `src/lib/__tests__/localAgent.test.ts` 新增 1 条用例；版本升到 `0.8.18`）。根因是两层，缺一层都解释不了这个现象。**代码层**：`call()` 没有任何 deadline，而 `probeAgent()` 只有 on / off 两个出口，`checking` 不是状态机里的一个终点 —— 那个 `fetch` 只要不落地，界面就永远停在探测中；更要命的是「重新检测」按钮**只在 off 状态渲染**，于是"卡住"和"没有重试入口"是同一个 bug 的两面，用户唯一能做的是刷新整页。**浏览器层**：现代 Edge（≥142）把 `127.0.0.1` 归进 **loopback-network**（设置里的名字是「设备上的应用 / Apps on device」，与「本地网络 / local-network」是两个不同的权限），而该 origin 从没拿到过这条授权 —— 请求**既不 resolve 也不 reject，就挂在权限提示上**。这一层先前只有推断（依据是本机 `Preferences` 里 `loopback_network` 桶没有本站 origin），后来拿到实测：手动授权后，同页面刷新即显示「本地助手已连接 · 27 个站点」。修法按"两条都要治"来：探测走 **8 秒 deadline**（其它调用仍是 15 秒，探测是最该快点死掉的那一个）、超时时把**可执行的下一步**（给本站 origin 开本地网络权限）写进错误文案、失败原因显示到卡片上、探测中就直接提示"可能在等浏览器授权"。新增的用例钉的是**最难自然复现的那条路径**：fetch 被权限闸门挂住时，到点必须抛错而不是永远 pending。留下一个必须记住的副产品：**已经挂死的那个请求不会自愈** —— 就算用户开完授权，也得刷新页面才会重新探测；这正是本笔要修的东西，不是授权没生效。
- 四件套：typecheck exit 0 / **65 files 820 tests** 全绿 / lint 0 error（25 warnings 全在基线）/ build exit 0（主 bundle `index-B3RG1_wD.js` 603.48 kB / gzip 188.50 kB）。另 `node crawler/selftest.mjs` exit 0。

### Added

- **本地助手会自检了，打包也有闸门了**（新 `crawler/agent/selfcheck.mjs` + `/health` 新增 `ready` / `problems` + 新 `scripts/build-agent-folder.mjs` + 卡片上直接显示「缺什么 / 怎么补」）。2026-10-03 用用户视角实测：桌面包把 `crawler/` 打了进去，却既没带 `extension/collector.js`、也没装 `playwright-core` —— 用户点一次「开始抓取」就是 0 条，界面还写着「常见的是站点改版或需要登录」，**方向完全相反**。现在三样（采集脚本 / 依赖 / 系统浏览器）在**点按钮之前**就显示在卡片上；`build-agent-folder.mjs` 最后会跑同一个自检，缺件直接非零退出，把「打包漏件」挡在发布之前。
- **网页端能一键抓取了 —— 本地抓取助手**（新 `src/lib/localAgent.ts` + `src/pages/Crawler.tsx` 的「一键抓取（本地助手）」卡片 + 新 `src/lib/__tests__/localAgent.test.ts` 12 条契约断言；`package.json` 加 `npm run agent` → 新 `crawler/agent/server.mjs`；接口契约单列 `crawler/agent/本地抓取助手_接口契约.md`）。原先「抓取任务」页只给一条路径：生成命令 → 自己复制到终端 → 等它跑完 → 手动导入，四步都得人手做，而这条路的失败面全在"人有没有照做"上。现在起 `npm run agent` 之后，页面探 `/health` → 勾站点 → 「开始抓取」→ 日志实时轮询回显 → 跑完自动弹导入预览 → 入库。**原来的「生成命令」一条都没删，降级为兜底**：助手没起、或有人就是习惯自己看命令，路径照旧走得通。契约测试钉的是字段名与类型（`id/name/needsLogin/verified/kwSearch`）、`state` 取值、以及三条错误分支：400 原样抛出契约文案、409 并发冲突要提示而不是静默失败、错误响应没有 JSON body 时退回到 HTTP 状态码文案（不能把 `undefined` 印到界面上）。
- **BOSS 直聘换引擎能真拿到数据了**（新 `crawler/engines/scrapling_boss.py` + `crawler/lib/engineScrapling.mjs`，可选引擎 `--engine scrapling`，底层 patchright 反检测内核）。同一账号同一页面实测：默认 Playwright 内核 HTML 只有 8.5KB 空壳、0 张卡片、登录页持续重载；scrapling 内核 HTML 221KB、岗位链接 17、**抓到 15 条**。两条边界照实写进站点表 notes 而不是藏起来：① 默认**不解字体混淆**（这是项目原有政策，不是这次的选择），要薪资得显式加 `--decode-salary`，实测不带 → 15 条薪资全空、带上 → 15 条薪资有值；② 需要 Python 环境（仓库外 `iwb-engines-venv`），**没装时只判停 BOSS 那一站、其余站点照跑**，整轮退出码非零并给出可照做的安装命令 —— 不整轮停（顺手多勾一站不该拖垮同轮其余几站）、也不静默跳过（那就是假成功）。
- **引擎由站点表声明决定，`--engine` 降级为显式覆盖开关**（新 `crawler/lib/routing.mjs` 纯函数 + 新 `crawler/__tests__/engineRouting.test.mjs` + `crawler/sites.mjs` 的 `engine` 字段）。会签结论是不做"隐式判断该用哪个内核"，改成**站点表里声明、运行时按声明路由**：`node run.mjs --site boss`（不带任何参数）会自动走 scrapling。**死规矩是「没声明就不路由」** —— 允许隐式判断等于退回"靠人记得"，那张表就白建了。真跑证据：一条命令混合两种内核、不带任何 `--engine`，整轮 exit 0；另一次故意让引擎批抛异常 ⇒ 非零退出，且汇总单列判停站名与原因。
- **「5 分钟上手」文档 + README 顶部改「3 秒看懂」**（新 `docs/上手.md` + `README.md` 重排 + `docs/images/` 5 张截图）。上手文档的骨架是「3 步看到东西 → 让岗位自己进来（一键 / 命令两条路）→ 9 个卡点的『症状-原因-怎么办』→ ASCII 架构图 + 四条岗位通道对比」；README 顶部把截图与痛点前置、技术栈下移。**卡点按症状写而不是按模块写**：找一个功能的人想起的是"我点了没反应"，不是"哪个文件负责这段"。
- **引擎环境缺失时的判停提示能照着做了**（`crawler/run.mjs` 的 `installHint({missing})` 两支）。原先提示里留 `<那个环境>` 这类占位符 —— 只有用户自己知道路径，等于把活推回去。现在**改成只在本机真探到解释器时才出现，并直接给出真实路径**（`set IWB_SCRAPLING_PYTHON=<真实路径>`）；探不到就整段不给 —— 按构造消除占位符，而不是靠人记得填。同批删掉旧的 19 行 `PYTHON_HINT`：两份提示文案必然漂移，只留一个来源。每个引擎目标还会打一行「引擎：scrapling —— 站点表声明 engine=scrapling，自动选用」，判停提示也区分「没 Python」与「有 Python 但缺 scrapling」两种，因为这两种该做的事不一样。

### Changed

- **`boss` 从 `offline` 翻成 `live`，站点表与网页端投影同批改**（`crawler/sites.mjs` + `src/lib/crawlSites.ts`，两处是镜像，只改一处等于没改）。翻的依据是引擎实跑通过，不是"看起来能用了"；`verified: 'live'` 的契约要求 notes 里写清实跑结论，所以这次是把实测数字一起写进站点表。`crawler/README.md` 的引擎节同时把 `--engine` 说明成**覆盖开关**（不再是必经步骤），`--help` 同步。
- **汇总新增一行「引擎构成」**（`crawler/run.mjs`）：`N 个目标中 M 个走默认内核、K 走 scrapling`。**全是默认内核时不打这一行** —— 默认值不需要解释，多打就是噪音。这条自曝一处覆盖度：该行只有单测钉住，没有再真跑一次混合批（再跑一次＝再打一次 BOSS + 冷却 90 秒，而这行的正确性不依赖站点）。
- **`docs/上手.md` 按新口径复核后收口**：offline 清单退回 5 站、登录那条路改认 scrapling 引擎、薪资段写明「默认不做；要做需要你明确选择」。字面与实现对齐，不是把文案往好处说。

### Fixed

- **退出码不再接受外部旗标 —— 一条「汇总写着判停、退出码却是 0」的静默不一致**（`crawler/run.mjs` `computeExitCode`）。根因是一面平行旗标：`anyStopped` 与 `results` 各自维护，命中安全停止清单时置了 `stopped` 却忘了置旗标，于是**汇总说这站停了、脚本却告诉调用方一切正常**。修法是按构造消除而不是补一次赋值 —— 退出码现在只能从 `results` 推导，没有任何外部旗标能影响它。同批把引擎中途异常从「降格成一句 warning」改成结构化 `fetch_errors`：否则「引擎挂了」和「这站今天就是 0 条」在退出码上同形。
- **`.gitignore` 补三行结构防护**（`__pycache__/`、`*.py[cod]`、`.venv/`）。新接的 Python 引擎会顺手产出字节码，而 `.venv` 是几百 MB —— 两者都是"只在某台机器上出现、在别人的机器上不会报错"的那类污染：等发现时已经进了历史。**用忽略规则而不是"记得别 add"**，因为后者依赖下一个人的记忆力。
- 四件套：typecheck exit 0 / **65 files 819 tests** 全绿 / lint 0 error（25 warnings 全在基线）/ build exit 0（主 bundle `index-CJfeBCC_.js` 602.72 kB，gzip 188.19 kB）；`node crawler/selftest.mjs` exit 0；站点表契约 11/11（`src/lib/__tests__/crawlSites.test.ts`，两份站点表逐项一致）、本地助手契约 12/12。

### Fixed

- **登录页点「发送验证码」后刷新页面就再也登不进去 —— 一个网络请求都不发**（`src/pages/Login.tsx`；版本升到 `0.8.16`）。验证码挑战原本存在模块级变量 `let pending = null`，这是个**活错生命周期**的内存：用户点「发送验证码」→ 收到码 → 刷新页面（或 SPA 重挂载）→ 填码 → 点「登录 / 注册」→ `submitCode` 命中 `if (!current)` **直接 return，一个请求都不发**，界面只给一句「请先为当前邮箱获取验证码」。用户刚刚才收到码，看到这句只会认为站点坏了，于是反复点同一个按钮，拿着有效验证码永远登不进去 —— 这是**线上真实用户会踩到**的一类 bug，而且症状完全指向错误的方向。改法：`pending` / `resetPending` 落到 `sessionStorage`（同标签页刷新不丢，换标签页仍丢 —— 验证码本就是一次性短时凭证，语义相符；无痕模式等 `sessionStorage` 不可用的场景退化回「只活这一次交互」，不阻断登录），并把那一句错误按「页面刷新过」与「邮箱改过了」两种情形拆开说。
- **扩展的卡片检测被 JD 正文篡位**（`extension/collector.js#findCards`）。实测美团校招页：`desc.hidden-ellipsis`（JD 正文，15 个）拿到 14973 分，真卡片 `position_list_item`（10 个）只有 9965 分，于是岗位名变成 JD 段落、城市/薪资/链接全空。根因是 `scoreCardGroup` 的主键 `n * 1000`：它本意是压住「卡内碎片数量更多」，但意味着**任何数量更多的组都能篡位**，`parentOversize` 那 20 分的差距填不平 5000 分的数量差。**没有走调阈值那条路**（那只是把门槛挪个地方），而是补一个方向明确的硬判据 —— **跨组包含**：真岗位卡片包含 JD 正文，反过来不成立。原有代码只做了组内包含过滤，这次补上跨组；某组多数元素被另一候选组包住就剔掉，全部被剔掉时退回完整候选，宁可退回旧行为也不给空结果。
- **公司名取成了行业分类与福利标签，实习僧 5/15 → 15/15**（`extension/collector.js`）。根因是 `COMPANY_HINT` 里的「软件 / 企业 / 教育 / 传媒」**同时也是行业词**，而真公司名（「清云智飞」「半鞅私募」）一个 hint 词都不含，反而落选。**第一版修法（只加 `CATEGORY_LINE` 挡掉行业分类路径）是错的**：挡掉行业分类后兜底分支改去捞福利标签，正确率没升、错误类型更杂 —— **只堵一个出口的修法是错的**。最终改成结构判据：找「同时含行业分类行」的最内层容器，其首行即公司名（实测 `.intern-detail__company` 的文本是「公司名 + 空行 + 行业分类路径」，而福利标签容器 `.intern-label` 里没有行业分类行），取不到才退回原词表启发式。**词表要穷举「什么像公司名」，结构判据回答的是「公司名和行业分类的相对位置」，后者不随文案变。**
- **扩展的 `__fixtures__` / `__tests__` 改名，让 Edge 能真正加载**（`extension/__fixtures__ → extension/fixtures`、`extension/__tests__ → extension/tests`）。`_` 开头目录是系统保留名，Chrome **静默忽略**、**Edge 硬报错** —— `Cannot load extension with file or directory name __fixtures__. Filenames starting with "_" are reserved for use by the system.`，README 写的安装步骤在 Edge 上必然失败，而只在 Chrome 上测过就发现不了。修法是**原地改名而不是搬家**：搬家要连带改 7 个夹具 HTML 的 `../collector.js` 相对路径与契约测试，改名只需同步 9 处引用，git 识别为 `R`，历史保留。
- **`boss` 从「未验证」降级为 `offline`**（`crawler/sites.mjs` + `src/lib/crawlSites.ts`，两处是镜像必须同步）。同一页面实测对比：Playwright（含真 Edge 内核 `channel:'msedge'`、抹掉 `navigator.webdriver`、换 UA 三种方案）→ HTML 8,496 字符的空壳、岗位链接 0、登录页持续重载；Scrapling（底层 patchright）→ HTML 221,756 字符、岗位链接 17、登录成功、抓到 15 条真岗位。根因线索是 BOSS 在页面里挂了 `browser-check-v2.js` 这类浏览器检测 SDK，所以「换内核、抹指纹、换 UA」都不够 —— **这不是优化，是能不能拿到数据的差别**。`offline` 会让它在站点选择器里置灰并排到最后，同时另三条硬约束写进 notes（必须 `headless=False`；必须串行 + 加延迟，连打会掉到 0 张卡片、冷却约 90 秒；`real_chrome=True` 需另装 Google Chrome）。仓库契约测试拦下三次错误改法且都拦对了：`verified` 只允许 `live`/`offline`/空串；标 `offline` 必须在 notes 里说清原因（判据 `/实跑|未验|只在本地夹具/`，「实测」不算）；`crawlSites.ts` 必须同步。
- 四件套：typecheck exit 0 / **62 files 779 tests** 全绿 / lint 0 error（24 warn）/ build exit 0。

### Changed

- **侧栏 14 项导航按「求职旅程」收敛为 7 区，旧地址一律重定向**（新 `src/lib/nav.ts` 作唯一权威数据源 + `src/pages/*Hub.tsx` 四个区壳 + `src/lib/__tests__/nav.test.ts`；版本升到 `0.8.15`）。原导航 14 项是按**功能**平铺的（岗位广场、抓取任务、AI 评估、网申填写包、提醒日历、项目教练、知识库……各占一格），用户要自己脑补「我现在该用哪个」。对标 Huntr/Teal/Careerflow 后改成按**旅程**收敛：`总览 / 岗位 / 投递 / 面试 / 决策 / 成长 / 目标条件`，每段一个入口，被合并的功能降级为区内 tab（岗位区四 tab、投递区两 tab、面试区两 tab、成长区三 tab）。**`NAV_MAIN` / `HUB_TABS` / `REDIRECTS` / `TITLES` 全部从这一个模块派生**，App.tsx 不再各写一份 —— 两份清单迟早一处新一处旧。**旧 key 一个都没删**（`square` / `crawler` / `ai` / `applykit` / `calendar` / `coach` / `knowledge`）：它们是用户浏览器地址栏里活着的书签，`REDIRECTS` 把 `#square` 送到 `jobs` 区的 `square` tab（其余六个同理），不是简单拍回首页。
- **修掉两个路由回归**（同批）：① `#square` 这类旧书签进入后**被 hash 规范化一脚踢回默认 tab** —— 重定向只在挂载时跑一次，而随后的 hash 写回覆盖了刚落的 tab，用户看到的现象是"打开旧书签，落到了总览"；② **浏览器后退键与页面脱节** —— tab 切换没进 history，后退键要么不动、要么一次退回站外。两处都是「页面内状态」与「地址栏状态」各走各的必然结果，改成地址栏为唯一真相、区内切换只写 hash。另：岗位广场的「去我的岗位池」原先做**整页跳转**（丢掉广场的筛选与滚动位置），改为区内 tab 切换。
- 四件套：typecheck exit 0 / **61 files 769 tests** 全绿 / lint 0 error / build exit 0。

### Added

- **AI 没接上的时候，总览页先说清三步，而不是等用户点了按钮吃一句抛错**（`src/lib/billing.ts` 新增 `BYO_SETUP_STEPS`、`none` 分支文案改为由它拼出；`src/pages/Overview.tsx` 首屏加一条提示卡 + `go('settings')` 入口；新 `src/lib/__tests__/aiSetupGuidance.test.mjs` 3 条 + `aiBilling.test.ts` 2 条）。起因是发起人定的口径：**AI 只走使用者自备的 Key，不开创建者试用**。这条口径下"被拒"是常态而不是故障，但原先那句拒绝只存在于 `streamChat` 抛出的 Error 里 —— 新注册的人不会先去设置页，他看到的现象是"这功能坏了"。两处刻意做成同源：指引与拒绝文案共用同一份步骤（改一份必红，测过：把 `.map` 摘掉立刻两条红），而指引点名的界面元素由一条源码级断言反向核（「AI 通道」卡、「自检一下」按钮、导航里的「目标条件」，改名不跟同样红，测过）。**没有做视觉验证**：看这一屏需要一个新账号，而注册要发一封真邮件（花他的额度），所以我证的是逻辑与挂载点，不是像素。- **线上跑的哪一版，现在一句话能问出来**（新 `scripts/appVersionPlugin.mjs` + `vite.config.ts` 挂载 + 7 条断言）。起因是核对那份发布记录时暴露的事实：`7feb9a7 → 5f2a30e` 只动了 `crawler/ extension/ CHANGELOG docs`，前端源码一行没动，于是产物文件名、字节数、内容**全与上一次相同** —— "已发新代码"和"还在跑旧产物"从线上无法区分。记录提议改用 `ETag` / `Last-Modified` 当判别器，而我实测那 12 分钟里没有任何新提交、mtime 照样被推前（沙箱重启也会改它；连抓 3 次值稳定，说明是一次真重建），**时间型证据不能当发布判别器**。现在把 `package.json` 的 version 注进 `dist/index.html` 的 `<meta name="app-version">`：`curl -s <线上>/ | grep app-version` 一步到位。两个刻意的做法：版本号只有一个来源（配置里出现任何版本字面量就红 —— 写死的标记升级后会变成假话，比没标记更坏）；空版本号与「模板里没有 `</head>`」**都直接抛**，不静默跳过，因为静默跳过的症状正是"grep 永远命中不了而没人知道为什么"。6 个变异体（不注入 / 只在 serve 生效 / 空值不抛 / 缺 head 静默返回 / 配置没挂插件 / 版本号写死）全部被杀，其中"空值不抛"经人工复核确认 —— 变异运行器把它报成存活，是运行器读到旧文件的竞态，不是断言没守住。**版本同步升到 `0.8.1`**：标记的值就是 `package.json` 的值，不升版的话线上那一行只能证明"跑的是带标记的构建"，证明不了是哪一代。
- **两个 agent 的交接改成一个有产物的协议**（新 `docs/sync/README.md` + `docs/sync/INBOX.md`）。背景：这个仓库同时有 Qoder 与 WorkBuddy 在改，而**直连实测不存在** —— Qoder 的会话列表里没有 WorkBuddy；它的本地日志只有调用帧没有正文（拿 CI 关键词跨全部日志搜，零命中）；未识别的本地端口不去请求（那是以发起人身份行事）。所以走文件，而且每条必须带**能反证它的命令**与**取数时刻的原始输出**。五条规则全部来自当天真实翻车：`三方对齐在 dc85da6` 说出口时已不成立（一小时内 0.8.4→0.8.5、master 又前进一次）→ 规则 1「先取数再写」；「CI 首次全绿」我读不到 → 规则 2「写不出 falsify 就只能标 `转述待证`、不得引用为已证」；我那句「不另升版本」前提作废 → 规则 4「写错保留原文加更正，不抹」；我建这个文件时把 `#2` 写成「WorkBuddy → Qoder」的条目、**替对方起草了主张** → 规则 3 补上「一个条目只能由它的作者写」，并把该条改成 `Qoder 记录（引 commit 4da1190，非 WorkBuddy 所写）`。第一条正式内容就是自我纠错：`0b9da0b` 那份转公开预检**漏检了邮箱本地段**（我扫的是带 `@` 的邮箱模式与 `1[3-9]\d{9}`，而 ``printf '2088%s' '417049'`（拼开写，理由见 `docs/sync/INBOX.md` #4 的 re:）` 两条都不命中，`4da1190` 才抓到）—— 转公开前须用扩后的 IDENTITY 重跑预检，并连 **git 历史**一起扫。

### Changed

- **仓库数字口径从 508 对齐到简历现行的 518**（`constants.ts` / `miniprogram/utils/constants.js` 的 `GREETING_RULES`、`healthCheck.ts` 体检文案、`AiLab.tsx` 与 `ApplyKit.tsx` 提示、`AGENTS.md` §2.2、`crawler/__tests__/contract.test.mjs` 的 `PARTS` 白名单、`src/lib/__tests__/factGate.test.ts` 口径夹具——共 8 处；版本升到 `0.8.14`）。起因是架构专家团交付物的裁决 X1（2026-09-29 G4，发起人已点头）：**518 = 156 + 71 + 79 + 48 + 129 + 35 为唯一权威** —— 简历 2026-09-25 复核后主项目 python-learning-agent 由 146 升到 156，而仓库还在输出 508，HR 一 `git clone` 就对不上，是一条不报错的静默不一致。**交接单 §14.3 的 7 处清单漏了第 8 处**：`factGate.test.ts` 的夹具画像仍写着 146/508 —— 守门器的白名单来自那份夹具，不改的话话术按新口径说「518」会被事实守门当成违规拦下来；教训照旧，动手前全仓 grep，别只按清单改。跨端契约测试的 `PARTS` 与小程序端同一条规则**两端一起改**。四件套：typecheck 0 错 / **60 files 764 tests**（基线不变：改的是夹具内容，不是断言数量）/ lint 0 error / build 过。
- **模型名从「只能手打」改成「点一下就选」**（`src/pages/Settings.tsx` + 新 `src/lib/__tests__/settingsModelPicker.test.mjs` 8 条断言；版本升到 `0.8.13`）。发起人看界面时指出的：「你只能自己填模型名，你不能自己选模型嘛，那种常见的模型。」**名单本来就在代码里** —— `aiChannels.ts` 每个厂商都有 `models: string[]`，那个字段的注释写的就是「（前端下拉用…）」，而界面从头到尾只把它拼进了一句提示文字：「表里列了 deepseek-chat / deepseek-reasoner，也可以填这一家的其他模型名」。于是想换模型的人得先读那句提示、再手动把名字抄进输入框；换个厂商还得回厂商文档里查。**数据早就有了，缺的只是给人点的地方。** 现在「模型名」字段里先是一行候选 chip（点一下＝选中并**立刻记下**，不用再点「记住模型名」），下面仍是原来那个手填输入框。**刻意没有做成只读下拉**：新模型、预览版、自建别名、OpenRouter 那种 `vendor/model` 组合名都不可能穷举，而模型名不影响请求发给谁（只有主机影响，见 `aiChannels.ts` 文件头第 1 条），手填是安全的 —— 表里的名单是「常见」，不是「允许」。两条配套：候选的高亮与下面「当前会用：」那句**共用一个 `modelInUse`**（草稿优先），不再各算一遍；点候选时**连草稿一起改写**，否则输入框里那条旧文字会盖住刚选中的值。**没有做视觉验证**（像素层面）：我没法在这台机器上登进创建者账号看那一屏，证的是源码结构与产物内容（bundle 内新提示 1 命中、旧提示 0 命中、八个候选名逐个在产物里）。

  **自己踩的一个坑，记下来因为源码级断言完全看不见它**：第一版新函数也叫 `pickModel`，而 `pickModel` 是从 `../lib/ai` **import 进来的**（平台额度档选模型，`Promise<string | null>`）。局部同名声明把它整个遮蔽，第 130/321 行的调用点于是变成「传 0 个参给一个必填 1 个参的函数」—— **新加的那 7 条源码级断言一条都没红**，是 `npm run typecheck`（`TS2554 Expected 1 arguments, but got 0` + `TS2339 Property 'then' does not exist on type 'void'`）抓到的。改名 `pickByoModel`（与 `saveByoModel` / `getByoModel` / `setByoModel` 同族）后补了一条专守这个的断言：`function pickModel(` 在文件里出现 **0** 次、`pickByoModel` 必须存在、import 里的 `pickModel` 不许被删。9 个变异体全部被杀（删候选行 / 不落库 / 不写草稿 / 改成 `<select>` / 名单拼回提示 / 「当前会用」自己算 / 高亮失效 / 改回遮蔽名 / 删 import），各自红在**对应**的断言上，每个还原后 `cmp` 逐字节一致。四件套：typecheck exit 0 / **60 files 764 tests**（756 → 764）/ lint 26 warn 0 error / build exit 0。
- **注册改成默认开放（同一天推翻了自己上一版的做法）**：`registration.ts` 出厂从"新邮箱一律要邀请码"改成"开放注册"，
  名单里一旦填了真码才自动变成要码（一个旋钮，不留两个会互相矛盾的开关）。原因是账算错了：那道门的理由是
  "陌生人注册进来会烧创建者的额度"，而自备 Key + 计费门落地之后，AI 默认花使用者自己的钱、创建者那一档既默认关
  又只认创建者账号——开号本身不再产生创建者成本；留着码的代价变成"每加一个用户创建者都要亲自发一次码"，
  正好挡在做这个产品的目的上。**花钱的几道门一律不动**：计费门默认拒绝、试用开关只认创建者账号、
  每人每天 20 件事 / 单件事 8 步 / 全天 60 次照旧。仍然开着的两个真实成本都不花钱但会脏：验证邮件额度（套餐上限）、
  岗位广场公共库的写入（注册者可投稿）——被灌了就先上锁再清表，一句话可逆。
  - **更正（2026-09-28，按发起人问"能不能开源"重新核代码时抓到）：上面那半句是假的。**
    `jobs_public` 根本没有任何用户态写路径：`db/exec/004_schema.sql` 只给了
    `GRANT SELECT ON TABLE public.jobs_public TO authenticated, anon`，005/006 只挂了一条 `jobs_public_read_all`
    **读**策略，`src/lib/api.ts:62` 只有 `listRows('jobs_public')`，而 `JobsSquare.tsx:319` 页面自己就写着
    「所有人可读、无人可写」；入库走的是 owner 手执行的 SQL（`db/exec/014`、`016_seed.sql`）。
    ⇒ 结论跟着改：**开放注册对公共库的污染风险 = 0**，"仍然开着的真实成本"从两条变成一条
    （只剩验证邮件额度）。原文留着不抹 —— 这句话是当天写给发起人做发布决策用的，写错的代价是
    他可能因此去做一件并不需要的"上锁"动作。
- **「一键填入模板」的映射从组件里抽成纯函数，因为弱断言盖不住它**（新 `src/lib/profileFill.ts` + 7 条断言；`Settings.tsx` 的 `fillTemplate()` 改为调用它）。触发点是外部工具的一次增量分析，它对今天的改动报了「`fillTemplate` 未测试」。那个信号一半是类别错位 —— 这仓库 `environment: 'node'`、没装 jsdom、**0 个测试引用页面组件**，所以每个组件函数在它的定义下都算未覆盖；另一半是真的：我上一轮为这条逻辑写的断言是**源码正则**（`/notifyOk\([^)]*【[^)]*替换/`），它只能证明文件里还有那串提示语，**证明不了函数产出的表单状态里没夹带别人的身份**。抽成纯函数后可以逐字段断言输出：21 个键齐全、身份字段是【】占位、联系类字段一律空、数字字段落成空串。其中最有用的那条钉的是 `expect_daily` —— 保存路径是 `form.expect_daily ? Number(form.expect_daily) : null`，所以只有空串会存成 `null`：填占位文本会存进 `NaN`，填 `String(null)` 会存进字面量 `"null"`，两种都不会有人当场发现。5 个变异体（退回 `String(null)` / 预填发起人 GitHub / 身份字段换成真实姓名 / 少产出一个键 / 节奏默认值被改）全部被杀。**这次要升版本，理由是我先写下了一句错话**：原稿写的是「行为不变，不另升版本，搭同一个 `0.8.2` 构建」，而前提是假的 —— `0.8.2` 从未上线，线上当时已经是 `0.8.3`（不含这次改动）。不升版的话 `app-version` 分不出这两代构建，标记就失去意义（实测：线上 bundle `index-D_NrNBsL.js` vs 本地 `index-tf87k1iO.js`，哈希与文件名都不同）。所以升到 `0.8.4`，锁文件同步。测试基线 **716 → 723**（54 → 55 个文件）；rebase 到远端那 4 个提交之上后合计 **729 条全绿**。

### Added

- **自备 Key 真的能用了 · 浏览器直发**（新 `byoSend.ts` + `aiChannels.ts` 按实测重排 + `ai.ts` 的 byo 分支）：上一轮计费门只是"不肯花创建者的钱"，这一轮才把"花自己的钱"这条路接通。2026-09-27 实测 `access-control-allow-origin`：`api.deepseek.com` / `api.moonshot.cn` / `openrouter.ai` / `dashscope.aliyuncs.com` 四家浏览器可直发，`open.bigmodel.cn`（智谱）两条路径都不带 ACAO → 标成 `browserDirect:false`，界面据实说"现在发不出去"，而不是发一条注定被 CORS 挡掉的请求让用户以为是自己 Key 的问题。**Key 只在「用户设备 ↔ 厂商」之间流动，本项目服务端一次都碰不到**——少一跳就少一处泄露面。发送前仍再过一次白名单（`findPreset` 与 `assertForwardTarget` 共用同一条匹配规则，"谁能被发到"写两遍迟早一处严一处松），Key 只进鉴权头，厂商错误体**全部脱敏后**才进文案（401 的响应体常回显 Authorization，而用户会截图问人）。新增**本机 Ollama 档**：不花钱、不需要 Key，代价是 https 规则开一个例外，所以例外小到只剩 `127.0.0.1:11434`（端口钉死、只 GET 模型列表算探活）。
- **设置页能真的把 Key 配上**（新 `byoSetup.ts` + `Settings.tsx` 的「AI 通道」卡）：厂商选择、Key 录入、模型名、自检按钮、"谁付钱"那句话。三条刻意的做法：Key 输入框永远从空开始、存完立刻清空，界面只剩头尾掩码（回填一次等于把 Key 交给 DOM、截图与录屏）；「已配置 / 发得出 / 谁付钱」全部取自纯函数，页面不自己拼规则；自检分两种——本机档只 GET 一次模型列表（不花钱，且把探活结果**写回计费门**），远端厂商发一条 `max_tokens:4` 的非流式请求，点之前就把"会花你自己账户的零头"写在按钮旁边。另加 `byoHygiene.test.mjs`：从源码目录**推导**出"谁能读 Key 原文"，多一处读取点就红。
- **公网注册收口成邀请码**（新 `registration.ts` + `Login.tsx`）：站的地址公网可达，而登录页原先写着"无需单独注册，首次使用自动创建账号"——任何人拿到链接都能开号，然后每次 AI 都记在创建者额度上。账号只在 `verifyOtp(isExistingUser:false)` 那一步产生，门就装在那一行之前。占位符**永远不算可用码**，出厂名单只有占位符 = 谁都注册不进来（含创建者自己）。边界照实写进 README/FAQ/界面：这挡的是从界面进来的路人，服务端 sign-up 那一半只能创建者在云控制台动（本构建连数据库管理工具都没挂载，所以名单只能放源码）。
- **小程序同名计费门**（新 `miniprogram/utils/billing.js` + 挂进 `utils/ai.js`）：这一端**没有**自备 Key 那条路（`wx.request` 的域名要在小程序后台逐个白名单，厂商域名不归本应用所有），所以默认拒绝；而 `ownerTrial` 那个 flag **故意不做成界面开关**——小程序里任何使用者都能翻它，等于把创建者的钱包放在台面上。给普通使用者的那句话指向网页端。
- **试用开关只认创建者账号**（新 `ownerAccount.ts`）：修上一轮自己留下的洞——"用本应用的额度试用"原先无条件摆在设置页，任何登录使用者都能勾上。现在只在 `isOwnerAccount(会话邮箱)` 为真时显示，且 `toggleTrial` 写存储前**再判一次**（界面是入口不是授权）。`OWNER_EMAIL` 出厂是空串 = 谁都不算创建者，与邀请码同一套"没配置就是关闭"。
- **邀请码生成器**（新 `invites.ts` + `npm run invites`）：字符集剔掉 `0 O 1 I L`（邀请码要人抄、人念），形状固定 `WB-<年>-<8 位>`，同批去重、随机源坏了直接抛而不是悄悄发重复码，并直接印出**可以替换那一行源码**的代码。跨模块断言：从那一行反解出名单喂回 `signupGate`，结论必须一致——否则"发出去的码进不了门"这类错是静默的。
- **小程序端的限额台账**（新 `miniprogram/utils/quota.js` + 挂进 `utils/ai.js`）：那一端有计费门却没有上限——创建者一旦在开发者工具里把试用 flag 打开，小程序就是"不限次烧创建者额度"。现在补上同一套三道闸（每天 20 件事 / 单件事 8 步 / 全天 60 次），数字由跨端契约测试与 `src/lib/quota.ts` 钉成一模一样；`taskSubject()` 同规则（任务名带对象，批量看几个岗位不会共用一个 8 步桶被误杀），台账坏了照样是 fail-open 但 `degraded` 可见。
- 测试基线 **538 → 669**（40 → 50 个测试文件），提交信息里逐轮记录增量与变异检查实况。**顺手修了一个真的洞**：`vitest.config.ts` 的 include 里原本不含 `miniprogram/**`，也就是那个目录下的测试**从来没被执行过**。

### Fixed
- **模板里的「示例年」就是发起人自己的届数**（`src/lib/constants.ts` + `miniprogram/utils/constants.js` + 新断言 1 条；版本升到 `0.8.12`）。这是下一条的**漏项，也是我自己扫出来的**：修完 `gapPlan.ts` 之后我拿线上 bundle 复扫了一遍「还剩几处 20xx 届」——`你是 2028 届` 确实 0 命中，但还剩 **1 处**，落在 `PROFILE_TEMPLATE.grad_year: '【毕业届，如 2028 届】'`（线上 `assets/index-LaNq7BGX.js` offset 296070），而 2028 正是发起人的届数。**为什么它躲过了全部既有断言**：`0.8.2` 装的守门词表 `IDENTITY` 是「姓名 / 学校 / 张家界 / GitHub / 作品集 / 邮箱本地段」，**年份不在里面**；而另一条断言只要求身份字段带【】占位符 —— `【毕业届，如 2028 届】` 两条都满足，于是这个串一路编进了产物。它比 `gapPlan` 那句轻（那是对着读者断言「你是」，这只是一种格式示例），但标准是同一条（HANDOFF §11b：有公开注册的站，渲染文案不写死发起人个人事实），所以一并改：`【毕业届，四位年份 + 届】` —— 保留填写口径（四位数字 + 届）而去掉具体年份，与同级 `school` / `expect_city` 的写法一致（那两个字段本来就不给例子）。两端模板同源，**必须同时改**（既有断言里有一条专门守「小程序那份容易只改一边」）。新断言扫两处：src 的 `templateStrings(PROFILE_TEMPLATE)` 与 `miniprogram/utils/constants.js` 全文，都不许出现 `/20\d{2}\s*届/`。**双变异核对**：把 src 那份改回 `如 2028 届` → 红在「模板示例里写了具体届数」；把小程序那份改回 → 红在「小程序那份模板里还写着具体届数」；两个变异体被**不同**断言杀，各自还原后 `cmp` 逐字节一致。四件套：typecheck exit 0 / **59 files 756 tests**（755 → 756）/ lint 26 warn 0 error / build exit 0。**为什么又升一次版**：`0.8.11` 已经上线，而这个串还在那份产物里，不升版 `app-version` 就分不出「还带着示例年的构建」和改好的构建。
- **「目标条件」页的待确认清单替每个用户断言了发起人的届数**（`src/lib/gapPlan.ts:54` + 新断言 1 条；版本升到 `0.8.11`）。同一类问题换了个位置：`0.8.2` 那次是**出厂画像模板**把发起人身份灌给陌生人，这次不是模板而是**渲染文案**——`CONFIRM_RULES` 第六条在 JD 提到届数时输出「JD 提到届数/毕业年份，核对是否限定（**你是 2028 届**）」。这不是模板默认值，任何用户只要粘一份带「面向 2028 届」的 JD，页面上就会有一句以第二人称对他断言发起人的毕业届。改法是中性化（「对照自己填的毕业届」）而不是从画像读：`PROFILE_TEMPLATE` 去个人化已是既定方向（HANDOFF §11b：有公开注册的站，渲染文案不写死发起人个人事实），何况这是一份给所有人看的核对清单，中性表述对发起人本人也无信息损失。**同族只改这一条**：六条 `CONFIRM_RULES` 里只有它断言了用户的具体事实，`:51` 那句「核对你的可实习周期」是通用第二人称，留下。守门断言刻意做成两截：把六条规则全部命中（`confirm.length === 6`）保证每条文案都被看到，再逐条断言不含 `/20\d{2}\s*届/`——**条数本身也是判据**，将来有人加/删规则而没同步，数量断言先红。变异核对：把文案改回旧句 → `1 failed | 9 passed`；还原 → `10 passed`。四件套：typecheck exit 0 / **59 files 755 tests**（754 → 755）/ lint 26 warn 0 error / build exit 0。
- **上一版我把发起人的真实邮箱写进了给用户看的示例文案**（`src/lib/email.ts` + `profileTemplate.test.mjs` 的 IDENTITY 收口；版本升到 `0.8.6`）。0.8.5 里那句兜底文案写的是「邮箱格式不对，请填完整地址，例如 〈发起人邮箱〉」，而它是**编进前端产物的** —— 实测线上 `assets/index-BrQBKmBl.js` 里 `grep` 得到该串 1 次，任何人打开站点就能读到。与 0.8.2 那次同源（出厂模板带发起人身份），只是换了个位置：上次在模板字符串里，这次在错误提示的示例里。这不是设计取舍，是**发完自己复核时才发现的** —— 上一轮的止血复核清单里恰好有「live bundle 内发起人身份各 0 命中」这一条，而它当时报了 1 命中，是清单抓住了我。修：示例一律改成 `example@qq.com`；测试夹具里的真实邮箱也换成中性串；**把该邮箱前缀加进 `profileTemplate.test.mjs` 的 `IDENTITY`**，于是既有的「产品代码里不得出现身份标记」全仓扫描顺手把它也守住了（一处加词，覆盖 `src` 与 `miniprogram` 两块）。守门断言做了变异核对：把示例改回真实邮箱 → 立刻红在那条全仓扫描上。为什么升版本：`0.8.5` 已经**上线过**，不升版 `app-version` 就分不出"带泄露的构建"和"修好的构建"——而这正好是这个标记存在的理由。
- **登录页把服务端的正则原文抛给用户：邮箱框里填了纯数字，界面上出现的是一串 pattern**（新 `src/lib/email.ts` + `Login.tsx` 的两个提交入口 + `cloud.ts#errText` 一律过一遍转译；版本升到 `0.8.5`）。实测触发（2026-09-28）：邮箱框里只填了纯数字（漏掉 @ 与域名）点「发送验证码」，界面上直接出现 `invalid SendVerificationCodeRequest.Email: value does not match regex pattern "^[^1][0-9A-Za-z_]{1,40}@[0-9A-Za-z_]{1,40}\.[A-Za-z]{1,10}$"` —— 用户看到的是一串正则，而不是「你少填了 @ 和域名」。输入框虽然写了 `type="email"`，但它不在 `<form>` 里（发送验证码是 `type="button"` + `onClick`），浏览器原生校验根本不触发，等于形同虚设。两层修：① `sendCode()` 与 `loginWithPassword()` 提交前过 `emailProblem()`，其中「缺 @」这一支要**把建议补全**（纯数字输入 → 提示里直接给出「它 + `@qq.com`」），只回一句"格式不正确"等于让用户去猜；② `errText()` 全部过 `humanizeCloudError()`，把 `regex pattern` 这类上游原文按字段翻成人话（email / code / password / 其余），**认不出的原样透出** —— 宁可显示英文，也不编一个可能不对的原因。前端刻意**不比服务端更严**：判定权在服务端那条正则，前端只负责在明显错误时给一句能看懂的话，合法写法（`a_b-1@sub.example.com.cn`、`first.last+tag@gmail.com`、从别处粘贴时前后带空格）一律放行。测试基线 **729 → 737**（55 → 56 个文件），三个时区（UTC+8 / UTC / UTC-4）各 737 全绿。变异核对：摘掉 `emailProblem()` 的「缺 @」分支 → 立刻红在那条"建议必须补全"的断言上（红在正确的地方，不是随便红一条）。**为什么升版本**：这一版前端产物确实变了（线上 `index-D_NrNBsL.js` → 新版），不升版 `app-version` 就分不出这两代构建。
- **时区守卫装上的第一次运行，就抓出同一类 bug 的第二批**（`followup.ts` / `pace.ts` / `companyHistory.ts` + 4 处测试夹具）。同一行代码模式：`new Date(纯日期串或时间戳)` 按 **UTC** 解释，却用 `getDate()` / `setDate()`（**本地**口径）去取日 —— UTC+8 与 UTC 都恰好正常，整个西半球会整体差一天。具体错在哪：`followup.ts#plusDays` 把「招呼后 4 天该催」算早一天（`'2026-09-20'` 在 UTC-4 被读成 09-19 20:00，`+4` 得 09-23）；`pace.ts#staleApplications` 对 `sent_at` 这类**时间戳**取的是 `slice(0,10)`（UTC 日），于是同一条沟通在「跟进节奏」显示 09-25、在岗位池列表显示 09-26；`companyHistory.ts` 的「距上次联系 N 天」比的是"离今天零点几小时"而不是日历日。**四处夹具也是同一个毛病**：`format.test.ts` / `pace.test.ts` 的 `iso()` 小工具（`new Date(todayISO())` 是 UTC 零点，再 `setDate` 用本地口径）、`quota.test.ts` 的 `NOW = new Date('2026-09-26T10:30:00+08:00')`、`miniprogram/__tests__/quota.test.mjs` 的 `DAY`（绝对瞬时在 UTC-4 落到前一天，与硬写的 `day: '2026-09-27'` 全部对不上，8 条断言跟着红）。夹具改成按**本地日历日**构造，理由与产品代码同一条。**还抓到我自己刚写的一条断言有问题**：`daysFrom` 那条本来硬编码了 `'2026-09-23T12:00:00Z' → 0`，而这个瞬时在 UTC+12 已经是次日 —— 硬编码「时间戳的本地日」等于在测时区，改成只断言"与它本地日历日算出来的一致"。**测法本身也踩了一个坑，写在这里免得下次再踩**：Windows 上的 Node 只认 **POSIX 形式**的 `TZ`（`EST5EDT` / `GMT+12` 有效），`TZ=America/New_York` 这类 IANA 名会被**静默忽略**、回落到系统时区 —— 我第一轮"三个时区各 721 全绿"里的纽约那次其实是 UTC+8，是真的假绿，只有 CI 的 Ubuntu 认 IANA 名。最终口径：**13 个时区配置逐个跑全量**（偏移从 UTC-14 到 UTC+14，含 UTC-4/-8/-10/-11/-13/-14 与 +10/+11/+12/+13/+14），各 722 条全绿；`America/New_York` 与 `Asia/Shanghai` 两遍留在 CI 里常驻。
- **「剩 N 天」两端差一天：Web 端拿原始瞬时相减，小程序按本地日历日**（`src/lib/format.ts` 新增 `parseDate`；`daysLeft` / `daysFrom` / `recentDays` 改用同一条规则；版本同步升到 `0.8.3`）。契约测试钉的「Web ↔ 小程序 `daysLeft` 两端同结果」在 CI 上红了四轮，而**本机（UTC+8）716 条全绿** —— 8 小时偏移正好把两侧偏差抵消成一个假绿：`2026-09-25T16:00:00.000Z` 在 UTC+8 已是 09-26 的 0 点，小程序端算「已过 3 天」，Web 端拿原始瞬时 `Math.round(-2.33)` 得「已过 2 天」。库里 `deadline` 走日期控件写的是纯日期串（不受影响），但 `next_action_at` 这类带时间的字段会直接改变「剩 N 天」与「3 天内截止」两个用户可见判定。修法不是"补一次隔离实验"，而是把**解析规则收敛成一条**（小程序端本来就是这条，Web 端改过来）：纯日期串按**本地零点**构造（`new Date('2026-09-25')` 按 ISO 规则是 UTC 零点，整个西半球会退回前一天），带 `Z`/偏移的时间戳交给 `new Date` 保留时区语义。**同一个根因捎带修掉三处**：`fmtDate`/`dateOnly` 在西半球差一天、`recentDays` 用毫秒加减（跨夏令时的时区里会跳号或重复）、`src/lib/daily.ts#daysFrom` 取的是时间戳的 **UTC** 日期部分（同一份 deadline 在「今日优先」页与岗位池列表算出的紧急度不一样，且谁都不报错）；连测试里那个 `iso()` 小工具本身也是这个毛病（`new Date(todayISO())` 是 UTC 零点再 `setDate`，西半球下 `daysLeft(iso(0))` 会变成 -1）。**CI 加时区守卫**：每个时区各跑一遍整个套件（`America/New_York` + `Asia/Shanghai`），断言写进 `ciTrigger.test.mjs` —— 这次的教训恰恰是「本地全绿没有证明力」，而 UTC+8 与西半球各藏一半问题（前者把两端偏差抵消、后者才暴露 UTC 解释）。**双向变异核对**：Web 端 `daysLeft` 改回原始瞬时 → UTC 红 3 条（含契约测试）；`daysFrom` 改回 `slice(0, 10)` → UTC+8 红 4 条；两个变异体都被杀，且是被**不同**断言杀的。测试基线 **716 → 721**，三个时区各 721 全绿。
- **CI 一次都没跑过，而症状是静默的**（`.github/workflows/ci.yml` + 新 `src/lib/__tests__/ciTrigger.test.mjs` 3 条断言）。触发器写的是 `branches: [main]`，而这个仓库远端**只有 `master`**（`git ls-remote --heads origin` 只有一条 `refs/heads/master`，`origin/HEAD → origin/master`）—— 于是 push 永远不命中触发器，四道门从未在 CI 上执行过，而 Actions 页面不会变红、只会一直空着，本地全绿把这个洞盖得严严实实。改成 `branches: [main, master]`（不改分支名：改名会牵动发布源目录与已分享链接，收益不抵代价）。断言用 YAML 解析式取列表并**先剔注释行**（第一版没剔，我自己加的那段解释注释把解析器挡死了，报的是"没解析出分支列表"而不是假绿 —— 那条 `length > 0` 自检就是为了这一刻存在的）。4 个变异体（去掉 test 步骤 / 产物缺失不报错 / push 只留 main / 分支列表解析为空）全部被杀。**这条修复本身能不能让 CI 真跑起来，我读不到**：私有仓匿名 API 返 404、会话里没有 `gh`，所以只能由他到 Actions 页面确认首次运行。


- **抓取器真跑之后才暴露的三件事**（`crawler/run.mjs` / `crawler/sources/offerbiu.mjs` / `extension/collector.js`）。这三条都是「离线全绿、一跑真站点就露馅」的type，所以每条都留了一个能反复跑的证据：
  1. **CLI 入口不可测**：`run.mjs` 结尾是无条件的 `main()`，测试文件一 `import` 它就把浏览器拉起来跑一遍真抓取。改成 `pathToFileURL(process.argv[1]).href` 比对的入口守卫（不手拼 `file://`，Windows 上会少一道斜杠变成静默不执行），`writeOutput` 一并导出，日报的 4 条断言因此能恢复回来。
  2. **详情页 JD 静默为空**（实习僧）：`extractDetailPage` 用 `querySelector('main, article, .content, ...')` —— 逗号选择器**第一个命中就用**，而实习僧把 `main` 给了一条 19 字的面包屑，JD 挂在不认识的 class 上；抓回来的 19 字比列表摘要（125 字）还短，又被 `hydrate` 里那句 `detail.raw.length > job.raw.length` 静默丢回去，最终表现是日志一句「补全 0 条 JD」、零报错，用户分不清是站点没正文还是选择器坏了。两处一起改：容器改成**候选里取最长**，一个都装不下东西时才退回整页（刻意不与整页比长度——夹具和扩展会在 `body` 末尾挂一段结果 JSON，一比倍数就永远选整页）；合并判定与汇报抽成 `adoptDetail` / `hydrateReport` 两个纯函数，落空必须带原因和条数，`0/plan` 直接报 ⚠️。新增 2 个详情页夹具（陷阱页 / 多容器页）分别钉住「退回整页」和「取最长」，`npm run selftest` 51 条断言。**实跑核对**：`--site shixiseng --keyword Agent --detail 3` 从「补全 0 条」变成「补全 3 条」，`raw` 125 → 1155 字，职位正文真的在里面（该站薪资与标题的字体反爬另计，不在这条里）。
  3. **OfferBiu 一条记录塞多个岗位**：一家公司挂「算法 / 开发 / 测试 / 产品」四个方向时按一条产出，标题栏写着一串岗位名，导入进去就是一个岗位池条目投四个方向。新增 `splitPositions`（分隔符**刻意不含斜杠**，`算法/开发` 是一个岗位不是两个），0 段原样、1 段清洗标题、多段拆成一条一岗。**实跑核对**：同一份上游数据 20 条记录 → 241 个岗位。
- **列表页的字体反爬把干净数据压掉了**（`crawler/lib/normalize.mjs#mergeDetail` + `extension/collector.js#extractDetailPage`）。起因是问「换 Scrapling 能不能爬实习僧」——查下来它给的是过 403 的隐身抓取和「改版后自动重定位元素」，**没有任何私有区/自定义字体解码能力**，而这两件我们都已经不缺（浏览器一开就读到了），所以换框架不会让乱码变干净。真正的病灶在**我们自己的合并优先级**：`mergeDetail` 是「列表优先、详情只补空」，而实习僧列表页的标题是 6 个私有区空框、公司名读成「互联网/游戏/软件/…以上」，详情页那一份却是干净的（`Agent策略实习生` + `百度`）——乱码把干净数据压掉了。现在先挑**干净的一侧**（含 `U+E000–U+F8FF` 一律算不可信），两边都脏才保留列表那份，不做「谁长取谁」的猜测。另外这类页面没有 `<h1>`，岗位名与公司的**唯一**来源是 `<title>`（格式「{岗位}实习招聘-{公司}实习生招聘-{平台}」），所以补上分段与样板词剥离；顺带钉住「公司段在前的招牌式 `<title>` 不能把公司名当岗位」和「页面上压根没公司名时**宁可不给**，也不把平台名（智联）写进去」。实跑核对：同一批 4 条，公司 `百度 / 跨赴科技 / 原力金智 / 网易有道`、岗位 `Agent策略实习生`…，**带乱码字段 0 条、公司名空 0 条**，薪资 3/4 有条目 —— 这一站从「只能本地看」升级到「可以导入」。**没解的**：私有区映射本身不去逆向（那是破对方的保护措施，不在边界内），所以列表页 `raw` 里仍有 17~19 个空框字符。
- 测试基线 **672 → 694 → 697**（50 → 51 个文件，`crawler/__tests__/dailyReport.test.mjs` 是那个新文件）；真浏览器夹具自检 **51 → 59 条**（`cd crawler && npm run selftest`）。这一轮打了 22 个变异体：字段判定与 `<title>` 解析 9 个（含一个**存活后被我删掉的死守卫** —— 第一段解析里的平台名判断在真实站点上永远不触发，删掉比留着一个测不红的守卫诚实）、JD 补全那条链 13 个，**最终全部被杀**，逐条对应哪个断言红在提交信息里。
- **出厂模板把发起人的身份灌进每一个陌生用户的画像**（`src/lib/constants.ts` + `miniprogram/utils/constants.js` + `src/pages/Settings.tsx` + `miniprogram/pages/me/me.js` + 新 `src/lib/__tests__/profileTemplate.test.mjs` 8 条断言）。起因是问「私有仓能不能直接转公开」——扫密钥时扫出来的，但**它跟仓库公不公开无关，线上站点当时就能点到**：`PROFILE_TEMPLATE` 里是发起人的真实姓名、学校、GitHub、作品集、自我介绍与「5 个项目 / 6 个仓库 / 508 条测试」口径，而「一键填入模板」是任何注册用户都能点的产品功能，点完的提示还写着「请补手机号与邮箱后保存」——等于邀请陌生人把发起人的身份存成自己的画像，之后的打招呼话术、AI 分析、简历生成全部以他的口吻输出。两端模板一律改成【】占位（没替换就保存，产物里会明晃晃露出方括号，而不是悄悄变成另一个人）；数字字段留 `null`——填数字等于替别人定死期望日薪，而 `Number('【…】')` 还会变成 NaN 存进库；`github` / `portfolio` 的硬编码链接清空。**边界刻意划清**：清理只动出厂默认值，作者署名一律不动（`LICENSE` / `README` / `docs` / 测试夹具里剩的 14 处命中是该留的，有断言守着别被"顺手清干净"）。顺带把 `healthCheck.test.ts` 的夹具与模板解耦——它原本拿 `PROFILE_TEMPLATE` 当「齐全画像」，模板一改就红，而那是在断言一件反过来的事。4 个变异体全部被杀，其中两个手工复核过：往产品文件里塞回 `Dongnb66` 确认全仓扫描**不是空转**（精确报出 `src\pages\Coach.tsx`）、把模板填成完整画像确认「必须停在骨架」不是空断言。
- 测试基线 **708 → 716**（53 → 54 个文件，新增的就是 `profileTemplate.test.mjs`）。**版本同步升到 `0.8.2`**：线上现在挂的还是会泄露身份的那一版，重新发布时必须能从 `app-version` 标记上分辨新旧——不升版的话，标记只能证明"跑的是带标记的构建"。


### Added（历史）

- **计费门：默认不花创建者的钱**（新 `billing.ts` + `aiChannels.ts`，接在 `streamChat` 上）：原先只有一条 AI 通道（平台云服务额度，语义是 **Creator quota**），等于「任何注册用户点一下 AI，钱记在创建者账上」。现在没有用户自备 Key、也没人显式开试用开关，AI 一律**不调用**（默认状态下一次模型请求都不发、也不记额度账）。判定顺序刻意写死：有 Key 且通道就绪 → 用户付；**有 Key 但通道没接通 → 宁可拒绝，绝不悄悄改用创建者额度**（这条是本次最坏的失败模式，不报错、只涨别人账单）；只有试用开关打开才走平台额度，且仍叠加原有的日限与每任务步数。两道门在存储坏掉时**方向相反**：额度台账 fail-open，计费门 fail-**closed**（读不到开关一律按「没人同意花钱」处理）。`aiChannels.ts` 是自备 Key 的厂商表 + 转发白名单：只允许 https、主机**全等**匹配、禁 userinfo、禁非常规端口，并提供 `redactKey` 保证 Key 不进日志与错误文案（用户截图问问题就等于把 Key 贴进公开群）。本地功能（规则版简历体检、本地预筛、关键词覆盖、僵尸检测、事实守门、项目任务包、GitHub 只读验收）本来就不调模型，继续免费。
- **项目教练 · 任务包生成 + 公开仓库验收**（新 `mentor.ts` / `githubVerify.ts` / `Coach.tsx` 页面，AGENT_PLAN 第四步）：方向 + 水平 + 周期 → 四周六步任务包，每步都是「可直接粘给任意智能体的完整指令」+ **可核对验收**（测试条数下限逐步变严、README 必须写「怎么跑起来」与「为什么这样设计」、以及你必须能独立答出的问题清单）。「教练不是代做」这次不是口号：每步指令都强制写入「你自己跑通、逐条讲清」，全文禁「帮你写完 / 无需理解 / 原样提交」这类口吻（逐条扫描断言）；做完填 owner/repo 回本页验收，只 GET `api.github.com` 公开仓库、`FetchOptions` 上**没有 headers 这个口子**（类型一旦允许传，「从不携带凭据」就成假的），仓库名不合法直接拒绝发请求（防 `a/../evil` 拼进 URL）。两条最容易造假的地方明确不作判定：只读接口看不到测试条数 → 归入「请本地跑一次再核对」；404/403/限流 → verdict `unknown`「无法确认」，不折算成「你没做完」。**生成与验收都不打模型**，不消耗创建者额度。
- **投递决策智能体**（新 `companyHistory.ts` + `agentRun.ts` 的 `runApplyDecision` + 工具表加 `prefilterJob`/`companyHistory` + 「AI·JD 评估」页按钮，AGENT_PLAN 第三步）：粘一段 JD，智能体自己串起「本地硬门槛 → 这家公司的历史 → 技术词覆盖」再给投/不投。**原始 JD 不进 prompt**——它只在 `ctx.focus` 里由工具读取，模型看到的是派生结果且都在不可信数据区内；粘贴的 JD 是陌生人写的文本，少一处原文进对话就少一处注入面。工具在 args 缺省时回落 `ctx.focus`，不让模型手抄几百字 JD（抄错就算到别的岗位上）。新增纯函数钉住两条会悄悄算错的口径：投递没有 job_id 时按公司名归集（只按 job_id 会漏掉整段历史）、没评分的岗位不能当 0 分平均。额度标签改由 `decisionLabel()` 单点生成，页面预检与记账同名，并由推导式扫描盯住「页面自己拼标签就红」。
- **求职智能体 · 每日巡检**（新 `agentLoop.ts` / `agentTools.ts` / `agentRun.ts` + 总览页卡片，AGENT_PLAN 第二步）：真做 ReAct 循环——模型自己决定查哪个工具、应用真的执行、观察结果回填、下一步，最多 8 步。8 个工具全部调用 `src/lib/` 里已带单测的纯函数（不重写算法，否则「智能体说 3 条、页面显示 5 条」无从对齐）。四条硬规则逐个做过变异检查：Observation 只能由应用侧填（模型自编的 observation 被丢弃，回给它的历史改成结构化复述）、max_steps 硬上限走「部分结论」不假装完成、每步落审计（thought/tool/args/observation/error/ms 并进结果面板）、工具连续失败 2 次收手。整轮循环共用固定任务标签「每日巡检」，让第一步的每任务熔断真正生效；接线层的工具观察结果走 `wrapUntrusted`——**这一条是推导式覆盖率检查自己变红发现的**：JD 是抓来的陌生人文本，裸拼进 prompt 就是注入入口。只出清单与建议，不替你发任何东西。
- **限额护栏**（新 `quota.ts` + `ai.ts` 的 `streamChat` 接线，AGENT_PLAN 第一步）：AI 额度记在**应用创建者**账号上，而 agent 循环一次任务要调多次模型——没有护栏就是创建者为一次失控循环买单。三道上限缺一不可：每天 20 件任务（用户看得懂的单位）、单件事 8 步（= 将来的 maxSteps，挡死循环）、每天 60 次调用（总保险丝）。执行点挡在**唯一模型入口**内部，`StreamOptions.task` 做成必填参数，新增调用点漏标在编译期就红；任务身份 = 能力 + 对象，批量评估每个岗位各算一件事，否则第 9 个会被当成失控循环误杀。台账存设备级 localStorage（不新增表列：数据模型归人拍板），代价如实写在设置页——清站点数据或换浏览器会归零。存储坏了 fail-open 但 `degraded` 可见；批量评分撞线会停整批而不是把剩下都算成失败。测试 392 → 421；15 个变异体（quota 11 + streamChat 接线 4）全部被杀。
- **OfferBiu 校招库接入**（`crawler/sources/offerbiu.mjs`）：第一个 API 型岗位来源，复用采集器 JSON 契约直进「岗位池 → 批量导入」，带投递截止日与官方公告链接；只读公开接口、不登录、1.2s 串行（若对方将来明确禁止则删除该源）。
- **渠道能力边界表**（`constants.ts` + `Jobs.tsx`）：8 渠道 ×「采集 / AI 处理 / 投递 / 回填」常量矩阵，岗位池页折叠卡片展示；`apply` 字面量「人工」类型锁死 + `channelCapability` 契约测试（双射 / 人工守卫 / UI 消费，推导式）。把「不自动投递」从文档承诺变成页面与测试共同钉死的事实。
- **AI 面试准备包**（`Interviews.tsx` + `ai.ts`）：「AI 押题」升级为「AI 面试准备」。打开弹窗自动带入三路输入——投递关联岗位的 JD 原文（可在框内改）、投递时选的那份简历全文、同一家公司往轮的面试复盘；输出固定三节：项目深挖题（对着简历追问 + 答题框架）、高频八股（按 JD×简历交集排优先级）、缺口与补救话术（用已有能力顶上，不自我设限）。三路外部文本各自包独立不可信数据区（`buildInterviewPrepUserMessage`），行为断言 6 条 + 覆盖度入口断言同步升级；复盘喂出题的闭环借鉴 OfferCome（BENCHMARK 第四节）。
- **面试表单「关联投递」**（`Interviews.tsx` + 新 `interviews.ts`）：添加/编辑笔试面试时可挂到对应投递记录上（此前表单没有入口，手动加的记录永远不挂 `application_id`，AI 面试准备的三路自动带入在数据入口就断了）。选项文案「公司 · 岗位（日期投）」按投递时间倒序。
- **投递看板「原岗位 ↗」跳转**（`Pipeline.tsx` / `ConversationDrawer.tsx` + `timeline.ts`）：看板卡片、表格操作列、会话抽屉头部三处入口跳回招聘平台原帖（打招呼的人此前回不去岗位页）；`jobUrlByApplication` 沿 job_id 映射，无链接的投递提示去岗位池补「岗位链接」。
- **AI·JD 评估表单「岗位链接」字段**（`AiLab.tsx`）：从评估页入池的岗位此前不写 url、天生跳不回去，现在粘贴 JD 时顺手存链接。

### Added

- **漏斗转化统计**（新 `funnel.ts` + 总览卡）：投递 → 回复 → 面试 → Offer 四层转化率，从沟通流水/面试记录推导；内置**评分校准**（career-ops calibrate 思路）——被拒的当时均分 vs 推进到后面的均分，差值就是预筛准头。
- **跟进节奏**（新 `followup.ts` + 总览「待跟进」卡）：按最后沟通状态给窗口（招呼 4 天/已读·超时 2 天/回复·约面 1 天，与 timeline.defaultFollowAt 同源），到期即给行动建议，替换原先粗放的「7 天没动静」。
- **JD 关键词覆盖**（新 `keywordCoverage.ts` + AI·JD 评估面板；Resume-Matcher 思路，Apache-2.0）：本地抽取 JD 技术词与画像摘要做覆盖比对，缺失清单提示「用哪段已有能力顶上」，不耗模型额度。
- **僵尸岗位检测 + 黑名单**（新 `reposts.ts` / `blacklist.ts` + 广场徽标与「拉黑这家公司」）：同岗位挂过/失效又重发即标「⚠ 僵尸重发」（判定复用 import.ts 的 dedupeKey 保证同源）；黑名单三类维度（company/recruiter/job，get_jobs 维度设计）存设备级 localStorage。
- **事实守门**（新 `factGate.ts` + 面试页提示）：面试记录里「口径关键词+数字」必须与简历口径文本一致——面试官会 clone 仓库核对；只扫口径词（测试/评测/项目/仓库等），画像无口径文本时宁可不报。
- **面试准备包存知识库**（Interviews 页 + `KNOW_CATEGORIES` 增「面试准备」）：生成的准备材料可一键存入「个人知识库」，零迁移复用既有表。
- **安全停止清单**（新 `crawler/lib/stopRules.mjs` + run.mjs 接线 + 契约测试）：验证码/登录墙/风控拦截三类显式规则，命中即停本站点不绕过——把 AGENTS.md §2.3 从文档承诺升级为代码约束。
- **岗位日报**（stopRules.mjs 的 `dailyReportMd` + run.mjs 每轮产出 `output/daily-YYYY-MM-DD.md`；campus-radar 思路）：按站点分组列本轮新增与提前停止原因。

### Changed

### Changed

- **模型调用点隔离覆盖率改为推导式**（`aiPromptCoverage.test.mjs`）：扫描 src 全部源码推导 `streamChat` 调用点，未包装的新增调用点默认失败；修掉第 8 个未包装的调用点（`import.ts` 岗位文本结构化）。

## [0.7.6] - 2026-09-24

对标 recruitops-agent 的三个能力缺口，各落一个**能落地**的版本：模型配置、简历附件 + AI 分析、抓取任务生成器。全部遵循既有边界——服务端不跑爬虫、不绕任何平台风控。

### Added

- **AI 模型选择**（`Settings.tsx` + `ai.ts`）。设置页新增「AI 模型」卡：从 `cloud.llm.models.list()` 模型目录里挑，选择存 localStorage（设备级偏好，不进 profile 表）；`pickModel()` 优先用所选模型，所选模型被平台禁用时静默回退目录默认——评估失败比换模型更糟。显示「当前生效」的实际落点。
- **简历附件上传 + AI 简历分析**（`Resumes.tsx` + 新 `resumeFile.ts` / `storage.ts` + `ai.ts`）。
  - 编辑简历可上传 PDF / docx / txt / md 附件（≤10MB），存入应用存储 `users/<uid>/resumes/`；`file_url` 存 7 天签名链接（过期按 `file_path` 续签），`file_path` 为永久路径，删除简历行时尽力清理附件。
  - PDF 用 pdfjs-dist（动态 import + worker 按 URL 加载，主包不背 1MB 级依赖）、docx 用 mammoth，提取的全文落在新增的 `content_text` 列，可手动修正；纯图片 PDF 会明确报「没提取到文字」，不出乱码。`.doc` 老格式直接拒绝并提示转存。
  - 新增 `analyzeResume()`：面试官视角输出结构化 JSON（综合印象 / 学历 / 工程与横向技能 / 项目拆解 / **面试防守关键词** / 风险点 / 按优先级的优化建议），结果存 `resumes.analysis`（jsonb），列表里「查看分析」随时复看；解析对脏输出全兜底（代码块包裹、字段缺失、非数组一律救回）。
  - DB：`db/migrations/002_resume_attachment.sql`，`resumes` 新增 `file_path` / `file_name` / `content_text` / `analysis` 四列（全部 `IF NOT EXISTS`，幂等）。
- **抓取任务生成器**（新页面 `Crawler.tsx` + `crawlSites.ts` / `crawlTask.ts`）。对标「对话式启动全量爬取」的诚实版本：工作台是静态站没有常驻进程，真正的抓取仍跑在用户本机（`crawler/run.mjs`），页面负责把「选站点 + 填关键词」翻译成一条可直接粘贴的命令。
  - 27 个站点全部可选，按实测状态标注（live / 未验证 / offline 置灰）与登录要求（🔒 = 先 `node login.mjs`）；Moka / 飞书 / 北森 / 通用四类无入口地址的站点单独成组、填具体地址走 `--url`。
  - 站点元信息与 `crawler/sites.mjs` 之间是**全量同步契约测试**（id / name / needsLogin / kwSearch / urlOnly / verified 六个字段直接 import 抓取器源值比对）——写测试时就咬出「华为的 listUrl 没有 `{kw}` 模板，我登记成了关键词搜索型」的登记错误。
  - 命令生成与抓取器行为严格对齐：默认参数不产生噪音（`--pages 2` / `--limit 60` / `--mode all` 不出现在命令里），关键词只对 🔍 站点（腾讯/字节/实习僧/BOSS）生效并在 UI 说明，产出 JSON 回「岗位池 → 批量导入」入库。

### Fixed

- **`db/split-exec.mjs` 整体清空 `db/exec/`（实际踩中）**。脚本用 `rmSync` 删掉整个 exec 目录再重建，把之前手工拆分并提交过的 `db/exec/singles/` 六个种子语句文件静默带走（跑一次 split-exec 才发现 git 显示 6 个 D）。修法：只清理本脚本生成的编号文件与 manifest，不再动目录里的其他内容；singles 从 git 恢复。
- **抓取器同一站点多关键词时输出文件互相覆盖（实际踩中）**（`run.mjs`）。输出文件名只含 `siteId-时间戳`（精确到分钟），`--site tencent --keyword 后端 --keyword 前端` 的两批产出写进同一个文件，后写覆盖前写——实跑腾讯后端 10 条被前端 10 条盖没，且 checkpoint 已记键、重跑也不再产出。修法：文件名带上关键词（`siteId__kw-时间戳`）；本轮靠定向清 checkpoint 补回了丢失批次。

### Square

- **岗位广场灌库 41 → 67 条**（`db/exec/singles/seed_07..09_*.sql`）。用本机抓取器实跑 15 个站点：新增字节跳动 17、米哈游 7、美团 2（全部对库内已有岗位去重）；腾讯搜索结果与库内完全重合、网易 8 条全是资深社招岗（对实习广场是噪音）均未灌入；**实习僧 19 条因公司名是标签行、标题丢字、薪资数字缺失被拒灌**——公共库脏了影响所有人，宁缺毋滥（站点选择器待修）。

### Added（本地 agent 网关，路线 A）

对标 recruitops-agent 的对话式抓取，选定「云端站不动 + 本地伴生网关」路线：云端站保持多端/广场/小程序能力；本机网关只做云端做不了的事——驱动本机浏览器抓取器。

- **数据库灌库通道**（`db/migrations/003_square_ingest.sql`，已线上生效）。`jobs_public_ingest(jsonb, source)` SECURITY DEFINER 函数是公共库**唯一**绕过 RLS 的写入口：每人每日 200 条配额、竖线标签行/空值挡板（与 build-seed 同口径）、(company, title) 去重幂等、字段长度清洗；`EXECUTE` 仅 authenticated。前端凭登录态 `db.rpc(...)` 即可推送，无需任何服务端密钥（平台不提供 service_role，此为文档明确合法通道）。
- **本地网关**（`gateway/server.mjs`，`npm run gateway`）。只监听 127.0.0.1：托管对话页 + `POST /api/crawl`（spawn 本机 `crawler/run.mjs`，站点 id 白名单/数值钳位/并发上限 3）+ 任务进度轮询 + 产出汇总。内置 `/cloud-proxy` 反向代理把 Origin/Host 改写为发布域——对话页跑在 localhost 上直连云服务会被 Origin 校验拒绝，代理只是让平台正确识别应用归属，key 与登录态不变。
- **对话页**（`gateway/public/chat.html`，单文件内联）。登录（与工作台同账号）→ 对话解析抓取意图（LLM json 模式 + 站点清单）→ 确认卡（可改站点/关键词/页数）→ 本机抓取实时日志 → 结果预览 → 一键推送广场（RPC 结果含新增/重复/拒绝明细）。LLM 只做意图解析，执行链是确定性的——不依赖函数调用能力。
- **抓取器退出语义修正**（`run.mjs`）。「读到了岗位但全部与去重历史重复」改为正常退出（code 0）——它是「一天内第二次跑同一站点」的正常结果，此前被判为失败（code 1），对话层会把正常结果报成进程出错（实测踩中）。
- **自查修复**：网关任务未传 `--out` 导致抓取产出写到 `crawler/output/` 而汇总读 `gateway/out/<taskId>/`、永远空结果（端到端实测暴露，修复后实测有产出）；split-exec 自检对含 `$$` 块语句误报裸分号。
- 测试 253 → **263**：网关参数校验（白名单/钳位/拒绝路径）与产出汇总纯函数 10 条。

### Tests

- 234 → **253**：站点同步契约（4）+ 命令生成（7）+ `parseResumeAnalysis` / `resumeKindOf` / 提取入口校验（8）。
- `pdfjs-dist` / `mammoth` 为新依赖（动态 import，按需加载）。

## [0.7.5] - 2026-09-23

### Fixed

- **密码登录失败提示掩盖真实原因（用户实际踩中）**（`Login.tsx`）。`signInWithPassword` 失败一律显示「邮箱或密码不正确」——但早期（0.3.1 之前）用验证码注册的账号**从未设置过密码**（登录页当时没有设密码字段），密码登录对这类账号必然失败。用户被误导去反复试密码，最后只能走「找回密码」，观感成了「登录不了，直接被重置」。
  - 事实核查：用 `user_list_end_users` 查到报告者账号创建于 15:14:05，早于 0.3.1（15:45）的「注册设密码」功能。
  - 修法：失败时透出 `errText` 真实错误 + 固定引导文案（没设过密码 → 走「找回密码」或直接验证码登录）。
  - SDK 侧已确认的两个边界（写进提示而非幻想绕过）：`verifyOtp` 的 `password` 参数「对已存在用户忽略」（验证码登录无法补设密码）；SDK 无登录后通用的 `updateUser`，老账号补密码唯一通道是「找回密码」流程。
  - 同时修正 OTP 密码框的误导性 hint（「已有密码的账号可留空」→ 明确「已有账号验证码登录时这里填的密码不会生效」）。

## [0.7.4] - 2026-09-23

第二次**逐条实证的代码审查**（两个探索代理并行审 + 每条结论亲自读代码复验）。修掉 13 处确认问题，其中 2 个高危、4 个中级。**本轮最核心的发现：上一轮引入的 `pickIndex()` 修复只对了一半——映射函数 `onChannel` 仍用常量表按扩展后的下标取值，等于修复自相矛盾。**

### Fixed

- **小程序「岗位来源」仍会被抹掉（高危，上一轮修复的回旋镖）**（`jobs.js`）。`openEdit` 用 `pickIndex(CHANNELS, source, true)` 把「AI 评估」这类非常量来源**追加**进 picker 选项，但 `onChannel` 写回时仍写 `constants.CHANNELS[i]`——选中追加项（index 8，超出来源表长度）取到 `undefined`，保存即写 `null`。用户哪怕只是打开 picker 确认一下原值，来源也会丢。修法：`onChannel`/`onJobType` 一律用 `this.data.channels[i]`（picker 实际显示的数组）映射。
- **「未填来源」被伪造成「BOSS直聘」（中）**（`jobs.js` + `Jobs.tsx`）。来源为空的岗位打开编辑时用 `'BOSS直聘'` 兜底显示，保存即伪造来源。改为追加空项显式展示，保存写 `null` 保真；Web 端 select 同样对不在 `CHANNELS` 里的当前值（含空串）追加一项。
- **抓取器超出 `--limit` 的岗位被永久丢弃（中高）**（`run.mjs`）。切片 `slice(0, limit)` 之后，checkpoint 写入的却是**全部** fresh 键——日志说「其余留到下次」，实际下一轮它们全部被判为已见而跳过。修法：checkpoint 只写入本次真正产出的岗位键。
- **多个 `--url` 被默认 `--pages 2` 截断（中）**（`run.mjs`）。`--url a --url b --url c` 只抓前 2 个，第 3 个静默跳过。URL 模式的循环上限改为 URL 个数。
- **批量 AI 评分运行中「重算匹配度」仍可点（中）**（`Jobs.tsx`）。`batchScore` 不设 `busy`，rescore 会并发写 `match_score`，last-writer-wins 把刚花的 AI 深评额度直接覆盖。修法：`batchScore` 全程 `setBusy(true)`，`try/finally` 保证释放。
- **广场「空公司」岗位可被重复加入（中）**（`square.ts`）。`publicToPoolRow` 把空公司兜底成「未填公司」入库，但 `inPool` 对**原始空串**算 key——加入后刷新仍显示「未加入」，再点一次就静默产生重复行。修法：`inPool` 的兜底口径与入库对齐（回归测试钉住）。
- **编辑表单回填截止日用 UTC 日期（中）**（`format.js`/`format.ts` + 两端表单）。`dateOnly` 仍是 `slice(0,10)` 截 UTC 日期，`2026-10-01T16:00:00.000Z` 在 UTC+8 实际已是 10-02，回填成 10-01 后用户不改直接保存，截止日悄悄提前一天。改为 `parseDate` → 本地日历日，两端同口径（`dateOnly` 进入跨端契约测试，+1 条）。
- **登记失败却清空自检清单（中低）**（`conversation.js`）。`record` 吞错后返回 resolved，`confirmGate` 的 `.then` 在失败时也执行——弹层关闭、6 项自检清零，用户输入全丢。改为失败返回 `false`，`.then` 判定后才清。
- **gapPlan 届数规则误报（低）**（`gapPlan.ts`）。`/20\d{2}年[^度]/` 把「公司成立于2019年」当成届数待确认。收紧为 `届` 字样或「XX年+应届/毕业」邻近匹配（测试钉住误报与漏报两侧）。
- **评估后改 JD 导致「差距三档」口径混排（低）**（`AiLab.tsx`）。live 视图的待确认档按当前输入框现算，而 highlights/gaps 是评估时刻的——存一份评估时 JD 快照，统一口径。
- **中止批量评分的提示与正常结束相同（低）**（`Jobs.tsx`）——改为「已停止：…」。
- **批量加入全部失败只报「已加入 0 个」（低）**（`JobsSquare.tsx`）——失败数可见并可重试。
- **数字字段无校验（低-中）**（`Settings.tsx`）——输入「2000元」会把 NaN 存库，绕过 `?? 默认值` 链路后总览页显示「剩余 NaN 条」。保存前校验三个数字字段。
- 顺手修：小程序退出登录无 `.catch`（失败静默）、OTP 验证错误一刀切文案掩盖限流、抓取器 `--detail/--pages` 缺值时 `Number('')===0` 静默变 0。

### 记录但未动

- `daily.ts` 对非法日期串静默按「无截止日」处理（当前所有写入路径都有 `normalizeDate`，防御缺口非活跃 bug）；`split-exec.mjs` 不识别块注释/双引号（当前迁移文件不含这些语法）；`useTable` 仍是死代码；契约测试的日期用例在负偏移时区会分叉（CI 为 UTC、本机为 +8，均不触发）。

### Tests

- 231 → **234**（dateOnly 契约 +1、inPool 兜底回归 +1、gapPlan 届数误报 +1）；新增断言均做「还原 bug 必须变红」自检（旧 `dateOnly` 实现在 `16:00Z` 用例上 `2026-09-25` vs `2026-09-26` 分叉，证实有牙）。

## [0.7.3] - 2026-09-23

一次**逐条实证的代码审查**：修掉 7 个真 bug，其中两个会**静默篡改用户数据**，一个会让**批量 AI 评分在用户以为停止后继续写入**。核心收获是补上了一组此前完全缺失的 **Web ↔ 小程序 跨端契约测试**（20 → 32 条）。

### Fixed

- **小程序「岗位来源」被静默改写（数据损坏级）**。`miniprogram/utils/constants.js` 的 `CHANNELS` 只有 6 项，Web 端有 8 项（少「浏览器采集」「岗位广场」）。`jobs.js` 里 `Math.max(0, constants.CHANNELS.indexOf(j.source))` 对这两个值返回 `-1` → 被 `Math.max(0, …)` 兜成 `0` → 编辑表单把来源显示成「BOSS直聘」→ **用户点一次保存，岗位的真实来源就被永久覆盖**。抓取器导入的岗位全都是这两个值，所以「抓回来的岗位编辑一次就变 BOSS 直聘」是必然发生的。
  - 修法不是简单补全数组：新增 `pickIndex()`，对**不在选项里的值追加成一项**并在表单里显式展示，让「这条记录的值不认识」变得可见，而不是悄悄替换成第一项。
- **批量 AI 评分在停止后仍写入**（`Jobs.tsx`）。`abortRef` 只在 `for` 循环开头检查，而用户点「停止」的时刻几乎总是落在 `await evaluateJD(...)` 期间 —— 该次 `await` 返回后代码继续 `updateRow` + `insertRow`，分数和 AI 报告照常落库。用户以为停了，数据却多了一条且无法撤销。
- **批量评分会作用到筛选后不可见的岗位**（`Jobs.tsx`）。`selected` 保存的是**全量** `rows` 的 id，而筛选只改变 `shown`；`toggleAll` 只写 `shown`，按钮计数却用 `selected.length`。用户勾一批 → 切筛选 → 点「批量 AI 评分」，实际会连带对已经看不见的岗位发起真实模型调用。改为筛选变化时清空勾选（`changeFilter(setter)` 包装器，在事件里清，不用 effect）。
- **小程序会话页 loading 永不复位**（`conversation.js`）。`.catch(toastError)` 没有 `setData({ loading: false })`，而 WXML 用 `wx:if="{{!loading}}"` 包住正文 —— 三个并发请求任一个失败，用户就会看到**永远转不完的圈，且没有任何重试入口**。同项目的 `index.js` / `pipeline.js` 都正确复位，只有这一页漏了。
- **两端口径不一致：日期解析（实测差一整天 / 差 8 小时）**。小程序 `format.js` / `pace.js` 先把 `-` 换成 `/`、再剥掉 `T…` 后缀，等于**丢弃时区信息、强制按本地时间解释**；Web 端是 `new Date(value)`，保留 ISO 语义。实测后果：
  - `paceStatus` 的「距上次发送多少分钟」算出 **500 vs 20**（冷却门禁时松时紧，直接影响「现在能不能发」）；
  - `daysLeft` 在 `2026-09-25T16:00:00.000Z` 上两端差 1 天，进而影响「剩 N 天」与「3 天内截止」的紧急标记。
  - 修法：抽出 `parseDate()`（纯日期串按本地构造、其余交给 `new Date`），两处统一调用。
- **`useTable` 的类型陷阱**（`src/lib/hooks.ts`）。全仓 0 引用的死代码，且 opts 手写成 `{ order, ascending }`，而 `listRows` 还支持 `limit` / `filters` —— 未来调用方传 `limit` 会被 TS 静默丢弃（多余的属性检查只对直接传字面量生效），变成「以为分了页、实际全表拉取」。已改为复用 `ListOptions`。

### Performance

- **`JobsSquare.tsx` 的本地评分不再逐行重算**。`localScore` 会逐字扫描 `jd_text`（最长 8000 字），原先裸写在 `shown.map()` 的渲染里 —— 广场上千条岗位时，**每勾一个复选框都会触发全量重扫**。改为按 id 的 `useMemo` 查表。
- 同一文件里「可加入岗位」的推导原本散在三处，其中按钮计数用了 `selected.filter((id) => shown.some(...))`，是 **O(选中数 × shown 长度)** 的嵌套扫描。合并为 `joinable` / `selectedJoinable` 两个 memo，三处共用同一份结果（口径也不会再漂）。
- lint warnings 24 → 22（重构重复推导自然下降）。

### Added

- **Web ↔ 小程序 跨端契约测试**（`crawler/__tests__/contract.test.mjs`，+12 条）。此前这组测试只覆盖「抓取器 ↔ Web」，**完全没有覆盖「Web ↔ 小程序」**——而这两端是两份手写的常量与算法副本，没有任何工具保证同步，正是上面 `CHANNELS` 事故的成因。新测试用 `createRequire` 直接加载小程序的 CommonJS 模块逐项比对：
  - `CHANNELS` / `JOB_TYPES` 逐项**且顺序**一致（顺序变了 picker 下标就会指错）；
  - `PROFILE_TEMPLATE` 键集合一致、可验证数字一致；
  - `GREETING_RULES` 必须钉住完整拆分数字（只写总数挡不住模型自行编分解）；
  - 顶层 `const` 声明了就必须导出（防「写了但忘了导出」）；
  - `fmtDate` / `fmtDateTime` / `daysLeft` / `paceStatus` 两端同结果。
  - 每条断言都做了**「关掉修复必须变红」自检**；首轮自检发现两条断言**没有牙**（只断言出现过「508」——原文本来就有；拿纯日期串去比对 `fmtDateTime` 是测一条永不执行的分支），已改为真正能失败的版本。

### 说明

- `Jobs.tsx` 的 `detail` / `applyFor` 持有 `Row` **快照**而非 id（`load()` 之后可能指向旧数据）。实际暴露面很窄（只有显式保存 / 删除会触发 `load`，且弹窗期间模态阻挡交互），属潜在健壮性问题而非活跃 bug；改成「提交时按 id 重查」是行为变更，本轮未改，先记录。
- 测试基线 192 → **204**；`tsc -b` 零错；`crawler selftest` 全过。

## [0.7.2] - 2026-09-23

这一版做三件事：**开通云服务并发布线上、初始化 git 仓库、更正上一轮关于云服务工具的错误结论。**

线上地址：<https://internship-workbench-47024.app.workbuddy.host/>

### Added
- **云服务已开通**（`applicationId: wbapp_cj7U3jJ6RwPG2f4tfo273L`，`billingStatus: normal`，`provisionStatus: assigned`）。返回的 `publicConfig` 与 `src/cloud.ts` 里早已写好的 `endpoint` / `publishableKey` **完全一致**，所以前端侧未改任何代码。
- **首次 git 提交**：132 个文件 / 20902 行。此前项目目录从未 `git init`，0.7.x 的所有改动都没有版本记录。

### Fixed
- **`.gitignore` 的行尾注释导致忽略规则整体失效**（这个 bug 很危险）。原文是：
  ```
  crawler/.profile*       # 浏览器档案，含你自己账号的登录态，绝不能入库
  crawler/output          # 抓取产出与去重历史（含岗位数据）
  ```
  git 不支持行尾注释 —— 整行会被当成**一个字面路径 pattern**，于是这两条规则**等于不存在**。实测 `git check-ignore` 认不出它们，`git add .` 会把 **crawler/.profile（324MB，含登录 cookie）** 一起提交。已把注释独立成行，并在文件里留下说明防止再犯。修复后待入库文件从 1037 降到 132。

### 更正
- **上一版说「云服务工具在当前构建缺件」是错的。** 当时的依据是 `grep app.asar` 搜 `workbuddy_cloudservice`（无下划线）→ 0 次。正确标识是 `workbuddy_cloud_**service**`（**有下划线**），实际命中 23 次；调用 `inspect` / `activate` 均正常返回。
  - **唯一真的缺的是执行 SQL 的工具**：`workbuddy_cloudservice_db_exec_sql` 实测返回 `"Tool is not available in the current environment or configuration."`，且官方文档明确 schema 操作**只能走这些 MCP 工具**（*never through a front-end SDK, never through a shell script*），没有替代通道。
  - 教训写进了 skill：**一个标识符搜不到不等于不存在；报错信息比 grep 命中数可信，下结论前要试命名变体。**

### 说明
- 线上发布的是**工作台 Web 版**（根目录的 Vite + React 项目）。项目里同时存在 `miniprogram/` 微信小程序，发布工具会因它优先判定为小程序项目而不产出分享链接；本次通过临时移出该目录让 Web 项目被正确识别，发布后已还原（`git status` 干净）。
- `jobs_public` 建表仍差最后一步（执行工具未挂载），语句就绪在 `db/PASTE-HERE.md`。

## [0.7.1] - 2026-09-23

这一版只做一件事：**把公司名录这半补厚，并修掉接入新站点时暴露的三个真 bug。**

补的动机很具体。对标的桌面工具（recruitops-agent）从第三方同步「公司和校招入口」，所以它的抓取知道该去哪些站抓；工作台的抓取器此前只有一张手写的 18 条站点表，而且其中 11 条是同一批大厂。公司名录薄 = 一次抓取能覆盖的岗位少 = 岗位池看起来还是空的。

### Added
- **抓取器站点表 18 → 27 条**，新增 9 家公司官方招聘门户：`iflytek`（科大讯飞）、`byd`（比亚迪）、`zte`（中兴通讯）、`pdd`（拼多多）、`huatai`（华泰证券）、`cmb`（招商银行）、`hikvision`（海康威视）、`sf`（顺丰）、`lenovo`（联想）。
  - 选的是「各家公司自己的招聘官网」而不是第三方聚合站 —— 这些页面公开可访问、允许正常浏览，抓的又是用户自己看得见的岗位，不涉及绕过登录或频控。
  - `BOARD_COMPANY` 同步从 11 家扩到 20 家，`detectSiteByUrl` 补上对应域名反查。
- `crawler/tools/show-output.mjs` / `show-dom-tree.mjs`：把之前散落在 `crawler/` 根目录的一次性调试脚本收进 `tools/`，并补上用途注释。前者快速看抓取产出的字段，后者导出候选卡片的 DOM 父子树 —— 排查「选错卡片组」时不用再靠推断。
- `--profile <路径>` 参数真正接线（此前只被解析、从未使用）。配合它新增的报错分支，抓取器现在能区分「浏览器没装」和「档案目录被占用」这两种表现相同但处置相反的情况。

### Fixed
- **美团校招把 JD 正文当成了岗位名**（`extension/collector.js`）。接入美团时抓到的 4 条「岗位」标题是「1. 负责各类后台服务和业务系统的需求分析…」这类**岗位职责编号段落**。根因：真卡片 `div.position_list_item` 有 10 个，但每张卡里的 JD 段落 `div.desc.hidden-ellipsis` 有 20 个，而卡片检测的排序是 `数量 × 1000` —— 碎片靠数量优势直接压过真卡片。
  - 修法不是调权重（碎片永远更多，软乘数压不住数量优势），而是加**硬门槛**：真卡片的父容器是「列表壳」（文本 ≈ 全部卡片拼起来），碎片的父容器**就是卡片本身**。于是加了两个门槛 —— 父容器文本须 ≥ 单张卡的 2 倍；且若本组父链上存在文本完全相同的别组元素，判定为「卡片内壳」淘汰。
  - 修完实测：**10 条，公司 / 标题 / 城市全对。**
- **单公司招聘板的公司名被启发式误判**（`crawler/run.mjs`）。补全逻辑原本写成「**只在 `company` 为空时**才用站点表补」，而卡片内启发式已经猜出了一个错误的值（「更新于2026/08/17」「核心本地商业-基础研发平台」），非空 → 站点表不生效。
  - 单公司招聘板的页面里根本没有公司字段，启发式只能在卡片里挑一个「像公司名」的短行，必然误判。既然 `BOARD_COMPANY` 已经确定知道这家板属于谁，那就是事实，不该被猜测覆盖。改成**覆盖**语义。
  - 顺带修正了日志：现在会分别报「补空 N 条」与「修正启发式误判 N 条」，误判率变得可见 —— 这本身就是站点表该不该扩的信号。
- **`.profile/lockfile` 残留导致抓取器彻底不可用，且报错误导**。上一次抓取被强杀（超时 / Ctrl+C）会留下 Chromium 的 user-data-dir 锁，三种内核全部启动失败 —— 而报错是「没有可用的浏览器，装一个即可」，把用户指向了完全错误的排查方向（去装浏览器，而问题是要删一个锁文件）。

### 说明
- 新增的 9 个站点**逐个真跑过一遍**，结果分三档，README 的站点表已按事实更新：
  - **可用（`live`）6 个**：`tencent` 10 条、`meituan` 10 条、`zte` 6 条（含 Moka 真实投递链接）、`pdd` 5 条、`hikvision` 5 条、`iflytek` 5 条。这 6 个是**逐条核对过标题、确认抓到的确实是岗位名**的站点。
  - **列出来但暂不可用（`offline`）5 个**：
    - `byd`、`lenovo`：首页只读到 1 条（站点名）。岗位列表要点进「校园招聘」后才出现，需要「进入后再点导航」的能力，本版抓取器还没有。
    - `cmb`（招商银行）：抓到 23 条，是**本批数量最多的**，但逐条核对 DOM 后确认全是首页「员工风采」轮播（`div.staff-item`，员工花名与岗位连成一行、没有链接），**不是岗位列表**；全站各路由（`/`、`/campus`、`/school`…）返回同一个 5740 字首页，真岗位要登录后才出。
    - `huatai`（华泰证券）：4 条全是「校园招聘正式启动 / Q&A / 在线测评通知」**新闻稿**（`pb/news.html`），不是岗位。
    - `sf`（顺丰）：3 条是「网络规划、产品管理、IE工程师」这类**方向栏目名**（一个方向下挂一批岗），不是具体岗位标题。
  - **这 3 个「数量好看但不是岗位」的坑是本版最重要的教训**：抓取产出必须逐条核对「抓到的到底是不是岗位」，光看条数会把员工感言、招聘新闻稿、栏目名当成岗位灌进岗位池。为此在契约测试里加了一条断言，把这三个站点钉在 `offline` 并要求 `notes` 写明「不是岗位」的原因。
  - **没有把它们删掉**，因为 URL 是对的（`cmb` 要等登录能力，`huatai` 要等 `pb/position` 路由，`sf` 要换带筛选的列表页）；留在表里 + 标 `offline` 比删掉更能说明现状。
- 真跑过程中修掉两个接入问题：
  - `huatai` 的证书 CN 与域名不符（`ERR_CERT_COMMON_NAME_INVALID`），在 `crawler/lib/browser.mjs` 打开 `ignoreHTTPSErrors`。抓取器只读公开页面、不提交表单、不传凭据，跳过校验不会泄密；不这么做就只能把这类站点一个个删掉。
  - `hikvision` 的职位表不在首页（首页只有宣传图），改到 `school.html?activeTab=1`；`sf` 的校招专站是 `campus.sf-express.com`（原写的 `hr.sf-express.com` 是社招站且连不通）。
  - 顺带把 `detectSiteByUrl` 里 `hotjob.cn → huatai` 这条反查**删了**：`hotjob.cn` / `wecruit.hotjob.cn` 是北森 wecruit 的**共用托管域名**，多家公司共用，反查成某一家会把别家岗位误标成华泰。改为 `htsc.com.cn → huatai`，共用域名让公司名留空。
- 这一版**没有放宽抓取边界**：仍然严格串行、请求间强制等待带抖动、单站点页数有上限、不并发、不绕登录与验证码。站点表变厚只是「知道该去哪」，不改变「怎么去」。

### 测试
- 182 → **192** 条。`crawler/__tests__/contract.test.mjs` 的站点表测试分两组：
  - **一致性**（6 条）：站点 id 不重复、`BOARD_COMPANY` 无孤儿映射、每个站点要么有 `listUrl` 要么说明用 `--url`、**所有单公司招聘板都必须在 `BOARD_COMPANY` 里有名字**（漏了会让公司名变成卡片正文行）、**多公司平台不能有名字**（塞了会让所有岗位记成同一家公司）、`detectSiteByUrl` 能认回各站点域名。
  - **验证标注**（4 条）：`verified` 只取约定值；**标了 `live` 的站点必须在 `notes` 里有实跑结论**（拦「顺手把 offline 改成 live 让自己好交代」）；标了 `offline` 的必须说清原因；**从 `live` 降级到 `offline` 的必须写明「抓到了什么但不是岗位」**（拦「把降级理由一起删掉，下一个人再试一遍同样的 URL」—— 这条是本轮真跑踩到 `cmb` / `huatai` / `sf` 之后补的）。
    - 这组测试**第一次跑就抓出真问题**：`tencent` / `iflytek` / `lenovo` / `byd` / `cmb` 等站的实跑结论只写在 `//` 注释里 —— 注释是给人看的，代码读不到、复制站点对象时会被丢掉、也没有测试能拦住它过期，**等于没写**。已全部搬进 `notes` 字段。
- 把 `findCards` 里那段排序算术抽成纯函数 `scoreCardGroup` 并导出，让「碎片靠数量顶掉真卡片」这类回归能在 CI 里被拦住（`findCards` 本身依赖真实 DOM，进不了 vitest）。
- 抓取器自检 40 条断言全绿 · `tsc -b` 零错 · lint 24 warnings / 0 errors · build 通过。
- **真站点验证**（逐条核对标题是否确为岗位名，不是只看条数）：`tencent` 10 条 · `meituan` 10 条 · `zte` 6 条 · `pdd` 5 条 · `hikvision` 5 条 · `iflytek` 5 条 = **可用合计 41 条**；`huatai` 4 条（新闻稿）· `sf` 3 条（方向栏目名）· `cmb` 23 条（员工风采轮播）已降级为不可用。
- **端到端验证**：把 6 个可用站点的产出合并成单个文件，用工作台自己的 `looksLikeCollectorJson` + `parseCollectorJson` 跑一遍，确认 **41 条全部被识别为抓取结果、每条都有标题、`job_type` 自动判为「校招」**，不需要消耗模型额度。

## [0.7.0] - 2026-09-23

### Added
- **岗位广场（`jobs_public`）**：公共岗位库，所有人都能读、**没有人能写**。解决的是一个产品层面的硬伤 —— 工作台按用户隔离数据（RLS），新用户打开岗位池必然是空的，而空表看不出这个工具的任何价值。
  - 拆开的是一对概念：**岗位广场**（公共、只读、所有人看到的同一批）与**岗位池**（私有、按账号隔离）。
  - 点「加入岗位池」= 把这一条**复制**一份到自己的 `jobs`（来源标「岗位广场」），不是引用。好处有三个：RLS 依然干净（广场没有 owner 概念）、同一条岗位被多人加入后各自的 status / 备注 / 匹配度互不干扰、广场以后刷新也不影响任何人已在跟踪的记录。
  - 页面支持关键字 / 城市 / 类型筛选，以及「只看未加入」；已在池中的岗位直接标出并禁止重复加入。判定走 `dedupeKey`（与导入查重同源），不是字符串比较 —— 否则会漏掉大小写与「实习/校招」后缀差异。
  - 新增 `db/migrations/001_jobs_public.sql`（建表 + 只读策略）、`db/seed/*.json`（源数据）、`db/build-seed.mjs`（生成 INSERT 语句）。
- `src/lib/square.ts`：广场的纯逻辑层（`publicToPoolRow` / `poolKeySet` / `inPool` / `filterSquareJobs` / `squareCities`），可脱离浏览器单测。
- 岗位池空态新增「去岗位广场挑岗位」入口，并说明广场是公共库、不用自己抓。

### Changed
- `CHANNELS` 新增「岗位广场」。此前从广场加入的岗位没有对应取值，按渠道筛选会漏掉它们。
- **抓取器公司名提取**（`extension/collector.js`）：新增 `PIPE_LINE` 挡板，两处公司名候选都挡掉带竖线的行。此前只挡了第一处，兜底分支仍有空子 —— 真跑腾讯招聘时产出过两条脏数据：公司名被写成「市场 ｜ 应届毕业生 ｜CDG」与「产品 ｜ 应届毕业生 ｜IEG PCG」（竖线标签行漏网）。**这条通道同时服务扩展与抓取器，所以一次修改两处都受益。**
- 数据模型从 10 张表扩展为 **11 张**（10 张私有 + 1 张公共）。README / `docs/CONFIGURATION.md` 的表清单与 RLS 说明同步更新。
- `docs/CONFIGURATION.md` 新增「岗位广场为什么是一张单独的表」与「公共只读 RLS 的两道门」两节；「新增一张表的完整步骤」补充了 `TABLES` 的取舍标准（公共数据不进个人备份）。

### 说明
- **岗位广场不进 `Settings.tsx` 的 `TABLES`**。那是数据导出的表清单，语义是「你自己的数据」；公共岗位不属于任何用户，混进个人备份会让「备份」这个概念变糊。想恢复广场数据，重新从广场加入即可。
- 广场的内容**不会自己更新**：它由工作台侧灌入（真人跑一次抓取 → 清洗 → 入库），新鲜度取决于最后一次灌入时间。`build-seed.mjs` 会拒绝公司名带竖线的行 —— 公共库脏了影响所有用户，宁可拒绝导入。

### 测试
- 162 → **182** 条。新增 `src/lib/__tests__/square.test.ts`（20 条）：来源标签在 `CHANNELS` 里、私有字段在复制那一刻初始化、优先级分档边界、缺字段不留空、**去重判定与 `dedupeKey` 一致**（防止两边算法分叉）、筛选与城市统计的纯函数行为。
- `db/build-seed.mjs` 的公司名挡板**做了反向验证**：注入「市场 ｜ 应届毕业生 ｜CDG」后生成器报错拒绝，清理后恢复正常 —— 确认这不是一个永远返回 true 的空检查。
- 抓取器自检全绿（`cd crawler && npm run selftest`，真 Edge 跑本地夹具，40 条断言）：`PIPE_LINE` 改动没有影响既有提取行为。

## [0.6.0] - 2026-09-23

### Added
- **本地抓取器 `crawler/`**：跑在用户自己机器上的批量岗位抓取。驱动系统已装的 Edge / Chrome（只依赖 `playwright-core`，**不下载自带浏览器内核**，省几百 MB 也让页面表现与手动打开一致），按站点表逐个打开招聘页，翻页读完列表，再逐个打开岗位详情页补全 JD，产出一份可直接导入的 JSON。
  - 抓取器比扩展多做的四件事：**翻页**（下一页 / 加载更多 / 滚动到底 / URL 页码四种策略）、**逐个补 JD**、**标题筛选**（`--mode all|intern|campus`，在补 JD 之前挡掉不想要的，因为补 JD 是最贵的一步）、**跨轮次去重 + 断点续跑**（`--resume` / `--purge`）。
  - 内置 18 个站点适配 + `--url` 任意页面兜底；`--dump` 存渲染后的 HTML（抓不到东西时最有用的一步）；`--wait` 覆盖站点建议等待时长。
  - 单一公司招聘板（腾讯、字节、华为等）的页面里没有「公司」字段，由站点表 `BOARD_COMPANY` 直接补，**补在去重之前**（去重键含公司名）。
  - `login.mjs`：需要登录的站点（如 BOSS 直聘）由用户自己在本机登录一次，登录态存进 `crawler/.profile`；脚本全程不读写、不上传任何 cookie 内容。
  - 边界与扩展一致：只读浏览器渲染出来的 DOM，不调平台接口、不解密参数、不绕验证码；严格串行 + 请求间隔带随机抖动；不需要登录的站点用独立窗口，不污染日常浏览器。
- **提取算法零重复**：`extension/collector.js` 成为扩展与抓取器**共用的唯一实现**（抓取器注入该文件后调用同一个函数），并新增 `options.mode = 'list' | 'detail'` 与 `maxJd`。两条通道读出来的字段从此不可能分叉。
- **导入弹窗支持直接选文件**：新增「选择抓取结果文件」，读入后按内容判断走「直读采集数据（不过模型）」还是「纯文本切块」；`probeJobFile()` 负责这个判断并可单测（判错的代价是白花模型额度）。

### Changed
- **口径修正**：从「不做爬虫」改为「**不做服务端爬虫；本地抓取器有**」。服务端那半边仍然成立 —— 本项目只有云上的静态站点 + 云数据库，没有常驻进程与浏览器内核，服务端抓取在架构上没有落点。README / FAQ / 空态文案 / 代码注释里的旧口径已一并同步。
- `CHANNELS` 新增「浏览器采集」，此前采集数据的 `source` 落在这个取值上，按渠道筛选会漏掉它们。
- 浏览器扩展版本 0.2.0 → **0.3.0**（采集器新增 `mode` / `maxJd` 参数）。

### Fixed
- **采集卡片无链接时整页退化成 1 个岗位**：真跑腾讯招聘时，其岗位卡是 `<li class="post_box">`，内部**一个 `<a href>` 都没有**（纯 div + 点击事件），而 `findCards` 原先硬性要求卡片内含链接 → 整页只读出 1 个岗位。修法：去掉硬性要求，改为同分时优先含链接的组；同时 `extractCard` 不再把列表页地址冒充岗位链接（那会让「补 JD」把列表页抓成岗位）。实跑结果 1 → 10 条，标题与城市 10/10 全对。
- **`normalizeJobType('社会招聘')` 返回「实习」**：正则只写了 `/社招/`，漏了「社会招聘」。前后端（`src/lib/import.ts` 与 `crawler/lib/normalize.mjs`）一起改为 `/社招|社会招聘/`。
- **标签行被当成公司名**：卡片里的「工作地点：深圳总部 北京」这类结构化字段行含「技术」「中心」等会被 `COMPANY_HINT` 命中的字眼，新增 `META_LINE` 在选公司名之前挡掉；带竖线的行（如「技术 ｜ 应届毕业生 ｜CDG」）一律不当公司名。
- **多城市岗位取错主地点**：`pickCity` 原先按城市表顺序返回首个命中，改为一律取**文本里最早出现**的城市（「深圳总部 北京 上海」→ 深圳）。

### 测试
- 110 → **162** 条。新增抓取器纯逻辑测试（`crawler/__tests__/normalize.test.mjs`）与跨端**契约测试**（`crawler/__tests__/contract.test.mjs`）：两端 `JOB_TYPES` / `dedupeKey` / `normalizeJobType` 必须逐字一致、站点表的 `channel` 必须都在 `CHANNELS` 里、抓取器产出必须能被 `parseCollectorJson` 吃下。这类错位不会报错，只会安静地把数据弄脏。
- 需真浏览器的那部分单独跑 `cd crawler && npm run selftest`：用本机 Edge 跑 `extension/fixtures` 的两个夹具，40 条断言覆盖列表页 6 条全字段 + 详情页公司与城市薪资 + 兜底分支，**不碰真实招聘站点**。

## [0.5.0] - 2026-09-23

### Added
- **岗位批量导入**：把招聘页 / 邮件 / 聊天记录里的岗位信息整段粘进来，先按分隔线或长度拆块，再逐块结构化（公司 / 岗位 / 城市 / 薪资 / 学历 / 截止 / 链接 / JD 正文）。解析结果**必须先在表格里核对再入库**，每行都能改；模型认不出来的字段留空，不猜。
  - 三档解析：**仅本地拆分**（纯正则，零额度，用于预演）→ **AI 结构化解析**（串行、可中断、失败自动回落本地）→ 识别到扩展采集数据时**直接映射，完全不花额度**。
  - 入库前查重、按当前画像算匹配度并定优先级、缺 JD 的行写入提醒备注。
- **浏览器助手新增「采集本页岗位」**：在招聘结果列表页或岗位详情页点一下，读取**当前已渲染的 DOM**，批量产出岗位并一键复制，粘到工作台「批量导入」即可入库。
  - 用**重复结构检测**（按标签 + class 集合作指纹聚类，取数量够多、体积最小的一组）找卡片，不依赖任何站点的类名，站点改版不会直接失效。
  - 单岗位详情页自动退化：卡片不足 4 张时按「整页 = 1 个岗位」处理，公司名从 `<title>` 取，城市与薪资在 `h1` 所在容器 + 正文里探测。
  - 权限**没有增加**，仍是 `activeTab` + `scripting` + `storage`；**不发任何网络请求**、不翻页、不调接口、不解密参数、不绕验证码。它是「复制粘贴的自动化」，不是爬虫 —— 采集结果里不会出现用户自己没看到的内容。
  - 附可复跑的验证夹具 `extension/fixtures/`（列表页 + 详情页两个模拟页面，含无头浏览器跑法），不拿真实招聘站点做测试。
- **岗位池空态重做**：不再是一句「还没有岗位」，改为「三条入库通道 + 三步走说明」，并提供 **5 条一键示例岗位**（覆盖高/中/低匹配与未接触技术栈，用来当场验证两段式评分），用「示例·」前缀命名、随时一键清空。
- 新增 `pickJobUrl()`：从一段含多个链接的文本里挑出最像岗位详情页的那个（详情页特征 > 普通链接 > 带筛选参数的列表页链接，并跳过采集器写入的 `#` 元信息行）。

### 说明
- 本版本**不引入服务端爬虫**。抓招聘站点要靠常驻后端 + 浏览器内核，而我们只有云上的静态站点与云数据库；更重要的是，绕过反爬去批量抓取，风控后果落在使用者自己的账号上。岗位获取因此停在「用户看得见的这一屏」——这是有意划的线，不是能力缺口。

### Fixed
- 导入路径里链接选择的顺序问题：一段文本含多个 URL 时原先取第一个，会把页面地址当成岗位链接（由采集器文本的往返测试发现并钉住）。

## [0.4.0] - 2026-09-23

### Added
- **微信小程序端**（`miniprogram/`）：与网页端共用同一套云端后端（同一个数据库、同一个账号体系），补上网页端拿不到的两条登录通道 —— **手机号短信验证码登录 / 注册**与**微信一键登录**。
  - 5 个 tab：总览 / 岗位池 / 投递 / AI 评估 / 我的；另有登录页与会话详情页，共 7 个页面。
  - 本地打分、投递节奏守则、6 条打招呼自检清单、两段式 AI 评分全部与网页端逻辑同源（`utils/score.js` · `utils/pace.js` · `utils/constants.js`），不是另写一套规则。
  - 微信开发者工具打开 `miniprogram/` 目录即可运行；npm 依赖需先「构建 npm」。

### Changed
- README 补充小程序端章节与两端的登录能力对照；`docs/CONFIGURATION.md`、`docs/FAQ.md`、`docs/QUICKSTART.md` 同步「小程序端已实现」的口径。

## [0.3.1] - 2026-09-23

### Fixed
- **登录页默认落在「密码登录」，新用户必然卡住**。改为默认「验证码登录 / 注册」——填邮箱收验证码即完成登录，首次使用自动创建账号，不再存在「必须先单独注册」这一步。
- 取消独立的「注册」标签，合并进验证码入口；密码字段在该入口常显并标注为可选（首次使用请设置，已有密码可留空）。
- 移除「该邮箱已注册，请改用验证码登录」这类**账号枚举式提示**（会暴露某个邮箱是否已注册）。改为中性文案「请设置一个至少 6 位的登录密码」。
- 切换收件邮箱时作废上一份验证码挑战，避免用旧挑战验证新邮箱。
- 重试填错的验证码不再重复调用发码接口（原先重试路径会重复发码，扩大短信/邮件计费面并使旧码失效）。

### Changed
- 登录页说明文案改为准确表述平台认证边界：网页端支持邮箱验证码与邮箱密码；手机号 / 短信与微信登录仅小程序端开放。
- `docs/CONFIGURATION.md` 新增「认证能力边界」章节（支持矩阵 + 发码/验码分离的硬性约定）；`docs/FAQ.md`、`docs/QUICKSTART.md`、README、架构图同步更新。

## [0.3.0] - 2026-09-23

### Added
- **投递节奏守则**：可配置每日发送上限、发送时间窗、最小间隔；总览页新增「今日投递节奏」卡片，实时判断现在能不能发、还剩几条。防止一天群发被平台判定骚扰。
- **发送前自检清单**：在投递看板登记「已发打招呼」前必须逐条勾选 6 条纪律（不出现校名、不提没做过的技术、数字口径与简历一致、长度匹配对方问题强度等），勾满才允许登记，只放大可验证的能力。
- **会话时间线**：投递记录的沟通闭环。6 个快捷记录按钮（已发打招呼 / 对方已读 / HR 回复了 / 约到面试 / 被婉拒 / 超时未回），一次点击 = 一条流水 + 自动推进投递阶段与下一步跟进。
- **超期未回复跟进**：总览页与投递看板自动挑出 ≥7 天没有新进展的岗位，看板卡片标红提示换渠道。
- **岗位池批量 AI 评分**：两段式流水线 —— 本地关键词/画像规则预筛（`PREFILTER_THRESHOLD = 45`）→ 通过者逐条 AI 七维深评。串行执行、可中途停止、支持一键重试失败项、实时进度条。
- `messages` 表（沟通流水）与 `profile.daily_greet_limit / greet_window / min_interval_min` 三个节奏配置字段，全部走 RLS。
- 工程化：`AGENTS.md`（AI 协作规范）、`CHANGELOG.md`、`docs/` 三份文档、架构图、MIT LICENSE、Vitest 单测、GitHub Actions CI。

### Changed
- 数据模型从 9 张表扩展为 **10 张表**。
- 总览页数据加载从 5 张表扩展为 6 张表（新增 messages）。
- 设置页新增「投递节奏守则」配置区与自检清单展示。

## [0.2.0] - 2026-09-23

### Added
- 云服务后端接入：PostgREST 风格数据库 + 邮箱验证码登录 + 免密钥大模型调用。
- 11 个前端模块：总览 / 岗位池 / 投递看板 / 面试跟进 / Offer 对比 / 简历库 / 网申填写包 / AI · JD 评估 / 提醒日历 / 个人知识库 / 目标条件。
- 投递看板支持拖拽改阶段，另有表格视图。
- Chrome MV3 扩展：导入工作台导出的 `applykit.json`，一键填充网申表单。
- 全部 9 张表启用 RLS，前端不传 `owner_id`。

### Fixed
- 写操作返回空数组时不再静默成功，统一抛错（RLS 拒绝的第一道防线）。

## [0.1.0] - 2026-09-22

### Added
- 项目初始化：Vite 8 + React 19 + TypeScript，纯手写 CSS，无 UI 库。
