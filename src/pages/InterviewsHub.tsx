import { useState } from 'react'
import CalendarPage from './CalendarPage'
import Interviews from './Interviews'
import LiveAssist from './LiveAssist'
import MockInterview from './MockInterview'
import { HUB_TABS } from '../lib/nav'
import type { PageProps } from './Overview'

/**
 * 「面试」区容器：流程记录 + AI 模拟面试 + AI 面试辅助 + 提醒日历。
 * AI 面试辅助独立的理由：它是「面试进行中/刚结束」的操作台，
 * 与录入流程记录的心态不同，混在一页会互相打断。
 * 模拟面试也独立：对面是模型，练完只进知识库，不写回任何真实面试记录。
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
      {tab === 'mock' ? <MockInterview {...props} /> : null}
      {tab === 'live' ? <LiveAssist {...props} /> : null}
      {tab === 'calendar' ? <CalendarPage {...props} /> : null}
    </div>
  )
}
