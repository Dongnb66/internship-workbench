import { useMemo, useState } from 'react'
import { Field } from '../components/ui'
import { crawlOutputHint, buildCrawlPlan } from '../lib/crawlTask'
import { crawlSitesForPicker, type CrawlSite } from '../lib/crawlSites'
import { notifyErr, notifyOk } from '../lib/toast'
import type { PageProps } from './Overview'

const CHANNEL_GROUPS = ['官网投递', 'BOSS直聘', '实习僧', '牛客']

const VERDICT_BADGE: Record<CrawlSite['verified'], { label: string; cls: string }> = {
  live: { label: '实测可用', cls: 'badge ok' },
  '': { label: '未验证', cls: 'badge' },
  offline: { label: '实测抓不到', cls: 'badge warn' },
}

/**
 * 抓取任务生成器。
 *
 * 为什么不是「点一下按钮云端就爬」：工作台是静态站，没有常驻进程，也没有
 * 能跑浏览器的服务端；而岗位抓取恰恰需要真浏览器 + 你自己的登录态（BOSS 直聘
 * 那类站点风控很重，任何绕风控的方案都不稳也不该做）。所以这里的形态是——
 * 在网页上配好任务，生成一条命令，你在自己电脑的终端里粘一下，浏览器自己开、
 * 自己爬，产出的 JSON 回到「岗位池 → 批量导入」入库。抓取器本体在 crawler/。
 */
