import type { ReactNode } from 'react'
import { STAGES } from '../lib/constants'

export function Stat({ label, value, foot, icon, color }: { label: string; value: ReactNode; foot?: ReactNode; icon?: ReactNode; color?: string }) {
  return (
    <div className="stat">
      <div className="stat-top">
        {icon ? (
          <span className="stat-ico" style={{ background: `${color ?? '#f2542d'}1a`, color: color ?? '#f2542d' }}>
            {icon}
          </span>
        ) : null}
        <span>{label}</span>
      </div>
      <div className="stat-val">{value}</div>
      {foot ? <div className="stat-foot">{foot}</div> : null}
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <span className="small muted">{hint}</span> : null}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className={wide ? 'modal wide' : 'modal'} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Drawer({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <>
      <div className="drawer-mask" onClick={onClose} />
      <aside className="drawer">
        <div className="modal-head">
          <h3>{title}</h3>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="modal-body" style={{ flex: 1 }}>
          {children}
        </div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </aside>
    </>
  )
}

export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div>{text}</div>
      {action ? <div className="mt16">{action}</div> : null}
    </div>
  )
}

export function StageBadge({ stage }: { stage: string }) {
  const s = STAGES.find((x) => x.key === stage)
  if (!s) return <span className="badge">{stage}</span>
  return (
    <span className="badge" style={{ background: `${s.color}1a`, color: s.color }}>
      {s.label}
    </span>
  )
}

export function ScoreDonut({ value, size = 74 }: { value: number; size?: number }) {
  const r = size / 2 - 6
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  const stroke = pct >= 75 ? '#12a150' : pct >= 55 ? '#f2542d' : '#e8443a'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef0f4" strokeWidth="7" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={stroke}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${(c * pct) / 100} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" fontSize="17" fontWeight="700" fill="#1d2129">
        {pct}
      </text>
      <text x="50%" y="74%" textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="#9aa3af">
        匹配度
      </text>
    </svg>
  )
}

export function ScoreCell({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value || 0))
  const color = pct >= 75 ? '#12a150' : pct >= 55 ? '#f2542d' : '#9aa3af'
  return (
    <div style={{ minWidth: 92 }}>
      <div className="mono" style={{ fontSize: 12, color, fontWeight: 600, marginBottom: 3 }}>
        {pct}%
      </div>
      <div className="bar">
        <i style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}
