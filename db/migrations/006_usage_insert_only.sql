-- 匿名计数：把 usage_users 收到「只允许 INSERT」（幂等，可安全重放）
--
-- 背景（2026-10-04：真机 + pg_stat_user_tables 判出）：
--   立项设计是「首次 INSERT + 之后 UPDATE last_seen」，但那条匿名 UPDATE 从来没成功过：
--   usage_users n_tup_ins=31 / n_live_tup=10（21 次撞主键），而 n_tup_upd=1 且那 1 次是管理员手工改的。
--   前端统计刻意静默 ⇒ 症状是「界面一切正常，活跃/留存永远停在首访那天」，不报错。
-- 处置：活跃与「装过助手」改为从 usage_events 推导（那张表 INSERT 正常：n_tup_ins=23 / n_live_tup=11），
--   于是 UPDATE 通道整条删掉 —— 少一条会静默失败的链路，权限也能收得更紧。
--
-- 每条语句以分号结尾（执行通道单语句切分，见 001 文件头说明）。

DROP POLICY IF EXISTS usage_users_touch ON public.usage_users;

REVOKE UPDATE ON public.usage_users FROM anon, authenticated;

REVOKE SELECT (anon_id) ON public.usage_users FROM anon, authenticated;

-- 收紧后：usage_users 匿名端只能 INSERT；usage_events 只能 INSERT（无 SELECT 策略）。
-- 聚合统计一律走管理端，SQL 见 docs/CONFIGURATION.md「有多少人在用」一节。
