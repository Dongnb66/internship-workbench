-- 岗位广场种子数据（由 db/build-seed.mjs 生成，请勿手工编辑）
-- 共 10 条 · 源数据在 db/seed/*.json
-- 先清空再灌：广场是公共只读库，重复执行不应产生重复行
DELETE FROM jobs_public;

INSERT INTO jobs_public (company, title, city, job_type, industry, education, salary, source, url, jd_text, tags, deadline, posted_at) VALUES
  ('腾讯', 'AI应用工程师', '深圳', '校招', '互联网', '本科', NULL, '官网投递', NULL, '岗位方向：技术 ｜ 应届毕业生 ｜CDG CSIG IEG PCG TEG WXG
工作地点：深圳总部 北京 上海 广州 成都', ARRAY['AI应用', '大模型', 'Python'], NULL, '2026-09-23'),
  ('腾讯', 'AI全栈工程师', '深圳', '校招', '互联网', '本科', NULL, '官网投递', NULL, '岗位方向：技术 ｜ 应届毕业生 ｜CDG CSIG IEG PCG TEG WXG
工作地点：深圳总部 北京 上海 广州 成都 杭州', ARRAY['全栈', 'AI', 'Python'], NULL, '2026-09-23'),
  ('腾讯', 'Agent开发工程师', '深圳', '校招', '互联网', '本科', NULL, '官网投递', NULL, '岗位方向：技术 ｜ 应届毕业生 ｜CDG CSIG IEG PCG TEG WXG
工作地点：深圳总部 北京 上海 广州 成都', ARRAY['Agent', 'LLM', 'Python'], NULL, '2026-09-23'),
  ('腾讯', 'AI算法工程', '深圳', '校招', '互联网', '本科', NULL, '官网投递', NULL, '岗位方向：技术 ｜ 应届毕业生 ｜CSIG IEG PCG TEG WXG
工作地点：深圳总部 北京 上海 广州', ARRAY['算法', 'AI'], NULL, '2026-09-23'),
  ('腾讯', '技术研究-高性能计算方向', '深圳', '校招', '互联网', '本科', NULL, '官网投递', NULL, '岗位方向：技术 ｜ 应届毕业生 ｜CDG CSIG PCG TEG WXG
工作地点：深圳总部 北京 上海 广州 成都 合肥', ARRAY['高性能计算', '技术研究'], NULL, '2026-09-23'),
  ('腾讯', '技术研究-基础架构方向', '深圳', '校招', '互联网', '本科', NULL, '官网投递', NULL, '岗位方向：技术 ｜ 应届毕业生 ｜CDG CSIG TEG WXG
工作地点：深圳总部 北京 上海 广州', ARRAY['基础架构', '技术研究'], NULL, '2026-09-23'),
  ('腾讯', 'AI产品经理', '深圳', '校招', '互联网', '本科', NULL, '官网投递', NULL, '岗位方向：产品 ｜ 应届毕业生 ｜CDG CSIG IEG PCG TEG WXG
工作地点：深圳总部 北京 上海 广州', ARRAY['产品经理', 'AI'], NULL, '2026-09-23'),
  ('腾讯', '投资运营分析师', '北京', '校招', '金融', '本科', NULL, '官网投递', NULL, '岗位方向：市场 ｜ 应届毕业生 ｜CDG
工作地点：北京', ARRAY['投资', '运营', '分析'], NULL, '2026-09-23'),
  ('腾讯', '投资分析', '北京', '校招', '金融', '本科', NULL, '官网投递', NULL, '岗位方向：市场 ｜ 应届毕业生 ｜CDG
工作地点：北京', ARRAY['投资', '分析'], NULL, '2026-09-23'),
  ('腾讯', '游戏策划培训生', '深圳', '校招', '游戏', '本科', NULL, '官网投递', NULL, '岗位方向：产品 ｜ 应届毕业生 ｜IEG PCG
工作地点：深圳总部 北京 上海 杭州', ARRAY['游戏策划', '培训生'], NULL, '2026-09-23');
