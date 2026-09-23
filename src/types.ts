export type Row = Record<string, any>

export interface Job extends Row {
  id: number
  company: string
  title: string
  city?: string | null
  job_type?: string | null
  industry?: string | null
  education?: string | null
  salary?: string | null
  source?: string | null
  url?: string | null
  jd_text?: string | null
  tags?: string[] | null
  match_score?: number | null
  priority?: string | null
  status?: string | null
  deadline?: string | null
  notes?: string | null
  created_at?: string
}

/**
 * 岗位广场的公共岗位（`jobs_public` 表）。
 *
 * 与 `Job` 的关键区别：**没有私有字段**。`status` / `priority` / `notes` / `match_score`
 * 都是「某个用户对这个岗位的看法」，属于岗位池；广场是所有用户看到的同一批原始岗位，
 * 只读、无人可写（RLS 只有一条 SELECT 策略）。用户点「加入岗位池」时才把这一行
 * **复制**一份到自己的 `jobs` 表，私有字段在那一刻才初始化。
 */
export interface PublicJob extends Row {
  id: number
  company: string
  title: string
  city?: string | null
  job_type?: string | null
  industry?: string | null
  education?: string | null
  salary?: string | null
  source?: string | null
  url?: string | null
  jd_text?: string | null
  tags?: string[] | null
  deadline?: string | null
  /** 抓到这条岗位的时间，用于展示「新鲜度」 */
  posted_at?: string | null
  created_at?: string
}

export interface Application extends Row {
  id: number
  job_id?: number | null
  company: string
  title: string
  city?: string | null
  stage: string
  channel?: string | null
  resume_id?: number | null
  resume_name?: string | null
  applied_at?: string | null
  next_action?: string | null
  next_action_at?: string | null
  contact?: string | null
  notes?: string | null
  created_at?: string
}

export interface Interview extends Row {
  id: number
  application_id?: number | null
  company: string
  title?: string | null
  round_name?: string | null
  kind?: string | null
  scheduled_at?: string | null
  mode?: string | null
  place?: string | null
  result?: string | null
  questions?: string | null
  reflection?: string | null
}

export interface Offer extends Row {
  id: number
  company: string
  title?: string | null
  city?: string | null
  daily_rate?: number | null
  monthly_salary?: number | null
  allowance?: number | null
  months?: number | null
  start_date?: string | null
  deadline?: string | null
  dims?: Record<string, number> | null
  decision?: string | null
  notes?: string | null
}

export interface Resume extends Row {
  id: number
  name: string
  version?: string | null
  direction?: string | null
  target_role?: string | null
  file_url?: string | null
  /** 附件在应用存储里的永久路径（0.7.6 起上传附件时写入） */
  file_path?: string | null
  /** 上传时的原始文件名（展示用） */
  file_name?: string | null
  /** 从附件提取的纯文本（AI 分析的原料，也可手动粘贴维护） */
  content_text?: string | null
  /** 最近一次 AI 简历分析的结构化结果（src/lib/ai.ts 的 ResumeAnalysis） */
  analysis?: Record<string, unknown> | null
  highlights?: string | null
  projects?: string | null
  used_count?: number | null
  is_default?: boolean | null
  notes?: string | null
}

export interface Task extends Row {
  id: number
  title: string
  kind?: string | null
  due_at?: string | null
  done?: boolean | null
  company?: string | null
  notes?: string | null
}

export interface AiReport extends Row {
  id: number
  company?: string | null
  title?: string | null
  jd_text?: string | null
  score?: number | null
  verdict?: string | null
  dims?: Record<string, number> | null
  highlights?: string | null
  gaps?: string | null
  greeting?: string | null
  model?: string | null
  created_at?: string
}

export interface Profile extends Row {
  id?: number
  full_name?: string | null
  grade?: string | null
  grad_year?: string | null
  major?: string | null
  expect_city?: string[] | null
  expect_type?: string[] | null
  expect_daily?: number | null
  skills?: string[] | null
  directions?: string[] | null
  resume_summary?: string | null
  school?: string | null
  phone?: string | null
  contact_email?: string | null
  github?: string | null
  portfolio?: string | null
  available_from?: string | null
  available_days?: string | null
  self_intro?: string | null
  daily_greet_limit?: number | null
  greet_window?: string | null
  min_interval_min?: number | null
}

export interface Knowledge extends Row {
  id: number
  title: string
  category?: string | null
  content?: string | null
  tags?: string[] | null
  created_at?: string
}

export interface Message extends Row {
  id: number
  application_id?: number | null
  company: string
  title?: string | null
  direction?: string | null
  channel?: string | null
  content?: string | null
  reply_status?: string | null
  sent_at?: string | null
  replied_at?: string | null
  next_follow_at?: string | null
  notes?: string | null
  created_at?: string
}
