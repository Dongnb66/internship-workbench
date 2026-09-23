-- 017_schema.sql · schema · 来源 migrations\003_square_ingest.sql
-- 执行方式：单条语句，一次一个请求（不要多条拼接）

GRANT EXECUTE ON FUNCTION public.jobs_public_ingest(jsonb, text) TO authenticated
