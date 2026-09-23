-- 008_schema.sql · schema · 来源 migrations\001_jobs_public.sql
-- 执行方式：单条语句，一次一个请求（不要多条拼接）

CREATE INDEX IF NOT EXISTS jobs_public_city_idx ON jobs_public (city)
