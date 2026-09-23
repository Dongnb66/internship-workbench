-- 002_schema.sql · schema · 来源 migrations\001_jobs_public.sql
-- 执行方式：单条语句，一次一个请求（不要多条拼接）

COMMENT ON TABLE jobs_public IS '岗位广场：公共岗位库，所有登录用户只读，仅服务端可写'