export default function Crawler(_props: PageProps) {
  const sites = useMemo(() => crawlSitesForPicker(), [])
  const [selected, setSelected] = useState<string[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [keyword, setKeyword] = useState('')
  const [pages, setPages] = useState(2)
  const [limit, setLimit] = useState(60)
  const [mode, setMode] = useState<'all' | 'intern' | 'campus'>('all')

  const urlSites = sites.filter((s) => s.urlOnly)
  const plan = useMemo(
    () =>
      buildCrawlPlan(sites, {
        siteIds: selected,
        urls: urlSites.map((s) => ({ siteId: s.id, url: urls[s.id] ?? '' })),
        keyword,
        pages,
        limit,
        mode,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sites, selected, urls, keyword, pages, limit, mode],
  )

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function copyCommand() {
    const cmd = plan.commandLines.join('\n')
    void navigator.clipboard.writeText(cmd).then(
      () => notifyOk('命令已复制，去终端粘贴运行'),
      () => notifyErr('复制失败，请手动选择命令文本复制'),
    )
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      <section className="card">
        <div className="card-head">
          <h3>怎么用（三步）</h3>
        </div>
        <div className="card-body md" style={{ fontSize: 13 }}>
          <strong>1.</strong> 下面选站点、填关键词，复制生成的命令；
          <br />
          <strong>2.</strong> 在你自己电脑的终端里粘贴运行（需要 Node 18+，仓库 crawler/ 目录下第一次跑先 `npm install`）；
          <br />
          <strong>3.</strong> 抓完后回到「岗位池 → 批量导入」，选择 crawler/output/ 里的 JSON 文件，预览后入库。
          <div className="small muted mt8">
            为什么不是云端一键爬：抓取要用真浏览器打开招聘页、用你自己的登录态（尤其 BOSS
            直聘），云服务器既没有你的登录态，绕风控的方案也不稳定、不该做。本机跑只读「你在浏览器里能看见的那一屏」，串行慢速不并发。
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>选站点</h3>
          <span className="spacer" />
          <span className="small muted">已选 {selected.length + Object.values(urls).filter((v) => v.trim()).length} 个</span>
          {selected.length ? (
            <button className="btn sm ghost" onClick={() => setSelected([])}>
              清空
            </button>
          ) : null}
        </div>
        <div className="card-body">
          {CHANNEL_GROUPS.map((group) => {
            const groupSites = sites.filter((s) => s.channel === group)
            if (!groupSites.length) return null
            return (
              <div key={group} style={{ marginBottom: 10 }}>
                <div className="small muted mb8">{group}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {groupSites.map((s) => {
                    const active = selected.includes(s.id)
                    const badge = VERDICT_BADGE[s.verified]
                    return (
                      <button
                        key={s.id}
                        className={active ? 'btn sm primary' : 'btn sm'}
                        onClick={() => toggle(s.id)}
                        title={
                          s.needsLogin
                            ? '需要先在本机登录一次'
                            : s.verified === 'offline'
                              ? '实测抓不到有效岗位，仅作参考'
                              : s.kwSearch
                                ? '关键词会进搜索参数'
                                : '固定入口页，整页抓取'
                        }
                        style={s.verified === 'offline' && !active ? { opacity: 0.55 } : undefined}
                      >
                        {s.name}
                        {s.needsLogin ? ' 🔒' : ''}
                        {s.kwSearch ? ' 🔍' : ''}
                        <span className={badge.cls} style={{ marginLeft: 6 }}>{badge.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <div className="small muted">
            🔒 = 需要先在本机跑 `node login.mjs --site &lt;站点id&gt;` 登录一次，抓取器只复用你已登录的会话，不碰账号密码。
            🔍 = 支持关键词搜索；不带 🔍 的站点是固定入口页，整页抓取，关键词对它们无效。
          </div>
        </div>
      </section>

      {urlSites.length ? (
        <section className="card">
          <div className="card-head">
            <h3>指定地址（托管页 / 任意页面）</h3>
          </div>
          <div className="card-body">
            <div className="hint mb16">
              这几类站点没有入口地址（飞书 / 北森是给公司托管校招页的，每家地址都不同）：把目标公司的招聘页地址粘进来，抓取器走同一套结构检测。
            </div>
            {urlSites.map((s) => (
              <div className="row mb8" key={s.id}>
                <span className="small" style={{ width: 130, flexShrink: 0 }}>{s.name}</span>
                <input
                  className="input"
                  placeholder="https:// 招聘页地址"
                  value={urls[s.id] ?? ''}
                  onChange={(e) => setUrls({ ...urls, [s.id]: e.target.value })}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="card-head">
          <h3>任务参数</h3>
        </div>
        <div className="card-body">
          <div className="grid grid-2">
            <Field label="岗位关键词" hint="只对 🔍 站点（腾讯/字节/实习僧/BOSS）生效；其余站点整页抓取，关键词被忽略">
              <input className="input" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="如 后端 / Python / AI Agent" />
            </Field>
            <Field label="岗位类型筛选" hint="按标题筛">
              <select className="select" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="all">全部</option>
                <option value="intern">只要实习</option>
                <option value="campus">只要校招</option>
              </select>
            </Field>
            <Field label="每站最多翻几页">
              <input className="input" type="number" min={1} max={20} value={pages} onChange={(e) => setPages(Math.max(1, Math.min(20, Number(e.target.value) || 2)))} />
            </Field>
            <Field label="每站最多产出条数">
              <input className="input" type="number" min={1} max={300} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(300, Number(e.target.value) || 60)))} />
            </Field>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>生成的命令</h3>
          <span className="spacer" />
          {plan.hasContent ? (
            <button className="btn sm primary" onClick={copyCommand}>
              复制命令
            </button>
          ) : null}
        </div>
        <div className="card-body">
          {!plan.hasContent ? (
            <div className="muted">先在上面选至少一个站点或填一个地址。</div>
          ) : (
            <>
              {plan.needLoginSites.length ? (
                <div className="hint mb16" style={{ color: '#d97706' }}>
                  ⚠ 本次任务包含需要登录的站点：{plan.needLoginSites.map((s) => s.name).join('、')}。先跑
                  {plan.needLoginSites.map((s) => ` node login.mjs --site ${s.id};`)}登录一次再执行下面的命令。
                </div>
              ) : null}
              <pre
                className="mono"
                style={{ background: 'var(--bg-soft, #f5f5f5)', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 13 }}
              >
                {plan.commandLines.join('\n')}
              </pre>
              <div className="small muted mt8">{crawlOutputHint()}</div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
