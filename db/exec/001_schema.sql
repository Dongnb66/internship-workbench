-- 001_schema.sql · schema · 来源 migrations\001_jobs_public.sql
-- 执行方式：单条语句，一次一个请求（不要多条拼接）

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
