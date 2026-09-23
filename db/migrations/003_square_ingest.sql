-- 003_square_ingest.sql · 岗位广场推送通道（0.7.6+，路线 A 本地 agent 网关的灌库出口）
--
-- 背景：jobs_public 对所有用户只读（RLS 只有 SELECT 策略），广场数据只能由
-- 服务端灌入。0.7.6 之前是「真人跑抓取 → 手工执行 SQL」；本地 agent 网关上线后，
-- 前端带着登录态调用本函数即可推送，无需任何服务端密钥。
--
-- 安全模型（SECURITY DEFINER 唯一写入口）：
-- - EXECUTE 仅 authenticated（REVOKE FROM PUBLIC 后 GRANT）
-- - 函数内 auth.uid() 取当前用户，未登录直接异常
-- - 每人每日 200 条配额（ingested_by 计数），防误操作/滥用刷爆公共库
-- - 与 db/build-seed.mjs 同口径的挡板：空值/竖线标签行公司名一律拒绝
-- - (company, title) 已存在则跳过（幂等，重复推送安全）
-- - 字段长度清洗（company≤60 / title≤120 / jd≤8000）
--
-- 调用：SELECT * FROM jobs_public_ingest('[{"company":..,"title":..}]'::jsonb, '官网投递')
-- 返回：{"inserted": n, "skipped_duplicate": n, "rejected": n, "reasons": [...]}

ALTER TABLE jobs_public ADD COLUMN IF NOT EXISTS ingested_by text;

CREATE OR REPLACE FUNCTION public.jobs_public_ingest(p_jobs jsonb, p_source text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid text;
  v_job jsonb;
  v_company text;
  v_title text;
  v_inserted int := 0;
  v_dup int := 0;
  v_rejected int := 0;
  v_today int;
  v_reasons text[] := ARRAY[]::text[];
  v_job_type text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR v_uid = '' THEN
    RAISE EXCEPTION '需要登录后才能向岗位广场推送岗位';
  END IF;

  -- 配额：每人每天最多 200 条，防止误操作或滥用刷爆公共库
  SELECT count(*) INTO v_today FROM jobs_public
   WHERE ingested_by = v_uid AND created_at >= date_trunc('day', now());
  IF v_today + COALESCE(jsonb_array_length(p_jobs), 0) > 200 THEN
    RAISE EXCEPTION '今日已推送 % 条，超过每人每日 200 条上限', v_today;
  END IF;

  FOR v_job IN SELECT * FROM jsonb_array_elements(p_jobs) LOOP
    v_company := btrim(coalesce(v_job ->> 'company', ''));
    v_title := btrim(coalesce(v_job ->> 'title', ''));

    -- 挡板：与 build-seed 同口径，标签行/空值一律拒绝，脏数据不进公共库
    IF v_company = '' OR v_title = '' THEN
      v_rejected := v_rejected + 1;
      v_reasons := v_reasons || ('缺公司名或岗位名: ' || left(coalesce(v_title, '(空)'), 40));
      CONTINUE;
    END IF;
    IF position('|' in v_company) > 0 OR position(E'\uFF5C' in v_company) > 0 THEN
      v_rejected := v_rejected + 1;
      v_reasons := v_reasons || ('公司名像标签行: ' || left(v_company, 40));
      CONTINUE;
    END IF;

    -- 去重：同公司同名岗位已在公共库则跳过
    IF EXISTS (SELECT 1 FROM jobs_public WHERE company = v_company AND title = v_title) THEN
      v_dup := v_dup + 1;
      CONTINUE;
    END IF;

    v_job_type := CASE WHEN v_title ILIKE '%实习%' OR v_title ILIKE '%intern%' THEN '实习' ELSE '校招' END;

    INSERT INTO jobs_public (company, title, city, job_type, industry, salary, source, url, jd_text, posted_at, ingested_by)
    VALUES (
      left(v_company, 60),
      left(v_title, 120),
      NULLIF(left(btrim(coalesce(v_job ->> 'city', '')), 40), ''),
      v_job_type,
      '互联网',
      NULLIF(left(btrim(coalesce(v_job ->> 'salary', '')), 40), ''),
      NULLIF(left(btrim(p_source), 40), '官网投递'),
      NULLIF(left(btrim(coalesce(v_job ->> 'url', '')), 500), ''),
      left(btrim(coalesce(v_job ->> 'jd_text', v_job ->> 'raw', '')), 8000),
      now(),
      v_uid
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'skipped_duplicate', v_dup,
    'rejected', v_rejected,
    'reasons', to_jsonb(v_reasons)
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.jobs_public_ingest(jsonb, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.jobs_public_ingest(jsonb, text) TO authenticated;

COMMENT ON FUNCTION public.jobs_public_ingest(jsonb, text) IS '岗位广场推送通道：SECURITY DEFINER 唯一写入口，内置配额/挡板/去重，仅 authenticated 可调';
