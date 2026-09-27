import { useCallback, useEffect, useState } from 'react'
import { cloud } from './cloud'
import { getProfile, listRows } from './lib/api'
import { useSession } from './lib/hooks'
import type { Profile } from './types'
import AiLab from './pages/AiLab'
import ApplyKit from './pages/ApplyKit'
import CalendarPage from './pages/CalendarPage'
import Coach from './pages/Coach'
import Crawler from './pages/Crawler'
import Interviews from './pages/Interviews'
import Jobs from './pages/Jobs'
import JobsSquare from './pages/JobsSquare'
import Knowledge from './pages/Knowledge'
import Login from './pages/Login'
import Offers from './pages/Offers'
import Overview from './pages/Overview'
import Pipeline from './pages/Pipeline'
import Resumes from './pages/Resumes'
import Settings from './pages/Settings'

const NAV = [
  {
    group: '工作台',
    items: [
      { key: 'overview', label: '总览', icon: '📊' },
      { key: 'square', label: '岗位广场', icon: '🏛' },
      { key: 'jobs', label: '岗位池', icon: '🎯' },
      { key: 'crawler', label: '抓取任务', icon: '🕸' },
      { key: 'pipeline', label: '投递看板', icon: '🗂' },
      { key: 'interviews', label: '面试跟进', icon: '🎤' },
      { key: 'offers', label: 'Offer 对比', icon: '🏆' },
    ],
  },
  {
    group: '资产',
    items: [
      { key: 'resumes', label: '简历库', icon: '📄' },
      { key: 'applykit', label: '网申填写包', icon: '🧾' },
      { key: 'ai', label: 'AI · JD 评估', icon: '🤖' },
      { key: 'coach', label: '项目教练', icon: '🧭' },
      { key: 'calendar', label: '提醒日历', icon: '🗓' },
      { key: 'knowledge', label: '个人知识库', icon: '📚' },
    ],
  },
  {
    group: '配置',
    items: [{ key: 'settings', label: '目标条件', icon: '⚙️' }],
  },
]

const TITLES: Record<string, string> = {
  overview: '总览',
  square: '岗位广场',
  jobs: '岗位池',
  crawler: '抓取任务',
  pipeline: '投递看板',
  interviews: '面试跟进',
  offers: 'Offer 对比',
  resumes: '简历库',
  applykit: '网申填写包',
  ai: 'AI · JD 评估',
  calendar: '提醒日历',
  knowledge: '个人知识库',
  settings: '目标条件与账号',
}

export default function App() {
  const { session, ready } = useSession()
  const [page, setPage] = useState(() => {
    const hash = window.location.hash.replace('#', '')
    return hash && TITLES[hash] ? hash : 'overview'
  })
  const [profile, setProfile] = useState<Profile | null>(null)
  const [counts, setCounts] = useState({ jobs: 0, applications: 0, interviews: 0, offers: 0, tasks: 0 })

  const refreshShared = useCallback(async () => {
    try {
      const [jobs, apps, ivs, ofs, tks, prof] = await Promise.all([
        listRows('jobs', { limit: 500 }),
        listRows('applications', { limit: 500 }),
        listRows('interviews', { limit: 500 }),
        listRows('offers', { limit: 200 }),
        listRows('tasks', { limit: 500 }),
        getProfile(),
      ])
      setProfile(prof)
      setCounts({
        jobs: jobs.length,
        applications: apps.length,
        interviews: ivs.filter((r) => (r.result ?? 'pending') === 'pending').length,
        offers: ofs.length,
        tasks: tks.filter((t) => !t.done).length,
      })
    } catch {
      // 未登录 / 网络异常：各页面自行提示，这里静默
    }
  }, [])

  useEffect(() => {
    if (session) void refreshShared()
  }, [session, refreshShared])

  useEffect(() => {
    window.location.hash = page
  }, [page])

  if (!ready) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="row">
            <span className="logo-dot">实</span>
            <div>
              <h1 className="login-title">实习管理工作台</h1>
              <span className="small muted">正在恢复会话…</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!session) return <Login />

  const email = session.user?.email ?? ''
  const badge = (key: string): number | null => {
    if (key === 'jobs') return counts.jobs
    if (key === 'pipeline') return counts.applications
    if (key === 'interviews') return counts.interviews
    if (key === 'offers') return counts.offers
    if (key === 'calendar') return counts.tasks
    return null
  }

  const pageProps = { profile, onChanged: refreshShared, go: setPage }

  return (
    <div className="app">
      <nav className="side">
        <div className="side-brand">
          <span className="logo-dot">实</span>
          <h1>
            实习工作台
            <span>Internship Desk</span>
          </h1>
        </div>
        {NAV.map((group) => (
          <div key={group.group}>
            <div className="side-group">{group.group}</div>
            {group.items.map((item) => (
              <button key={item.key} className={page === item.key ? 'nav-item active' : 'nav-item'} onClick={() => setPage(item.key)}>
                <span>{item.icon}</span>
                <span className="label">{item.label}</span>
                {badge(item.key) ? <span className="count">{badge(item.key)}</span> : null}
              </button>
            ))}
          </div>
        ))}
        <span className="spacer" />
        <div className="side-group">数据存于云端 · 仅本人可见</div>
      </nav>

      <div className="main">
        <header className="topbar">
          <h2>{TITLES[page]}</h2>
          <span className="spacer" />
          <div className="who">
            <span className="avatar">{email.slice(0, 1).toUpperCase() || 'U'}</span>
            <span>{email}</span>
          </div>
          <button className="btn sm" onClick={() => void cloud.auth.signOut()}>
            退出
          </button>
        </header>

        <div className="content">
          {page === 'overview' ? <Overview {...pageProps} /> : null}
          {page === 'square' ? <JobsSquare {...pageProps} /> : null}
          {page === 'jobs' ? <Jobs {...pageProps} /> : null}
          {page === 'crawler' ? <Crawler {...pageProps} /> : null}
          {page === 'pipeline' ? <Pipeline {...pageProps} /> : null}
          {page === 'interviews' ? <Interviews {...pageProps} /> : null}
          {page === 'offers' ? <Offers {...pageProps} /> : null}
          {page === 'resumes' ? <Resumes {...pageProps} /> : null}
          {page === 'applykit' ? <ApplyKit {...pageProps} /> : null}
          {page === 'ai' ? <AiLab {...pageProps} /> : null}
          {page === 'coach' ? <Coach {...pageProps} /> : null}
          {page === 'calendar' ? <CalendarPage {...pageProps} /> : null}
          {page === 'knowledge' ? <Knowledge {...pageProps} /> : null}
          {page === 'settings' ? <Settings {...pageProps} /> : null}
        </div>
      </div>
    </div>
  )
}
