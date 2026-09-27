import { useState } from 'react'
import { errText } from '../cloud'
import { Empty, Field } from '../components/ui'
import { insertRow } from '../lib/api'
import { fetchRepoFacts, checkPackAcceptance, type AcceptanceResult, type RepoFacts } from '../lib/githubVerify'
import { buildTaskPack, renderTaskPack, WEEKS_DEFAULT, type TaskPack } from '../lib/mentor'
import { notifyErr, notifyOk } from '../lib/toast'
import type { PageProps } from './Overview'

const LEVELS = ['零基础', '入门', '进阶']
const SUGGESTED = ['AI Agent 方向', 'RAG / 知识库', '后端方向', '全栈方向']

/**
 * 项目教练（AGENT_PLAN 第四步）。
 *
 * 它产出的是**任务包**，不是代码：每一步都带可核对的验收与「你必须能讲清」的问题，
 * 用户拿它去派活给任意智能体（WorkBuddy / Claude Code / Cursor），
 * 自己 review、自己跑通、自己讲清。做完回到这一页对着公开仓库验收。
 *
 * 两个刻意的取舍：
 * - **生成任务包不调模型**，走本地模板：这是纯结构化的东西，用模型只会更贵、更不稳定，
 *   而且额度记在创建者账号上。验收也走 GitHub 公开只读接口，同样不花额度。
 * - 验收只看「README 有没有、写没写怎么跑、有没有设计取舍」这类**读得到的事实**；
 *   测试条数这类只读接口看不见的，一律落到「要你本地跑一次核对」，不假装判过。
 */
