import { useState } from 'react'
import ApplyKit from './ApplyKit'
import Pipeline from './Pipeline'
import { HUB_TABS } from '../lib/nav'
import type { PageProps } from './Overview'

/**
 * 「投递」区容器：看板 + 网申填写包。
 * 填写包本来就是「投出去之前」用的材料，跟看板同程；岗位容器（简历版本/
 * 跟进记录进卡片）是后续批次的深度合并，不在这批。
 */
const TABS = HUB_TABS.pipeline

export default function PipelineHub(props: PageProps & { tab?: string }) {
  const [tab, setTab] = useState(() => (TABS.some((t) => t.key === props.tab) ? (props.tab as string) : 'board'))
  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'chip on' : 'chip'} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'board' ? <Pipeline {...props} /> : null}
      {tab === 'applykit' ? <ApplyKit {...props} /> : null}
    </div>
  )
}
