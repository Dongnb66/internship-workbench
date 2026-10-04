import { useCallback, useEffect, useRef, useState } from 'react'
import { cloud } from './cloud'
import { getProfile, listRows } from './lib/api'
import { useSession } from './lib/hooks'
import { track } from './lib/usage'
import { NAV_MAIN, REDIRECTS, TITLES } from './lib/nav'
import type { Profile } from './types'
import { Icon, type IconName } from './components/Icon'
import Growth from './pages/Growth'
import InterviewsHub from './pages/InterviewsHub'
import JobsHub from './pages/JobsHub'
import Login from './pages/Login'
import Offers from './pages/Offers'
import Overview from './pages/Overview'
import PipelineHub from './pages/PipelineHub'
import Settings from './pages/Settings'

/**
 * 侧栏保留「岗位池/岗位广场」等旧 key 不再存在的导航 —— 2026-09-30 UX 收敛：
 * 14 项平铺按求职旅程收敛为 7 区，被合并的旧地址由 REDIRECTS 接住，
 * 老用户的书签（#square 等）落进新区的对应 tab，肌肉记忆不断。
 */
export default function App() {
  const { session, ready } = useSession()
  const [page, setPage] = useState(() => {
    const hash = window.location.hash.replace('#', '')
    const target = REDIRECTS[hash]?.page ?? hash
    return TITLES[target] ? target : 'overview'
  })
  const [tabHint, setTabHint] = useState<string | undefined>(() => {
    const hash = window.location.hash.replace('#', '')
    return REDIRECTS[hash]?.tab
  })
  const [profile, setProfile] = useState<Profile | null>(null)
  const [counts, setCounts] = useState({ jobs: 0, applications: 0, interviews: 0, offers: 0 })

  const refreshShared = useCallback(async () => {
    try {
      const [jobs, apps, ivs, ofs, prof] = await Promise.all([
        listRows('jobs', { limit: 500 }),
        listRows('applications', { limit: 500 }),
        listRows('interviews', { limit: 500 }),
        listRows('offers', { limit: 200 }),
        getProfile(),
      ])
      setProfile(prof)
      setCounts({
        jobs: jobs.length,
        applications: apps.length,
        interviews: ivs.filter((r) => (r.result ?? 'pending') === 'pending').length,
        offers: ofs.length,
      })
    } catch {
      // 未登录 / 网络异常：各页面自行提示，这里静默
    }
  }, [])

  // 匿名计数：一次会话记一次「打开」。GPC 或用户在设置里关掉 ⇒ 一个都不发（见 lib/usage.ts）
  useEffect(() => {
    track('app_open')
  }, [])

  useEffect(() => {
    if (session) void refreshShared()
  }, [session, refreshShared])

  useEffect(() => {
    window.location.hash = page
  }, [page])

  // 浏览器后退/前进：hash 变了页面必须跟着变，否则地址栏与界面脱节。
  // 例外：页面状态写入的规范化 hash（#square → #jobs）也会触发本事件，
  // 那不是导航——不忽略会把重定向刚设好的 tabHint 清掉，用户被踢回默认 tab。
  const pageRef = useRef(page)
  useEffect(() => {
    pageRef.current = page
  }, [page])
  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash.replace('#', '')
      if (hash === pageRef.current) return
      const target = REDIRECTS[hash]?.page ?? hash
      if (TITLES[target]) {
        setTabHint(REDIRECTS[hash]?.tab)
        setPage(target)
      }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

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
    return null
  }

  /** 跨区跳转带 tab 提示：只有目标区真是合并区时 tab 才生效（Hub 自己校验） */
  const go = (next: string, tab?: string) => {
    setPage(next)
    setTabHint(tab)
  }

  const pageProps = { profile, onChanged: refreshShared, go }

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
        {NAV_MAIN.map((item) => (
          <button key={item.key} className={page === item.key ? 'nav-item active' : 'nav-item'} onClick={() => go(item.key)}>
            <span className="nav-ico">
              <Icon name={item.icon as IconName} />
            </span>
            <span className="label">{item.label}</span>
            {badge(item.key) ? <span className="count">{badge(item.key)}</span> : null}
          </button>
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
          {page === 'jobs' ? <JobsHub key={'jobs:' + (tabHint ?? '')} {...pageProps} tab={tabHint} /> : null}
          {page === 'pipeline' ? <PipelineHub key={'pipeline:' + (tabHint ?? '')} {...pageProps} tab={tabHint} /> : null}
          {page === 'interviews' ? <InterviewsHub key={'interviews:' + (tabHint ?? '')} {...pageProps} tab={tabHint} /> : null}
          {page === 'offers' ? <Offers {...pageProps} /> : null}
          {page === 'growth' ? <Growth key={'growth:' + (tabHint ?? '')} {...pageProps} tab={tabHint} /> : null}
          {page === 'settings' ? <Settings {...pageProps} /> : null}
        </div>
      </div>
    </div>
  )
}
