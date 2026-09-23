-- 002_resume_attachment.sql · 简历附件与 AI 分析（0.7.6）
--
-- 背景：0.7.5 及以前，简历库只是「登记版本用途」，文件本体放在网盘/本地，
-- 系统里只有一个手填的 file_url 链接。0.7.6 起支持把附件直接传到应用存储
-- （runtime bucket 的 users/<uid>/resumes/ 前缀），并把从 PDF/docx 里提取出
-- 的纯文本和 AI 分析结果一并落在简历行上，AI 分析才能读到简历原文。
--
-- file_path   存储路径（cloud.storage.upload 返回的 path，「打开文件」时按需签发短链）
-- file_name   用户上传时的原始文件名（展示用）
-- content_text 从附件提取出的纯文本（AI 分析的原料；也可手动粘贴维护）
-- analysis    最近一次 AI 分析的结构化结果（JSON，见 src/lib/ai.ts analyzeResume）

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS file_path text;

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS file_name text;

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS content_text text;

ALTER TABLE resumes ADD COLUMN IF NOT EXISTS analysis jsonb;
