-- 013_schema.sql · schema · 来源 migrations\002_resume_attachment.sql
-- 执行方式：单条语句，一次一个请求（不要多条拼接）

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS analysis jsonb
