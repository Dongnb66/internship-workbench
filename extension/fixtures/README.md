# collector.js 验证夹具

七个本地页面，用来验证 `extension/collector.js` 的岗位提取逻辑。

**为什么不直接在真实招聘网站上测**：那等于用别人的站点做自动化测试，既不稳定也不合适。这几个夹具把「列表页」与「详情页」几种 DOM 形态固定下来，站点改版不会影响验证结果，跑一次也不会碰到任何外部服务。真实站点的表现只能靠真跑一次 —— 见 `crawler/README.md` 的「第一次跑怎么确认」。

- `mock-job-list.html` — 6 张重复的岗位卡片（标题 / 薪资 / 城市 / 公司 / 标签 / 链接），验证**重复结构检测**。
- `mock-job-detail.html` — 单岗位详情页，验证**兜底分支**：卡片不足 4 个时退化成「整页 = 1 个岗位」，公司名从 `<title>` 取，城市与薪资从 `h1` 所在容器 + 正文取。这一页同时守住「不能干脆读整页」——导航与推荐位在 `<main>` 外面，读整页就会混进 JD。
- `mock-job-detail-trap.html` — 合规容器（`main`）只剩一条 19 字面包屑、JD 挂在不认识的 class 上。**实习僧详情页的真实形态**：旧实现「第一个命中就用」于是只读到 19 字，比列表摘要还短，被合并规则丢回去，症状是日志一句「补全 0 条 JD」且不报错。这一页钉住「容器都读不到东西时退回整页」。
- `mock-job-detail-multi.html` — 页面上有两个合规容器，**排前面那个是短占位块**。这一页钉住「候选里取最长」：命中即停会读到占位块（SHORTBLOCK），读整页会读到推荐位，两头都要挡。
- `mock-job-detail-title.html` — 页面里**没有 `<h1>`**，岗位名与公司名只存在于 `<title>`，格式是「{岗位}实习招聘-{公司}实习生招聘-{平台}」（实习僧详情页的真实形状）。钉住两件事：岗位段要剥掉尾部「实习招聘」，公司要从「百度实习生招聘」那段里剥出来 —— 而「招聘」二字会让这一段被岗位词规则整体挡掉。
- `mock-job-detail-brandtitle.html` — 反向：`<title>` 是「{公司}招聘 - {岗位}」，公司段在前。钉住「不能把站点招牌当成岗位名」。
- `mock-job-detail-platform.html` — 托管平台自己的页面，`<title>` 里只有「岗位-平台」，**页面上压根没有公司名**。钉住「宁可不给公司名，也不把平台名（智联）写进去」：写错的字段会一路跟着导入、评分、看板，比空字段难发现得多。


## 怎么跑

在浏览器里直接打开 `mock-job-list.html`，页面底部会打印采集结果（JSON）。加 `?format=text` 看文本形态（也就是扩展复制进剪贴板的那种格式）。

想在命令行里跑（无头浏览器，不需要联网）：

```bash
# Windows：把 msedge.exe 换成本机浏览器路径即可
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  --headless=new --disable-gpu --no-sandbox --allow-file-access-from-files \
  --virtual-time-budget=4000 --dump-dom \
  "file:///<仓库绝对路径>/extension/fixtures/mock-job-list.html"
```

在输出的 DOM 里找 `<pre id="iwb-out">`，里面就是采集结果。

## 预期结果

| 夹具 | 预期 |
| --- | --- |
| `mock-job-list.html` | `COUNT=6`，每条都填出公司 / 岗位 / 城市 / 薪资 / 链接 |
| `mock-job-detail.html` | `COUNT=1`，岗位来自 `<h1>`，公司来自 `<title>`，城市 `广州`、薪资 `200-300元/天`；raw 含 `LangGraph` 但**不含**「相关推荐」 |
| `mock-job-detail-trap.html` | `COUNT=1`，raw 必须拿到 JD（含 `LangGraph`、长度 > 200），不能停在 19 字的面包屑上 |
| `mock-job-detail-multi.html` | `COUNT=1`，raw 含 `LangGraph` 且**不含** `SHORTBLOCK`（证明取了最长容器）、**不含**「相关推荐」（证明没退到整页） |
| `mock-job-detail-title.html` | `COUNT=1`，公司 `百度`、岗位 `Agent策略实习生`（不是整串 `<title>`）、城市 `北京`、薪资 `250-400元/天` |
| `mock-job-detail-brandtitle.html` | `COUNT=1`，岗位 `大模型算法实习生`（不是 `星野科技招聘`）、公司 `星野科技` |
| `mock-job-detail-platform.html` | `COUNT=1`，岗位 `UI设计实习生`、公司**必须是空串**（页面里没有公司名，不许填平台名） |

对着这七个夹具的自动断言在 `crawler/selftest.mjs`（`cd crawler && npm run selftest`，用本机 Edge 无头跑，59 条）。

改 `collector.js` 的提取逻辑后请重跑这七条，并确认岗位池的「批量导入」还能吃下文本形态（`---` 分隔 + `公司：`/`岗位：` 标签）。
