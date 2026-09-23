# 岗位广场建表 · 待执行清单

> ## 最新状态（2026-09-23 20:22）：**云服务已开通，只差执行工具**
>
> ### ✅ 第 1 层已完成：云服务已开通
>
> 2026-09-23 20:21，`workbuddy_cloud_service` 的 `activate` 成功：
> ```
> {"activated": true, "appName": "实习工作台",
>  "applicationId": "wbapp_cj7U3jJ6RwPG2f4tfo273L",
>  "billingStatus": "normal", "provisionStatus": "assigned",
>  "publicConfig": {"endpoint": "https://internship-workbench-47024.app.workbuddy.host",
>                   "publishableKey": "wbpk_cj7U3jJ6RwPG2f4tfo273L_..."}}
> ```
> 这两个值与 `src/cloud.ts` 里**早已写好**的配置一致 —— 前端侧不需要再改任何东西。
>
> ### ⛔ 唯一还缺的：执行 SQL 的工具没挂载
>
> ```
> workbuddy_cloudservice_db_exec_sql → "Tool is not available in the current environment or configuration."
> ```
> 云服务生命周期工具（inspect / activate）可用，但**数据库管理工具（`db_exec_sql` /
> `db_list_tables` / `db_describe_table` / `db_list_rls`）在本构建里没有挂载**。
>
> 官方文档（`cloud-service/references/database/management.md`）写得很明确：schema 操作
> **只能走这些 MCP 工具** —— *"All of this runs through the built-in MCP tools — never through a
> front-end SDK, never through a shell script, never by hitting a provider console directly."*
>
> 所以这不是我偷懒或走错路：**没有替代通道**，工具一出我就能建表。
>
> ### 上次的更正（保留备查）
>
> 上一轮我判定「云服务工具不存在」是**错的** —— 我 `grep` 时用了 `workbuddy_cloudservice`
> （无下划线）→ 0 次，正确标识是 `workbuddy_cloud_**service**`（有下划线）→ 23 次。
> **教训：一个标识符搜不到不等于不存在，要试命名变体，更要直接调用（报错信息比 grep 可信）。**
>
> ---
>
> ## 「表为什么还不建」的准确答案
>
> | # | 条件 | 状态 |
> | --- | --- | --- |
> | 1 | 开通云服务 | ✅ **已完成**（2026-09-23 20:21） |
> | 2 | 数据库管理工具挂载 | ❌ **本构建缺件**（唯一阻塞项） |
> | 3 | 19 条建表语句 | ✅ 已就绪，就在本文件下面 |
>
> **只剩第 2 层，且它不在我能操作的范围内。** 工具一挂上，我立刻执行下面 19 条。

---

## 语句清单（备查 · 等工具挂载后由助手执行）

**执行规则：一次一条，`mode: "migrate"`。** 工具不接受多语句。

---

## 第一部分：建表 + 只读 RLS（共 8 条）

### 1/8 建表

