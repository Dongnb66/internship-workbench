# collector.js 验证夹具

两个本地页面，用来验证 `extension/collector.js` 的岗位提取逻辑。

**为什么不直接在真实招聘网站上测**：那等于用别人的站点做自动化测试，既不稳定也不合适。这两个夹具把「列表页」与「详情页」两种 DOM 形态固定下来，站点改版不会影响验证结果，跑一次也不会碰到任何外部服务。

- `mock-job-list.html` — 6 张重复的岗位卡片（标题 / 薪资 / 城市 / 公司 / 标签 / 链接），验证**重复结构检测**。
- `mock-job-detail.html` — 单岗位详情页，验证**兜底分支**：卡片不足 4 个时退化成「整页 = 1 个岗位」，公司名从 `<title>` 取，城市与薪资从 `h1` 所在容器 + 正文取。

## 怎么跑

在浏览器里直接打开 `mock-job-list.html`，页面底部会打印采集结果（JSON）。加 `?format=text` 看文本形态（也就是扩展复制进剪贴板的那种格式）。

想在命令行里跑（无头浏览器，不需要联网）：

```bash
# Windows：把 msedge.exe 换成本机浏览器路径即可
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  --headless=new --disable-gpu --no-sandbox --allow-file-access-from-files \
  --virtual-time-budget=4000 --dump-dom \
  "file:///<仓库绝对路径>/extension/__fixtures__/mock-job-list.html"
```

在输出的 DOM 里找 `<pre id="iwb-out">`，里面就是采集结果。

## 预期结果

| 夹具 | 预期 |
| --- | --- |
| `mock-job-list.html` | `COUNT=6`，每条都填出公司 / 岗位 / 城市 / 薪资 / 链接 |
| `mock-job-detail.html` | `COUNT=1`，岗位来自 `<h1>`，公司来自 `<title>`，城市 `广州`、薪资 `200-300元/天` |

改 `collector.js` 的提取逻辑后请重跑这两条，并确认岗位池的「批量导入」还能吃下文本形态（`---` 分隔 + `公司：`/`岗位：` 标签）。
