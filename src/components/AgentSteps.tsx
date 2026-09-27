import type { ActionStep } from '../lib/agentLoop'

/**
 * 智能体每步审计的展示。
 *
 * 抽出来是因为巡检与投递决策两个入口都得显示同一件事：**结论后面必须跟着「它查了什么」**。
 * 只给一句结论的智能体，用户要么全信要么全不信；把步骤摊开，他能一眼看出哪一步的数据不对，
 * 也能发现它压根没查某件该查的事。这份可视化同时是「全程审计日志」这句话的代码依据。
 */
export default function AgentSteps({ steps }: { steps: ActionStep[] }) {
  if (!steps.length) return null
  return (
    <div className="mt4">
      {steps.map((s) => (
        <div key={s.step} className="row" style={{ alignItems: 'flex-start', marginBottom: 8, gap: 8 }}>
          <span className={s.error ? 'badge danger' : 'badge info'}>{s.step}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="cell-main">
              {s.tool ? `调用 ${s.tool}` : s.thought ? '给出结论' : '（没识别出指令）'}
              <span className="small muted"> · {s.ms}ms</span>
            </div>
            {s.thought ? <div className="cell-sub">想法：{s.thought}</div> : null}
            {s.args && Object.keys(s.args).length ? <div className="cell-sub">参数：{JSON.stringify(s.args)}</div> : null}
            {/* 观察结果可能很长（工具返回的清单），列表里只展开前 160 字，完整内容在结论里体现 */}
            <div className="small muted" style={{ wordBreak: 'break-all' }}>
              观察：{s.observation.length > 160 ? `${s.observation.slice(0, 160)}…` : s.observation}
            </div>
            {s.error ? <div className="small" style={{ color: '#b91c1c' }}>错误：{s.error}</div> : null}
          </div>
        </div>
      ))}
    </div>
  )
}
