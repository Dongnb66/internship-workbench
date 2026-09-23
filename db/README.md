# db · 数据库迁移与种子数据

云上只有数据库，**没有跑迁移的后端进程** —— 所以这个目录里的 SQL 不会自动执行，
它是给人复读、评审、手工执行的。

```
db/
├── migrations/        # 建表与 RLS 策略，按序号命名
│   └── 001_jobs_public.sql
├── seed/              # 种子数据源（JSON，可提交、可 diff）
│   └── jobs_public.seed.json
├── build-seed.mjs     # seed/*.json → INSERT 语句
└── seed.sql           # build-seed.mjs 的产出（生成物）
```

## 执行顺序

**逐条语句单独执行**（PostgREST 只接受单语句，多条会报
`cannot insert multiple commands into a prepared statement`）：

1. 执行 `migrations/001_jobs_public.sql` 里的语句，建表 + 挂 RLS 策略。
2. 执行 `seed.sql`（或先 `node db/build-seed.mjs` 重新生成）灌入公共岗位。

`seed.sql` 开头是 `DELETE FROM jobs_public;`，所以重复执行不会产生重复行 ——
广场是公共只读库，它的内容只由这里灌入。

## 为什么源数据是 JSON 而不是直接写 SQL

`seed/jobs_public.seed.json` 是可 diff、可评审、可被脚本校验的源；
SQL 是它的产物。这样做的直接好处是**能在灌库之前挡住脏数据**：
`build-seed.mjs` 会拒绝公司名带竖线的行（如「市场 ｜ 应届毕业生 ｜CDG」），
那是抓取器早期版本把竖线标签行误认成公司名留下的。公共库脏了影响所有用户，
所以宁可让构建失败，也不静默导入。

数据来源是真人跑一次本地抓取器（`crawler/`）的真实产出，**清洗后**写入。

## 加新迁移时

按序号续（`002_xxx.sql`），并在文件顶部写清「为什么这么设计」——
这些文件的读者是未来的你和看代码的人，只有 SQL 没有理由等于没法判断能不能改。
