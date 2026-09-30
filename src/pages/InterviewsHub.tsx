import { useState } from 'react'
import CalendarPage from './CalendarPage'
import Interviews from './Interviews'
import { HUB_TABS } from '../lib/nav'
import type { PageProps } from './Overview'

/**
 * 「面试」区容器：流程记录 + 提醒日历。
 * 日历里的大头本来就是面试与截止提醒，独立成页让人来回切；
 * 能力画像（abilityProfile）后续落在这个区。
 */
const TABS = HUB_TABS.interviews

export default function InterviewsHub(props: PageProps & { tab?: string }) {
  const [tab, setTab] = useState(() => (TABS.some((t) => t.key === props.tab) ? (props.tab as string) : 'records'))
  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'chip on' : 'chip'} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'records' ? <Interviews {...props} /> : null}
      {tab === 'calendar' ? <CalendarPage {...props} /> : null}
    </div>
  )
}
