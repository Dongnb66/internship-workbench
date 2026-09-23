# 岗位广场建表 · 待执行清单

> ## 结论：**差最后一步 —— 需要你在弹窗里点「确认」**
>
> 已重新核实（2026-09-23 20:10，WorkBuddy 5.6.2），上一次的判断**有一处是错的，已更正**：
>
> ### ✅ 更正：云服务工具是**存在的**，上次搜错了字符串
>
> 上次我搜 `app.asar` 用的是 `workbuddy_cloudservice`（无下划线）→ 命中 0 次，因此断定
> 「工具缺件」。**这是误判。** 正确标识是 `workbuddy_cloud_service`（有下划线），实际命中 **23 次**。
>
> 调用 `workbuddy_cloud_service` 的 `inspect` 成功返回，证据如下：
> ```
> {"activated": false, "count": 2,
>  "applications": [
>    {"appName": "实习工作台",     "applicationId": "wbapp_cj7U3jJ6RwPG2f4tfo273L"},
>    {"appName": "实习工作台小程序", "applicationId": "wbapp_5gjbFMxN0NBYiysW0uwtgh"}]}
> ```
> 也就是说：**应用早就注册好了**（`实习工作台`，绑定在这个项目目录上），只是
> `activated: false` —— 环境还没绑定/开通。
>
> ### ⛔ 仍然卡住的那一环：`activate` 的确认弹窗被关闭了
>
> 我在 20:10 调了 `activate`（`applicationMode: "reuse"`，指向 `wbapp_cj7U3jJ6RwPG2f4tfo273L`），
> 返回：
> ```
> {"activated": false, "cancelled": true, "useLocalImplementation": true,
>  "message": "Cloud service confirmation was dismissed; continue with a local implementation."}
> ```
> **这不是报错，是一个选择** —— 开通云服务会真实占用配额，所以必须由你在 WorkBuddy 弹出的
> 确认框里点同意，我不能替你点，也不能绕过去。**这一步只能你来做。**
>
> ### ⛔ 另一环：数据库管理工具在这台机器上没挂载
>
> 云服务的生命周期工具（inspect / activate）在，但**执行 SQL 的工具不在**。实测：
> ```
> workbuddy_cloudservice_db_exec_sql → "Tool is not available in the current environment or configuration."
> ```
> 即使开通成功，也要等 `workbuddy_cloudservice_db_*` 这几个工具挂上，我才能建表。
>
> ### 界面上的数据库面板也确认没有 SQL 执行区
>
> 它是**只读查看器**（2026-09-23 19:10 核实，官方文案原文未变）：
> - `database.permissions.readOnly`：「RLS policies are read-only in this release.」
> - `database.functions.readOnly`：「Execution and editing are not available in this release.」
> - `database.row.unavailable`：「The row-create API is not available yet」
> - `workspace.capabilityUnavailable.description`：「该模块的管理接口尚未就绪。」
>
> 面板入口在（**设置 → 数据管理 → 已发布的应用 → 点那朵云图标**），但只能选表看数据、
> 加筛选、导出 CSV。
>
> ---
>
> ## 所以「表为什么还不建」的准确答案
>
> 三层，缺一不可，目前卡在第 1 层：
>
> | # | 条件 | 状态 |
> | --- | --- | --- |
> | 1 | 开通云服务（需要你在弹窗点确认） | ❌ **未开通**（`activated: false`，弹窗被关闭） |
> | 2 | 数据库管理工具挂载（`workbuddy_cloudservice_db_exec_sql`） | ❌ 未挂载（本构建缺件） |
> | 3 | 建表语句（19 条） | ✅ 已就绪，就在本文件下面 |
>
> **第 3 层完全就绪，第 1、2 层都不在我能操作的范围内。** 上次说「没有任何地方可以执行」
> 不够准确 —— 准确说法是：**开通要你点确认，执行工具还没挂上，两件事都得等。**
>
> 代码侧已 100% 就绪，表一建好广场立刻有 10 条岗位。

---

## 语句清单（备查 · 等上面两环就绪后由助手执行）

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

## 如果有一天能执行了

判断标准很简单，**两个条件都满足**：
1. 云服务已开通（`workbuddy_cloud_service` 的 `inspect` 返回 `activated: true`）；
2. 助手能调通 `workbuddy_cloudservice_db_exec_sql`。

两者齐了就告诉我，我会一次性把表建好并灌数据（19 条语句）。只满足第 1 条不够 ——
执行工具没挂上一样建不了。
