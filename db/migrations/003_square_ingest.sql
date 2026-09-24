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
    IF position('|' in v_company) > 0 OR position(E'\uFF5C' in v_company) > 0 OR position('/' in v_company) > 0 THEN
      v_rejected := v_rejected + 1;
      v_reasons := v_reasons || ('公司名像标签行（含竖线/斜杠）: ' || left(v_company, 40));
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
