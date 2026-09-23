# QUICKSTART · 5 分钟跑起来

## 0. 前置

- Node.js ≥ 20（本仓库开发时用 22）
- 一个可用的邮箱（用于登录，验证码发到邮箱）

## 1. 克隆与安装

```bash
git clone https://github.com/Dongnb66/internship-workbench.git
cd internship-workbench
npm install
```

## 2. 配置云端地址

打开 `src/cloud.ts`，确认两个公开配置：

```ts
export const publicConfig = {
  endpoint: 'https://<你的应用>.app.workbuddy.host',
  publishableKey: 'wbpk_xxxxxxxx',
}
```

这两个值是**可公开**的（publishable），真正的数据隔离靠数据库 RLS 而不是靠藏 key。
如果只想本地跑通界面，用仓库默认值即可，但登录会失败（见第 4 步说明）。

## 3. 本地开发

```bash
npm run dev          # http://localhost:5173
```

## 4. 关于登录

登录页默认是「验证码登录 / 注册」：**填邮箱 → 收验证码 → 提交，首次使用会自动注册并登录**，不需要先单独注册。想以后用密码直接登录，就在验证码那栏顺手设一个密码。

两点限制来自认证服务本身，不是本项目的实现问题：

- 邮箱验证码登录 / 注册**只在应用的正式发布域上可用**（服务端会校验请求 Origin）。因此访问 `localhost:5173` 只能看到登录页，收不到验证码。需要本地也能登录时，把 `src/cloud.ts` 的 `endpoint` 指向你自己的云服务实例，并在该实例上放行你的本地 Origin。
- **手机号 / 短信与微信登录网页端不支持**，只有小程序端开放短信与微信通道 —— 小程序端已经在本仓库里（`miniprogram/`，见 README「微信小程序端」）。详见 [`FAQ.md`](FAQ.md)。

## 5. 第一次使用（建议顺序）

1. **目标条件**（配置页）→ 点「填入模板」→ 补齐手机号、邮箱 → 保存。
   `项目与可验证事实` 这一栏是 AI 生成话术时的唯一事实来源，务必写真实。
2. **岗位广场** → 挑几个岗位点「加入岗位池」（这是公共岗位库，零成本，不用自己抓）。
   想用真实且更新的数据，改用「岗位池 → 批量导入」或跑一次本地抓取器（见第 7 节）。
3. **岗位池** → 也可以手动新增 2–3 个岗位，粘贴完整 JD。
4. **岗位池** → 勾选这几条 → 「批量 AI 评分」→ 等它跑完，看匹配度与七维打分。
5. **岗位池** → 匹配度 ≥ 55 的「转入投递」。
6. **投递看板** → 复制打招呼话术发出去 → 点卡片「会话」→ 勾满 6 条自检 → 登记「已发打招呼」。
7. **总览** → 看「今日投递节奏」与「超期未回复」。

## 6. Chrome 扩展（可选）

```bash
# 在应用里「网申填写包」页点「导出 applykit.json」
```

1. 打开 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点「加载已解压的扩展程序」→ 选本仓库的 `extension/` 目录
4. 在扩展弹窗里导入刚导出的 `applykit.json`
5. 打开任意网申页面 → 点扩展 → 「一键填充」

详见 [`extension/README.md`](../extension/README.md)。

## 7. 本地抓取器（可选，批量搞岗位）

想在一天之内把几个公司官网的校招岗位一次性捞进岗位池时用。跑在你自己机器上，驱动你已装的 Edge / Chrome。

```bash
cd crawler
npm install                                     # 只装 playwright-core，不下载浏览器
npm run sites                                   # 看内置站点表
npm run crawl -- --site tencent --keyword 前端      # 翻页 + 逐个补 JD
```

产出在 `crawler/output/<站点>-<时间>.json` → 工作台「岗位池 → 批量导入 → 选择抓取结果文件」选它 → 核对 → 入库。

- 需要登录的站点（如 BOSS 直聘）先跑一次 `npm run login -- --site boss`，在弹出的窗口里自己登录，登录态存在 `crawler/.profile`（已 gitignore）。
- 抓不到东西：加 `--dump` 存渲染快照，或 `--headed` 亲眼看一遍。
- 站点表里除腾讯外**大多未验证**，第一次跑某个站点时可能要用 `--url` 直接给地址。详见 [`crawler/README.md`](../crawler/README.md)。

## 8. 命令速查

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 本地开发服务器（绑 0.0.0.0） |
| `npm run build` | 类型检查 + 生产构建到 `dist/` |
| `npm start` | 构建 + 预览（读 `$PORT`） |
| `npm run typecheck` | 只跑 `tsc -b` |
| `npm run test` | Vitest 单测（前端 + 抓取器纯逻辑） |
| `npm run lint` | oxlint |
| `cd crawler && npm run selftest` | 真浏览器跑抓取器夹具自检（需 Edge / Chrome） |
