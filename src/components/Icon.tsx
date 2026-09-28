import type { ReactElement } from 'react'

// 统一图标组：24×24 视窗、1.8 描边、圆角端点、currentColor。
// 只收界面实际用到的名字；新图标先画在这里，别在页面里散落 emoji。
const ICONS = {
  overview: (
    <>
      <line x1="3.5" y1="20" x2="20.5" y2="20" />
      <line x1="6.5" y1="20" x2="6.5" y2="12.5" />
      <line x1="12" y1="20" x2="12" y2="5.5" />
      <line x1="17.5" y1="20" x2="17.5" y2="9.5" />
    </>
  ),
  square: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
    </>
  ),
  jobs: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  crawler: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <line x1="3.5" y1="12" x2="20.5" y2="12" />
      <ellipse cx="12" cy="12" rx="3.8" ry="8.5" />
    </>
  ),
  pipeline: (
    <>
      <rect x="3.5" y="4" width="5" height="16" rx="1.5" />
      <rect x="9.75" y="4" width="4.5" height="10.5" rx="1.5" />
      <rect x="16" y="4" width="4.5" height="13.5" rx="1.5" />
    </>
  ),
  interviews: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </>
  ),
  offers: (
    <>
      <path d="M8 3.5h8v6.5a4 4 0 0 1-8 0z" />
      <path d="M8 5H4.8a3.2 3.2 0 0 0 3.4 4" />
      <path d="M16 5h3.2a3.2 3.2 0 0 1-3.4 4" />
      <line x1="12" y1="14" x2="12" y2="17.5" />
      <line x1="8.5" y1="20.5" x2="15.5" y2="20.5" />
    </>
  ),
  resumes: (
    <>
      <path d="M14 3H7a1.6 1.6 0 0 0-1.6 1.6v14.8A1.6 1.6 0 0 0 7 21h10a1.6 1.6 0 0 0 1.6-1.6V7.6z" />
      <path d="M14 3v4.6h4.6" />
      <line x1="9" y1="12.2" x2="15" y2="12.2" />
      <line x1="9" y1="16" x2="13" y2="16" />
    </>
  ),
  applykit: (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <rect x="9" y="2.5" width="6" height="3.6" rx="1" />
      <line x1="9" y1="11.5" x2="15" y2="11.5" />
      <line x1="9" y1="15.3" x2="13" y2="15.3" />
    </>
  ),
  ai: (
    <>
      <path d="M12 3.5l2.3 6.2L20.5 12l-6.2 2.3L12 20.5l-2.3-6.2L3.5 12l6.2-2.3z" />
      <path d="M18.2 15.6l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="currentColor" stroke="none" />
    </>
  ),
  coach: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <polygon points="15.8,8.2 13.6,13.6 8.2,15.8 10.4,10.4" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15.5" rx="2" />
      <line x1="4" y1="10" x2="20" y2="10" />
      <line x1="9" y1="3" x2="9" y2="7" />
      <line x1="15" y1="3" x2="15" y2="7" />
    </>
  ),
  knowledge: (
    <>
      <path d="M12 5.5C10.3 4 8 3.3 5 3.3v15c3 0 5.3.7 7 2.2 1.7-1.5 4-2.2 7-2.2v-15c-3 0-5.3.7-7 2.2z" />
      <line x1="12" y1="5.5" x2="12" y2="20.5" />
    </>
  ),
  settings: (
    <>
      <line x1="3.5" y1="6.5" x2="10.5" y2="6.5" />
      <circle cx="13.8" cy="6.5" r="2.3" />
      <line x1="17" y1="6.5" x2="20.5" y2="6.5" />
      <line x1="3.5" y1="12" x2="6.5" y2="12" />
      <circle cx="9.8" cy="12" r="2.3" />
      <line x1="13" y1="12" x2="20.5" y2="12" />
      <line x1="3.5" y1="17.5" x2="13.5" y2="17.5" />
      <circle cx="16.8" cy="17.5" r="2.3" />
      <line x1="20" y1="17.5" x2="20.5" y2="17.5" />
    </>
  ),
  send: (
    <>
      <line x1="21.3" y1="2.7" x2="11.3" y2="12.8" />
      <path d="M21.3 2.7L14.8 21l-3.6-8.2-8.4-3.6z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.2 2.1" />
    </>
  ),
  hourglass: (
    <>
      <line x1="7.5" y1="3" x2="16.5" y2="3" />
      <line x1="7.5" y1="21" x2="16.5" y2="21" />
      <path d="M8.8 3.5v3l3.2 4.2 3.2-4.2v-3" />
      <path d="M8.8 20.5v-3l3.2-4.2 3.2 4.2v3" />
    </>
  ),
  check: <path d="M5 12.6l4.4 4.4L18.8 7.4" />,
  x: (
    <>
      <line x1="6.5" y1="6.5" x2="17.5" y2="17.5" />
      <line x1="17.5" y1="6.5" x2="6.5" y2="17.5" />
    </>
  ),
  'trending-up': (
    <>
      <path d="M3.5 16.5l5.5-5.5 4 4 7.5-7.5" />
      <path d="M15 7.5h5.5V13" />
    </>
  ),
  money: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <line x1="12" y1="7" x2="12" y2="17" />
      <path d="M15 9c-.7-1-1.8-1.4-3-1.4-1.8 0-3.1.9-3.1 2.2 0 2.8 6.2 1.6 6.2 4.3 0 1.3-1.3 2.2-3.1 2.2-1.3 0-2.5-.5-3.2-1.5" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.3c.4-1.3 1.4-2.1 2.7-2.1 1.4 0 2.6 1 2.6 2.3 0 1.8-2.5 2-2.5 3.5" />
      <line x1="12.2" y1="16.6" x2="12.2" y2="16.7" />
    </>
  ),
} satisfies Record<string, ReactElement>

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}