```sql
CREATE TABLE IF NOT EXISTS jobs_public (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company     TEXT        NOT NULL,
  title       TEXT        NOT NULL,
  city        TEXT,
  job_type    TEXT        DEFAULT '实习',
  industry    TEXT        DEFAULT '互联网',
  education   TEXT,
  salary      TEXT,
  source      TEXT,
  url         TEXT,
  jd_text     TEXT,
  tags        TEXT[],
  deadline    DATE,
  posted_at   TIMESTAMPTZ DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

### 2/8 表注释

```sql
COMMENT ON TABLE jobs_public IS '岗位广场：公共岗位库，所有登录用户只读，仅服务端可写'
```

### 3/8 开启 RLS

```sql
ALTER TABLE jobs_public ENABLE ROW LEVEL SECURITY
```

### 4/8 授权（只给 SELECT）

```sql
GRANT SELECT ON TABLE public.jobs_public TO authenticated, anon
```

### 5/8 删旧策略（幂等）

```sql
DROP POLICY IF EXISTS jobs_public_read_all ON jobs_public
```

### 6/8 建读策略（所有人可读）

```sql
CREATE POLICY jobs_public_read_all ON jobs_public FOR SELECT TO authenticated, anon USING (true)
```

### 7/8 索引：发布时间倒序

```sql
CREATE INDEX IF NOT EXISTS jobs_public_posted_at_idx ON jobs_public (posted_at DESC)
```

### 8/8 索引：城市 + 类型

```sql
CREATE INDEX IF NOT EXISTS jobs_public_city_idx ON jobs_public (city)
```

```sql
CREATE INDEX IF NOT EXISTS jobs_public_job_type_idx ON jobs_public (job_type)
```

> 注：第 8 项是两条语句，所以实际是 9 条。加上灌数据 10 条，共 19 条。

---

## 第二部分：灌入 10 条种子岗位（共 10 条）

> 先执行这一条清空（可重复执行不出重复行）：

```sql
DELETE FROM jobs_public
```

然后逐条执行下面 10 条（完整版见 `db/seed.sql`，文件里就是这些，直接复制亦可）：

```sql
INSERT INTO jobs_public (company, title, city, job_type, industry, education, salary, source, url, tags, jd_text, posted_at) VALUES ('腾讯', 'AI应用工程师', '深圳', '校招', '互联网', '本科及以上', '面议', '官网投递', 'https://join.qq.com/', ARRAY['AI','Agent','LLM'], '负责 AI 应用产品的设计与落地，参与大模型应用链路搭建、Prompt 工程与效果调优。要求熟悉 Python，了解 LLM 应用开发范式，有 Agent / RAG 相关实践优先。', '2026-09-23')
```

```sql
INSERT INTO jobs_public (company, title, city, job_type, industry, education, salary, source, url, tags, jd_text, posted_at) VALUES ('腾讯', 'AI全栈工程师', '深圳', '校招', '互联网', '本科及以上', '面议', '官网投递', 'https://join.qq.com/', ARRAY['全栈','AI','前端'], '负责 AI 相关产品的前后端全栈开发，覆盖界面实现、服务接口与模型调用链路。要求掌握 React 或同类前端框架，熟悉 Node / Python 服务端开发。', '2026-09-23')
```

```sql
INSERT INTO jobs_public (company, title, city, job_type, industry, education, salary, source, url, tags, jd_text, posted_at) VALUES ('腾讯', 'Agent开发工程师', '深圳', '校招', '互联网', '本科及以上', '面议', '官网投递', 'https://join.qq.com/', ARRAY['Agent','LangGraph','多智能体'], '负责智能体（Agent）系统的架构设计与工程实现，包括工具调用、记忆体系、多智能体协同与评测。要求熟悉 LangChain / LangGraph 等框架，理解 RAG 与上下文管理。', '2026-09-23')
```

```sql
INSERT INTO jobs_public (company, title, city, job_type, industry, education, salary, source, url, tags, jd_text, posted_at) VALUES ('腾讯', 'AI算法工程师', '深圳', '校招', '互联网', '硕士及以上', '面议', '官网投递', 'https://join.qq.com/', ARRAY['算法','深度学习','NLP'], '负责 AI 算法研究与应用落地，方向包括自然语言处理、多模态理解与生成。要求扎实的机器学习基础，熟悉 PyTorch 等框架。', '2026-09-23')
```

```sql
INSERT INTO jobs_public (company, title, city, job_type, industry, education, salary, source, url, tags, jd_text, posted_at) VALUES ('腾讯', '技术研究-高性能计算方向', '深圳', '校招', '互联网', '硕士及以上', '面议', '官网投递', 'https://join.qq.com/', ARRAY['高性能计算','CUDA','推理加速'], '负责大模型推理与训练的高性能计算优化，包括算子优化、分布式训练与推理加速。要求熟悉 CUDA / C++，了解主流推理框架。', '2026-09-23')
```

```sql
INSERT INTO jobs_public (company, title, city, job_type, industry, education, salary, source, url, tags, jd_text, posted_at) VALUES ('腾讯', '技术研究-基础架构方向', '深圳', '校招', '互联网', '本科及以上', '面议', '官网投递', 'https://join.qq.com/', ARRAY['基础架构','分布式','云原生'], '负责基础架构与中间件研发，包括分布式存储、微服务治理与云原生平台建设。要求熟悉 Linux 与至少一门系统级语言。', '2026-09-23')
```

```sql
INSERT INTO jobs_public (company, title, city, job_type, industry, education, salary, source, url, tags, jd_text, posted_at) VALUES ('腾讯', 'AI产品经理', '深圳', '校招', '互联网', '本科及以上', '面议', '官网投递', 'https://join.qq.com/', ARRAY['产品','AI','需求分析'], '负责 AI 产品规划与需求落地，衔接算法、工程与设计团队。要求对 AI 技术边界有基本认知，具备较强的用户洞察与文档能力。', '2026-09-23')
```

```sql
INSERT INTO jobs_public (company, title, city, job_type, industry, education, salary, source, url, tags, jd_text, posted_at) VALUES ('腾讯', '投资运营分析师', '深圳', '校招', '互联网', '本科及以上', '面议', '官网投递', 'https://join.qq.com/', ARRAY['投资','运营','数据分析'], '负责投资相关的数据整理、运营分析与投后跟进。要求较强的数据敏感度，熟悉 Excel / SQL 等工具。', '2026-09-23')
```

```sql
INSERT INTO jobs_public (company, title, city, job_type, industry, education, salary, source, url, tags, jd_text, posted_at) VALUES ('腾讯', '投资分析', '深圳', '校招', '互联网', '本科及以上', '面议', '官网投递', 'https://join.qq.com/', ARRAY['投资','财务分析','研究'], '负责行业研究与投资标的分析，输出研究报告与投资建议。要求扎实的财务分析能力与行业研究功底。', '2026-09-23')
```

```sql
INSERT INTO jobs_public (company, title, city, job_type, industry, education, salary, source, url, tags, jd_text, posted_at) VALUES ('腾讯', '游戏策划培训生', '深圳', '校招', '互联网', '本科及以上', '面议', '官网投递', 'https://join.qq.com/', ARRAY['游戏策划','数值','文案'], '参与游戏产品的策划工作，方向包括玩法设计、数值平衡与文案表达。要求热爱游戏，具备良好的逻辑与表达能力。', '2026-09-23')
```

---

## 第三部分：验证（1 条）

执行完上面全部后，跑这条确认：

```sql
SELECT company, title, city, job_type, posted_at FROM jobs_public ORDER BY posted_at DESC
```

预期：返回 **10 行**，`company` 全部是「腾讯」，没有一条像「市场 ｜ 应届毕业生 ｜CDG」这样的标签行。

---

## 什么信号出现时，说明可以建表了

条件 1（云服务已开通）**已在 2026-09-23 20:21 满足**。现在只剩条件 2：

> 助手能调通 `workbuddy_cloudservice_db_exec_sql`（不再返回
> `"not available in the current environment or configuration"`）。

这个信号一出现，告诉我一声，我会一次性执行下面 19 条语句并灌入 10 条种子岗位。
**不需要你手工做任何事** —— 我不会让你去啃 SQL 或找什么执行窗口。
