import { useState } from 'react'
import AiLab from './AiLab'
import Crawler from './Crawler'
import Jobs from './Jobs'
import JobsSquare from './JobsSquare'
import { HUB_TABS } from '../lib/nav'
import type { PageProps } from './Overview'

/**
 * 「岗位」区容器：池 / 广场 / 抓取 / AI 评估四合一。
 * 批 1 只做 tab 承载（四个子页原样复用，零内部改动）；
 * 深度合并（广场入池动线、评估进岗位详情）是批 2-3 的活。
 */
const TABS = HUB_TABS.jobs

export default function JobsHub(props: PageProps & { tab?: string }) {
  const [tab, setTab] = useState(() => (TABS.some((t) => t.key === props.tab) ? (props.tab as string) : 'pool'))
  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'chip on' : 'chip'} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'pool' ? <Jobs {...props} /> : null}
      {tab === 'square' ? <JobsSquare {...props} onSwitchTab={setTab} /> : null}
      {tab === 'crawler' ? <Crawler {...props} /> : null}
      {tab === 'evaluate' ? <AiLab {...props} /> : null}
    </div>
  )
}
