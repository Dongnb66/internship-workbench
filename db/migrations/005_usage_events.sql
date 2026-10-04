-- 匿名使用计数 · 权威存档（幂等，可安全重放）
--
-- 目的：项目发出去之后要能回答「有多少人在用、卡在哪一步」。
--   没有这两个数字，简历/作品集上只能写「自用」，写不出「N 位真实用户、漏斗从 X% 提到 Y%」。
--
-- 设计取自三个开源实现（2026-10-04 读源码后定的，不是自己拍脑袋）：
--   · garrytan/gstack  supabase/migrations/001_telemetry.sql
--       → 除事件表外**必须还有一张"用户表"**（installations: first_seen/last_seen）：
--         人数与活跃/留存直接查它，不用扫事件表；事件带 schema_version 做前向兼容。
--   · var-raphael/Gnat
--       → 稳定匿名 id（distinct_id）+ track(事件名, 属性) + 漏斗视角。
--   · OpenLabs-so/openanalytics
--       → 隐私模型：无 cookie、无指纹、不跨站；尊重 Global Privacy Control。
--
-- 隐私边界（改这个文件前先读）：
--   · 只存事件名 + 时间 + 版本 + 本机随机匿名 id；岗位/简历/投递内容一律不存（detail 只允许数字）。
--   · 匿名 id 可随时重置：清 localStorage 就换新身份，不绑定邮箱/账号。
--   · 匿名端只允许 INSERT/UPDATE，**没有任何 SELECT 策略** —— 统计走管理端。
--     这是与 gstack 的一处刻意不同：它整库都是匿名遥测所以放开了 SELECT；
--     我们这张表旁边是别人的简历与投递记录，不能让人拿匿名键去读。
--
-- 每条语句以分号结尾（执行通道单语句切分，见 001 文件头说明）。

CREATE TABLE IF NOT EXISTS public.usage_users (
  anon_id TEXT PRIMARY KEY,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  app_version TEXT,
  os TEXT,
  agent_installed BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  schema_version INTEGER NOT NULL DEFAULT 1,
  anon_id TEXT NOT NULL,
  event TEXT NOT NULL,
  app_version TEXT,
  detail JSONB
);

-- ⚠️ 索引表达式里**不能**写 `(received_at AT TIME ZONE 'UTC')::date`：
--    实测在本项目的执行通道上报 `42601 syntax error at or near "::"`（2026-10-04 首次执行时踩到）。
--    同样的 cast 放在 SELECT 里是合法的（`SELECT (now() AT TIME ZONE 'UTC')::date` 能跑），
--    只有放进 CREATE INDEX 的表达式上下文会挂 —— 所以这不是 cast 本身非法。
--    等价的函数形式 date(…) 语义相同、能正常建索引，**重放本文件请用下面这一行**。
CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_events_daily
  ON public.usage_events (anon_id, event, date(received_at AT TIME ZONE 'UTC'));

CREATE INDEX IF NOT EXISTS idx_usage_events_time ON public.usage_events (received_at);

CREATE INDEX IF NOT EXISTS idx_usage_events_event ON public.usage_events (event, received_at);

ALTER TABLE public.usage_users ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

GRANT INSERT, UPDATE ON public.usage_users TO authenticated, anon;

GRANT INSERT ON public.usage_events TO authenticated, anon;

DROP POLICY IF EXISTS usage_users_insert ON public.usage_users;

CREATE POLICY usage_users_insert ON public.usage_users
  FOR INSERT TO authenticated, anon
  WITH CHECK (true);

DROP POLICY IF EXISTS usage_users_touch ON public.usage_users;

CREATE POLICY usage_users_touch ON public.usage_users
  FOR UPDATE TO authenticated, anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS usage_events_insert ON public.usage_events;

CREATE POLICY usage_events_insert ON public.usage_events
  FOR INSERT TO authenticated, anon
  WITH CHECK (true);

-- 故意不建 SELECT 策略：匿名端读不到（否则匿名键就成了读库通道）。
-- 聚合 SQL 见 docs/CONFIGURATION.md「有多少人在用」一节，用管理端跑。

-- ============ 权限收紧（2026-10-04，WorkBuddy 审出平台默认给了 SELECT；发起人已同意） ============
-- 背景：information_schema 显示 anon / authenticated 对这两张表有平台默认的 SELECT 授权。
-- 当前读不到任何行靠的是「RLS 已开 + 没有 SELECT 策略」这单层；万一将来有人 DISABLE RLS 或
-- 平台迁移重建表时默认带策略，那层授权会立刻生效 —— 而这两张表旁边是别人的简历与投递记录。
-- 所以把 SELECT 收回，只留 INSERT / UPDATE。
--
-- ⚠️ 但**不能只做全表 REVOKE**：PostgreSQL 的 `UPDATE ... WHERE anon_id = $1` 需要**被读列的 SELECT 权限**，
--    全表收回会把 usage_users 的 last_seen 更新打死；而前端统计是刻意静默的（不抛错）⇒ 症状是
--    「看着没坏、活跃数据永远是首见那天」。故把 anon_id 这一列授回来（列级），真实可读性仍由
--    「RLS 已开 + 无 SELECT 策略」兜住：有列权限也读不到任何一行。
REVOKE SELECT ON public.usage_users, public.usage_events FROM anon, authenticated;

GRANT SELECT (anon_id) ON public.usage_users TO anon, authenticated;
