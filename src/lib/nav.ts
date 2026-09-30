/**
 * 导航信息架构（2026-09-30 UX 收敛批 1）。
 *
 * 为什么存在：原导航 14 项按「功能」平铺，用户要自己脑补哪一步用哪个页；
 * 商业对标（Huntr/Teal/Careerflow）全部收敛在 7 个顶层区，组织单位是
 * 「求职旅程的一段」，不是「一个功能」。本模块是唯一权威数据源：
 * App.tsx 的侧栏、TITLES、旧 hash 重定向全部从这里派生，不再各写一份。
 *
 * 旧 key（square/crawler/ai/applykit/calendar/coach/knowledge）不删除——
 * 它们是浏览器地址栏里活着的书签，REDIRECTS 保证旧入口落到新位置的对应 tab。
 */

export interface NavLeaf {
  key: string
  label: string
  icon: string
}

/** 顶层导航：14 项收敛为 7 项，顺序即求职旅程 */
export const NAV_MAIN: NavLeaf[] = [
  { key: 'overview', label: '总览', icon: 'overview' },
  { key: 'jobs', label: '岗位', icon: 'jobs' },
  { key: 'pipeline', label: '投递', icon: 'pipeline' },
  { key: 'interviews', label: '面试', icon: 'interviews' },
  { key: 'offers', label: '决策', icon: 'offers' },
  { key: 'growth', label: '成长', icon: 'resumes' },
  { key: 'settings', label: '目标条件', icon: 'settings' },
]

/** 合并区的内部 tab：批 1 用 tab 承载既有页面组件，批 2-4 再做深度合并 */
export const HUB_TABS: Record<string, { key: string; label: string }[]> = {
  jobs: [
    { key: 'pool', label: '岗位池' },
    { key: 'square', label: '岗位广场' },
    { key: 'crawler', label: '抓取任务' },
    { key: 'evaluate', label: 'AI 评估' },
  ],
  pipeline: [
    { key: 'board', label: '投递看板' },
    { key: 'applykit', label: '网申填写包' },
  ],
  interviews: [
    { key: 'records', label: '流程记录' },
    { key: 'calendar', label: '提醒日历' },
  ],
  growth: [
    { key: 'resumes', label: '简历库' },
    { key: 'coach', label: '项目教练' },
    { key: 'knowledge', label: '知识库' },
  ],
}

/** 旧导航 key → 新位置。只含被合并掉的 key；保留的 key 不进这张表 */
export const REDIRECTS: Record<string, { page: string; tab?: string }> = {
  square: { page: 'jobs', tab: 'square' },
  crawler: { page: 'jobs', tab: 'crawler' },
  ai: { page: 'jobs', tab: 'evaluate' },
  applykit: { page: 'pipeline', tab: 'applykit' },
  calendar: { page: 'interviews', tab: 'calendar' },
  coach: { page: 'growth', tab: 'coach' },
  knowledge: { page: 'growth', tab: 'knowledge' },
}

/** 顶栏标题（原 App.tsx 的 TITLES，收敛后每区一个标题） */
export const TITLES: Record<string, string> = {
  overview: '总览',
  jobs: '岗位',
  pipeline: '投递',
  interviews: '面试',
  offers: 'Offer 对比',
  growth: '成长',
  settings: '目标条件与账号',
}
