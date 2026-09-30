-- 私有表 RLS 策略 · 权威存档（幂等，可安全重放）
--
-- ⚠️ 本文件是线上已应用策略的**权威存档**，不是待执行的新迁移：
--   10 张私有表在生产库均已启用下述策略（与 docs/CONFIGURATION.md §3 一致）。
--   入库存档的原因：安全声明必须能被「打开 db/ 目录现场验证」，
--   只写在文档里的 SQL 等于没有证据。
--   幂等形式（DROP IF EXISTS + IF NOT EXISTS）使其同时可用于新环境重建。
--
-- 模型：除公共岗位库外，每张私有表一个 ALL 策略：
--   USING (owner_id = auth.uid())      —— 读自己
--   WITH CHECK (owner_id = auth.uid()) —— 写也只能写自己的行（没有它，
--      UPDATE 可以把行改成别人的 owner_id，等于越权后门，所以必须双写）
-- owner_id 由数据库 DEFAULT auth.uid() 兜底，前端永不传（源码级守卫见
-- src/lib/__tests__/rlsGuards.test.mjs）。
-- ⚠️ 每条语句以分号结尾（执行通道单语句切分，见 001 文件头说明）。

-- ============ jobs（岗位池） ============
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT auth.uid();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO authenticated, anon;

DROP POLICY IF EXISTS jobs_own ON public.jobs;

CREATE POLICY jobs_own ON public.jobs
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ============ applications（投递记录） ============
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT auth.uid();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.applications TO authenticated, anon;

DROP POLICY IF EXISTS applications_own ON public.applications;

CREATE POLICY applications_own ON public.applications
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ============ interviews（面试记录） ============
ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.interviews ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT auth.uid();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.interviews TO authenticated, anon;

DROP POLICY IF EXISTS interviews_own ON public.interviews;

CREATE POLICY interviews_own ON public.interviews
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ============ offers（录用） ============
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT auth.uid();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.offers TO authenticated, anon;

DROP POLICY IF EXISTS offers_own ON public.offers;

CREATE POLICY offers_own ON public.offers
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ============ resumes（简历附件） ============
ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.resumes ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT auth.uid();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.resumes TO authenticated, anon;

DROP POLICY IF EXISTS resumes_own ON public.resumes;

CREATE POLICY resumes_own ON public.resumes
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ============ tasks（待办） ============
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT auth.uid();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated, anon;

DROP POLICY IF EXISTS tasks_own ON public.tasks;

CREATE POLICY tasks_own ON public.tasks
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ============ ai_reports（AI 报告） ============
ALTER TABLE public.ai_reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_reports ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT auth.uid();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_reports TO authenticated, anon;

DROP POLICY IF EXISTS ai_reports_own ON public.ai_reports;

CREATE POLICY ai_reports_own ON public.ai_reports
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ============ messages（消息） ============
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT auth.uid();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated, anon;

DROP POLICY IF EXISTS messages_own ON public.messages;

CREATE POLICY messages_own ON public.messages
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ============ knowledge（知识库） ============
ALTER TABLE public.knowledge ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.knowledge ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT auth.uid();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge TO authenticated, anon;

DROP POLICY IF EXISTS knowledge_own ON public.knowledge;

CREATE POLICY knowledge_own ON public.knowledge
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ============ profile（画像） ============
ALTER TABLE public.profile ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profile ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT auth.uid();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile TO authenticated, anon;

DROP POLICY IF EXISTS profile_own ON public.profile;

CREATE POLICY profile_own ON public.profile
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());
