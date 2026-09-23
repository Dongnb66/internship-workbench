-- 018_schema.sql · schema · 来源 migrations\003_square_ingest.sql
-- 执行方式：单条语句，一次一个请求（不要多条拼接）

COMMENT ON FUNCTION public.jobs_public_ingest(jsonb, text) IS '岗位广场推送通道：SECURITY DEFINER 唯一写入口，内置配额/挡板/去重，仅 authenticated 可调'
