-- 006_schema.sql · schema · 来源 migrations\001_jobs_public.sql
-- 执行方式：单条语句，一次一个请求（不要多条拼接）

CREATE POLICY jobs_public_read_all ON jobs_public
  FOR SELECT TO authenticated, anon
  USING (true)
