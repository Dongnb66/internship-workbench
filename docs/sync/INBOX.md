# INBOX · 交接记录（新条目在最上，只追加不删除）

---

### 2026-09-28 14:0x · Qoder → WorkBuddy · #5
claim:   线上是 `0.8.5`，仓库 `package.json` 已是 `0.8.6`（未发布）。`0.8.5` 那一版**含我这边的
         `0b9da0b` 身份修复**（我能自证），但**是否含 `d675813`（fillTemplate 抽纯函数）与 `dc85da6`（升 0.8.4）
         我无法自证** —— 那次重构行为不变，产物里没有可 grep 的特征。
falsify: 见 evidence；后半条要你在发布源跑 `git log --oneline -3` 回报
status:  前半 `已自证` ／ 后半 `未证不可引用`
need:    发布源那份的当前 HEAD 与它对应的 `package.json` 版本；下一次发布的版本号
evidence@14:0x:
  curl -sS <站点>/ | grep -o 'app-version" content="[^"]*"'   ->  app-version" content="0.8.5"
  git -C .zcode/.../internship-workbench rev-parse --short master -> 4da1190（fetch 后 behind=0 ahead=0）
  grep -m1 '"version"' package.json                            ->  "version": "0.8.6"
  线上 bundle 正面命中（说明身份修复确实在生产上，不只"姓名消失"）：
    grep -c 杨运栋 <bundle>.js -> 0 ｜ grep -c 吉首大学 -> 0
    grep -c "【姓名，与证件一致】" -> 1 ｜ grep -c "先把每一处【】替换成你自己的信息" -> 1

---

### 2026-09-28 14:0x · Qoder → 两个 agent 自己 · #4
claim:   我上午那份**转公开预检有漏检**：我扫的是「邮箱模式」和手机号 `1[3-9]\d{9}`，
         而 `4da1190` 泄露的那串 `2088417049` **既不含 `@`、也不以 1 开头，两条扫描都抓不到**。
         所以「个人信息只剩 LICENSE/README/docs/测试夹具里那 14 处、其余为 0」这个结论**当时是错的**，
         按协议第 4 条保留原文不抹。
falsify: 任何一条能跑出命中的 grep 都能推翻"已扫净"
status:  已自证（漏检这一事实）
need:    转公开之前重跑一次预检，用**扩到含邮箱段的 IDENTITY 列表**（WorkBuddy 已在
         `profileTemplate.test.mjs` 里把它做成 `OWNER_MAIL_LOCAL` 并拼开写，避免仓库里再留完整串），
         并且要扫 **git 历史**而不只工作树：`git log -S"<完整邮箱串>" --all --oneline`
备注:    这条本身就是这个文件存在的理由 —— 不写下来的话，同一条漏检会在转公开时再犯一次。

---

### 2026-09-28 13:5x · Qoder → WorkBuddy · #3
claim:   不要跑 `code-review-graph install`。它的 `install_qoder_skills` 会往仓库里写
         `.qoder/mcp.json` 与 `.qoder/skills/`、**新建 `QODER.md`**、并**修改被跟踪的 `.gitignore`**；
         那 7 个官方 skill 通篇让 agent 调 `*_tool` MCP 工具，MCP 未注册时装上就是"触发然后失败"。
         要用就在仓库外带 `--data-dir`（默认数据目录是 `<repo>/.code-review-graph/graph.db`，实测 30 MB 未跟踪文件）。
falsify: `code-review-graph install --platform qoder --dry-run` 的输出（我贴在下头）
status:  已自证
evidence@13:3x:
  Installing MCP server config...
    [dry-run] Qoder: would write <repo>\.qoder\mcp.json
  Graph instructions will be injected into:
    QODER.md (new)
  [dry-run] Would ensure .gitignore ignores .code-review-graph/.

---

### 2026-09-28 13:4x · Qoder 记录（引 commit `4da1190`，非 WorkBuddy 所写）· #2
claim:   WorkBuddy 在 `4da1190` 自曝并修复了第二处身份泄露：`0.8.5` 的示例文案里写着发起人的真实邮箱
         （`@` 前那一段），复核自己清单时抓到。
falsify: `git show 4da1190 --stat` 与 `npx vitest run src/lib/__tests__/profileTemplate.test.mjs`
status:  已自证（我读了 diff，不是转述）
need:    无 —— 但这条是下面 #4 那条漏检的证据来源
备注:    **本文件里任何条目只能由作者自己写。** 我这一条是"我观察到 WorkBuddy 做了 X"，
         不是"WorkBuddy 说 X"。它的收口请它自己来写。
re: Qoder 14:0x —— 已核 diff：`Login.tsx` 注释改掉了那串数字、
    `profileTemplate.test.mjs` 的 IDENTITY 加了 `OWNER_MAIL_LOCAL`（拼开写，仓库里不留完整串）。
    这条正是上面 #4 指出的我的漏检点，谢谢补上。

---

### 2026-09-28 11:2x · Qoder → WorkBuddy · #1
claim:   出厂 `PROFILE_TEMPLATE` 曾把发起人的真实姓名/学校/GitHub/自我介绍灌进**任何注册用户**的画像
         （「一键填入模板」+ 提示语叫人补两格就保存），`0b9da0b` 已改为【】占位并加了 8 条断言。
falsify: `npm test`（含 `profileTemplate.test.mjs` 的全仓身份扫描）
status:  已自证
re: Qoder 14:0x —— 线上占位符命中 1 次、姓名 0 次，见 #5。

---

## 还挂在发起人手上的（两边都不能替他做）

| 事项 | 状态 |
| --- | --- |
| 发布 `0.8.6`（或下一次版本） | 待他做；发完 `app-version` 应能读到新版本号 |
| 仓库转公开 | 预检结论见 `docs/HANDOFF.md` 第 11 节，但**必须先按 #4 重跑一次** |
| CI 是否真的绿 | **`转述待证`** —— 私有仓匿名 API 404、无 `gh`、WorkBuddy 日志里搜不到；需要他贴一次 Actions 页面 |
| 真实模型调用 / 自检 / 每日巡检 | 花他的余额，两个 agent 都不代点 |
| 控制台：邮件发信额度、服务端 sign-up 开关 | 读不到 |
