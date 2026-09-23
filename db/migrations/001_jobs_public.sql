-- 岗位广场 · 公共岗位表（jobs_public）
--
-- 设计要点：这张表表达的是「所有人都能读、没有人能写」。
--   * SELECT 策略 USING (true) —— 不绑定 owner_id，所有登录用户看到同一批岗位
--   * 不建 INSERT / UPDATE / DELETE 策略 —— PostgreSQL 的 RLS 默认拒绝，
--     所以任何客户端写操作都会失败（42501），前端也没有任何写它的代码
--   * 内容只由工作台侧通过 exec_sql（migrate/write 角色）灌入
--
-- 执行方式：逐条语句单独执行（PostgREST 的单语句限制），一条一个请求。

-- 1) 建表
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

-- 2) 表注释（数据库管理界面会显示）
COMMENT ON TABLE jobs_public IS '岗位广场：公共岗位库，所有登录用户只读，仅服务端可写'

-- 3) 开启 RLS
ALTER TABLE jobs_public ENABLE ROW LEVEL SECURITY

-- 4) 授权（只给 SELECT —— 写入不授权，从第一道门就关掉）
GRANT SELECT ON TABLE public.jobs_public TO authenticated, anon

-- 5) 唯一的策略：所有人可读
DROP POLICY IF EXISTS jobs_public_read_all ON jobs_public
CREATE POLICY jobs_public_read_all ON jobs_public
  FOR SELECT TO authenticated, anon
  USING (true)

-- 6) 索引：广场按城市 / 类型筛选，按发布时间倒序展示
CREATE INDEX IF NOT EXISTS jobs_public_posted_at_idx ON jobs_public (posted_at DESC)
CREATE INDEX IF NOT EXISTS jobs_public_city_idx ON jobs_public (city)
CREATE INDEX IF NOT EXISTS jobs_public_job_type_idx ON jobs_public (job_type)