export default function Coach({ profile, onChanged }: PageProps) {
  const [direction, setDirection] = useState(SUGGESTED[0])
  const [level, setLevel] = useState(LEVELS[1])
  const [weeks, setWeeks] = useState(WEEKS_DEFAULT)
  const [pack, setPack] = useState<TaskPack | null>(null)
  const [busy, setBusy] = useState(false)

  const [owner, setOwner] = useState('')
  const [repo, setRepo] = useState('')
  const [facts, setFacts] = useState<RepoFacts | null>(null)
  const [verdict, setVerdict] = useState<AcceptanceResult | null>(null)

  function generate() {
    if (!direction.trim()) {
      notifyErr('先写清方向：教练模板按方向给技术抓手，空白方向只能出通用档')
      return
    }
    const p = buildTaskPack({ direction: direction.trim(), level, weeks }, profile)
    setPack(p)
    setVerdict(null)
    setFacts(null)
  }

  async function saveToKnowledge() {
    if (!pack) return
    setBusy(true)
    try {
      await insertRow('knowledge', {
        title: `项目任务包 · ${pack.direction}（${pack.weeks} 周）`,
        category: '项目',
        content: renderTaskPack(pack),
        tags: ['项目教练', pack.direction, pack.level],
      })
      notifyOk('已存进个人知识库，随时回来看')
      await onChanged()
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setBusy(false)
    }
  }

  async function copyPack() {
    if (!pack) return
    try {
      await navigator.clipboard.writeText(renderTaskPack(pack))
      notifyOk('已复制：整段粘给智能体，一步步来，别一次全发')
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  async function verify() {
    const f = await fetchRepoFacts(owner.trim(), repo.trim())
    setFacts(f)
    if (!pack) {
      setVerdict(null)
      if (!f.ok) notifyErr(f.error ?? '读不到仓库')
      return
    }
    setVerdict(checkPackAcceptance(pack, { hasReadme: f.hasReadme, readmeText: f.readmeText, unreachable: f.unreachable }))
    if (!f.ok && f.error) notifyErr(f.error)
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="card-head">
          <h3>项目教练 · 任务包生成</h3>
          <span className="spacer" />
          <span className="small muted">本地模板生成，不消耗 AI 额度</span>
        </div>
        <div className="card-body">
          <div className="grid grid-3">
            <Field label="方向 *" hint="写你简历上要放的那个方向；认不出的方向会按通用工程档给，并明确告诉你">
              <input className="input" list="coach-directions" value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="如 RAG 知识库 / 求职智能体" />
              <datalist id="coach-directions">
                {SUGGESTED.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </Field>
            <Field label="水平" hint="决定第一步从哪开始：零基础先跑通环境，进阶先讲取舍">
              <select className="select" value={level} onChange={(e) => setLevel(e.target.value)}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="周期（周）" hint={`默认 ${WEEKS_DEFAULT} 周`}>
              <input className="input" type="number" min={1} max={12} value={weeks} onChange={(e) => setWeeks(Number(e.target.value) || WEEKS_DEFAULT)} />
            </Field>
          </div>
          <div className="row mt8">
            <button className="btn primary" onClick={generate}>
              生成任务包
            </button>
            {pack ? (
              <>
                <button className="btn" onClick={() => void copyPack()}>
                  复制给智能体
                </button>
                <button className="btn" onClick={() => void saveToKnowledge()} disabled={busy}>
                  存进知识库
                </button>
              </>
            ) : null}
          </div>
          {pack?.fallback ? (
            <div className="small mt8" style={{ color: '#b45309' }}>
              {pack.note}
            </div>
          ) : null}
          <div className="hint mt8">
            用法：把每一步整段复制给智能体，<strong>它给完代码后你必须自己跑一遍、逐条讲清为什么这样写</strong>。
            讲不清的那部分不要写进简历——面试官会 clone 仓库核对。
          </div>
        </div>
      </section>

      {pack ? (
        <section className="card">
          <div className="card-head">
            <h3>任务包（{pack.steps.length} 步 / {pack.weeks} 周）</h3>
            <span className="spacer" />
            <span className="small muted">技术栈取自你的画像：{pack.stack.join(' / ')}</span>
          </div>
          <div className="card-body">
            <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>
              {renderTaskPack(pack)}
            </pre>
          </div>
        </section>
      ) : (
        <section className="card">
          <div className="card-body">
            <Empty text="还没有任务包。先选方向和水平，点「生成任务包」。" />
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h3>做完之后：对着公开仓库验收</h3>
          <span className="spacer" />
          <span className="small muted">只读公开接口，不带任何凭据，也不消耗 AI 额度</span>
        </div>
        <div className="card-body">
          <div className="grid grid-2">
            <Field label="GitHub 用户名" hint="仓库必须是公开的：私有仓库这一轮读不到，会明确告诉你「无法确认」">
              <input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Dongnb66" />
            </Field>
            <Field label="仓库名">
              <input className="input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="my-rag-demo" />
            </Field>
          </div>
          <button className="btn mt8" onClick={() => void verify()} disabled={!owner.trim() || !repo.trim()}>
            验收一次
          </button>

          {facts && !facts.ok ? (
            <div className="small mt8" style={{ color: '#b45309' }}>
              {facts.error}
            </div>
          ) : null}

          {verdict ? (
            <div className="mt8">
              <div className="cell-main">
                {verdict.verdict === 'pass' ? '这一轮能读到的都齐了' : verdict.verdict === 'unknown' ? '无法确认（不是你没做完）' : '还有缺口'}
              </div>
              {verdict.passed.length ? (
                <div className="small mt4">
                  {verdict.passed.map((p) => (
                    <div key={p.field}>✓ {p.field}：{p.detail}</div>
                  ))}
                </div>
              ) : null}
              {verdict.gaps.length ? (
                <div className="small mt4" style={{ color: '#b45309' }}>
                  {verdict.gaps.map((g) => (
                    <div key={g.field}>✗ {g.field}：{g.detail}</div>
                  ))}
                </div>
              ) : null}
              <div className="small muted mt4">
                {verdict.manual.map((m) => (
                  <div key={m.field}>△ {m.field}：{m.detail}</div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
