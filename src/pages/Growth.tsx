import { useState } from 'react'
import Coach from './Coach'
import Knowledge from './Knowledge'
import Resumes from './Resumes'
import { HUB_TABS } from '../lib/nav'
import type { PageProps } from './Overview'

/**
 * 「成长」区容器：简历库 + 项目教练 + 知识库。
 * 三者都是「资产型」低频页——不挂在旅程主线上，合在一处后
 * 主线（岗位→投递→面试）两侧只剩决策与设置。
 */
const TABS = HUB_TABS.growth

export default function Growth(props: PageProps & { tab?: string }) {
  const [tab, setTab] = useState(() => (TABS.some((t) => t.key === props.tab) ? (props.tab as string) : 'resumes'))
  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'chip on' : 'chip'} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'resumes' ? <Resumes {...props} /> : null}
      {tab === 'coach' ? <Coach {...props} /> : null}
      {tab === 'knowledge' ? <Knowledge {...props} /> : null}
    </div>
  )
}
