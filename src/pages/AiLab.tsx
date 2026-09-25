import { useCallback, useEffect, useMemo, useState } from 'react'
import { errText } from '../cloud'
import { Empty, Field, Modal, ScoreDonut } from '../components/ui'
import { evaluateJD, type Evaluated } from '../lib/ai'
import { deleteRow, insertRow, listRows, updateRow } from '../lib/api'
import { DIMS } from '../lib/constants'
import { fmtDateTime } from '../lib/format'
import { gapPlan } from '../lib/gapPlan'
import { keywordCoverage } from '../lib/keywordCoverage'
import { notifyErr, notifyOk } from '../lib/toast'
import type { Row } from '../types'
import type { PageProps } from './Overview'

export default function AiLab({ profile, onChanged, go }: PageProps) {
  const [company, setCompany] = useState('')
  const [title, setTitle] = useState('')
  const [jd, setJd] = useState('')
  /** 岗位原帖链接：评估页是「粘贴 JD」进来的，不带链接的话入池后投递看板跳不回去 */
  const [jobUrl, setJobUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [raw, setRaw] = useState('')
  const [result, setResult] = useState<Evaluated | null>(null)
  // 评估时刻的 JD 快照：结果卡里的 highlights/gaps 来自这份 JD，
  // 「待确认」档也必须按同一份算，否则评估完再改输入框会让一张卡里两套口径混排
  const [resultJd, setResultJd] = useState('')
  const [history, setHistory] = useState<Row[]>([])
  const [detail, setDetail] = useState<Row | null>(null)

  const load = useCallback(async () => {
    try {
      setHistory(await listRows('ai_reports', { limit: 100 }))
    } catch (error) {
      notifyErr(errText(error))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const prefill = window.sessionStorage.getItem('iwb:ai-prefill')
    if (!prefill) return
    window.sessionStorage.removeItem('iwb:ai-prefill')
    try {
      const data = JSON.parse(prefill) as { company?: string; title?: string; jd?: string }
      setCompany(data.company ?? '')
      setTitle(data.title ?? '')
      setJd(data.jd ?? '')
    } catch {
      // 忽略脏数据
    }
  }, [])

  async function run() {
    if (jd.trim().length < 20) {
      notifyErr('JD 太短了，粘贴完整岗位描述再评估')
      return
    }
    setBusy(true)
    setResult(null)
    setRaw('')
    try {
      const evaluated = await evaluateJD(jd, profile, (t) => setRaw((prev) => prev + t))
      setResult(evaluated)
      setResultJd(jd)
      await insertRow('ai_reports', {
        company: company || '未填写',
        title: title || '未填写',
        jd_text: jd,
        score: evaluated.score,
        verdict: evaluated.verdict,
        dims: evaluated.dims,
        highlights: evaluated.highlights.join('\n'),
        gaps: evaluated.gaps.join('\n'),
        greeting: evaluated.greeting,
        model: 'cloud-llm',
      })
      notifyOk('评估完成，已存入历史')
      await load()
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setBusy(false)
      setRaw('')
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      notifyOk('已复制，可直接发给 HR（按纪律先看一遍再发）')
    } catch {
      notifyErr('复制失败，请手动选中复制')
    }
  }

  async function saveAsJob() {
    if (!result) return
    try {
      await insertRow('jobs', {
        company: company || '未填写',
        title: title || '未填写',
        jd_text: jd,
        job_type: '实习',
        status: 'pool',
        match_score: result.score,
        priority: result.score >= 70 ? '高' : result.score >= 50 ? '中' : '低',
        notes: `AI 结论：${result.verdict}`,
        url: jobUrl.trim() || null,
      })
      notifyOk('已加入岗位池')
      await onChanged()
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  async function removeReport(row: Row) {
    if (!window.confirm('删除这条评估记录？')) return
    try {
      await deleteRow('ai_reports', row.id)
      notifyOk('已删除')
      setDetail(null)
      await load()
    } catch (error) {
      notifyErr(errText(error))
    }
  }

  async function reuse(row: Row) {
    setCompany(row.company ?? '')
    setTitle(row.title ?? '')
    setJd(row.jd_text ?? '')
    setDetail(null)
    const dims = (row.dims ?? {}) as Record<string, number>
    setResultJd(row.jd_text ?? '')
    setResult({
      score: Number(row.score ?? 0),
      verdict: row.verdict ?? '',
      dims,
      highlights: String(row.highlights ?? '').split('\n').filter(Boolean),
      gaps: String(row.gaps ?? '').split('\n').filter(Boolean),
      greeting: row.greeting ?? '',
    })
  }

  const avgDims = useMemo(() => (result ? DIMS.reduce((sum, d) => sum + (result.dims[d] ?? 0), 0) / DIMS.length : 0), [result])

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <div className="grid" style={{ gap: 14 }}>
        <section className="card">
          <div className="card-head">
            <h3>粘贴 JD，拿三样东西</h3>
          </div>
          <div className="card-body">
            <div className="grid grid-2">
              <Field label="公司">
                <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="如 大湾区国创中心" />
              </Field>
              <Field label="岗位">
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如 AI 后端开发实习生" />
              </Field>
            </div>
            <Field label="JD 原文 *" hint="从 BOSS / 实习僧 / 官网整段复制粘贴，越长越准">
              <textarea className="textarea" style={{ minHeight: 240 }} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="粘贴完整岗位描述…" />
            </Field>
            <Field label="岗位链接（强烈建议填）" hint="加入岗位池后，投递看板和会话抽屉才能一键跳回原帖发招呼；地址栏复制即可">
              <input className="input" value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} placeholder="https://www.zhipin.com/job_detail/…" />
            </Field>
            <div className="row">
              <button className="btn primary" onClick={run} disabled={busy}>
                {busy ? '评估中…' : '开始评估'}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setCompany('')
                  setTitle('')
                  setJd('')
                  setResult(null)
                  setResultJd('')
                }}
                disabled={busy}
              >
                清空
              </button>
              <span className="small muted">评估会写入历史，可用于对比同类岗位</span>
            </div>
            {busy && raw ? (
              <div className="small muted mt16" style={{ maxHeight: 90, overflow: 'hidden' }}>
                模型正在输出…（已接收 {raw.length} 字）
              </div>
            ) : null}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>评估历史</h3>
            <span className="spacer" />
            <span className="small muted">{history.length} 条</span>
          </div>
          <div className="card-body">
            {history.length === 0 ? (
              <Empty text="还没有评估记录。" />
            ) : (
              history.map((row) => (
                <div key={row.id} className="row" style={{ marginBottom: 10, alignItems: 'flex-start' }}>
                  <span className={Number(row.score ?? 0) >= 70 ? 'badge ok' : Number(row.score ?? 0) >= 50 ? 'badge warn' : 'badge'}>
                    {Number(row.score ?? 0)}%
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="cell-main">
                      {row.company} · {row.title}
                    </div>
                    <div className="cell-sub">
                      {row.verdict} · {fmtDateTime(row.created_at)}
                    </div>
                  </div>
                  <div className="actions">
                    <button className="linkish" onClick={() => setDetail(row)}>
                      详情
                    </button>
                    <button className="linkish" onClick={() => void reuse(row)}>
                      重新评估
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="grid" style={{ gap: 14 }}>
        {result ? (
          <>
            <section className="card">
              <div className="card-head">
                <h3>匹配度评估</h3>
                <span className="spacer" />
                <button className="btn sm" onClick={saveAsJob}>
                  加入岗位池
                </button>
              </div>
              <div className="card-body">
                <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
                  <ScoreDonut value={result.score} size={92} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, lineHeight: 1.6 }}>{result.verdict}</div>
                    <div className="small muted mt8">七维均值 {avgDims.toFixed(1)} / 10。低于 55 的岗位建议不投，把时间留给值得的。</div>
                  </div>
                </div>
                <div className="mt16">
                  {DIMS.map((d) => {
                    const v = result.dims[d] ?? 0
                    const color = v >= 8 ? '#12a150' : v >= 5 ? '#f2542d' : '#9aa3af'
                    return (
                      <div className="dim-row" key={d}>
                        <span className="muted">{d}</span>
                        <div className="bar">
                          <i style={{ width: `${(v / 10) * 100}%`, background: color }} />
                        </div>
                        <span className="mono" style={{ textAlign: 'right' }}>
                          {v}
                        </span>
                      </div>
                    )
                  })}
                </div>
                {(() => {
                  // JD 关键词覆盖（Resume-Matcher 思路，本地比对不耗额度）：
                  // 缺的词是面试官会追问、该提前准备「用哪段已有能力顶上」的地方
                  const base = [profile?.resume_summary, (profile?.skills ?? []).join(' '), profile?.self_intro]
                    .filter(Boolean)
                    .join('\n')
                  const cov = keywordCoverage(jd, base)
                  if (!cov.total) return null
                  return (
                    <div className="mt16">
                      <div className="row" style={{ alignItems: 'baseline' }}>
                        <b>JD 关键词覆盖</b>
                        <span className="spacer" />
                        <span className="mono">
                          {cov.coverage}%（{cov.matched.length}/{cov.total}）
                        </span>
                      </div>
                      <div className="bar mt8">
                        <i style={{ width: `${cov.coverage}%`, background: cov.coverage >= 60 ? '#12a150' : cov.coverage >= 35 ? '#f59e0b' : '#f2542d' }} />
                      </div>
                      <div className="small mt8">已覆盖：{cov.matched.join('、') || '（无）'}</div>
                      {cov.missing.length ? (
                        <div className="small mt8" style={{ color: '#b45309' }}>
                          缺失：{cov.missing.join('、')} —— 想投就提前准备「用哪段已有能力顶上」的说法
                        </div>
                      ) : (
                        <div className="small muted mt8">JD 的技术词简历全都覆盖了。</div>
                      )}
                      <div className="small muted mt8">比对基准是「目标条件」里的项目摘要与技能清单，与上面 AI 的「缺口」互为印证：关键词是本地比对，缺口是模型判断。</div>
                    </div>
                  )
                })()}
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <h3>对得上的亮点</h3>
              </div>
              <div className="card-body">
                {result.highlights.length ? (
                  result.highlights.map((h, i) => (
                    <div key={i} className="row" style={{ alignItems: 'flex-start', marginBottom: 6 }}>
                      <span className="badge ok">✓</span>
                      <span>{h}</span>
                    </div>
                  ))
                ) : (
                  <div className="small muted">模型没给出亮点，建议补全画像后再评一次。</div>
                )}
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <h3>差距三档 · 补齐计划</h3>
                <span className="spacer" />
                <span className="small muted">自己看，不主动对 HR 说</span>
              </div>
              <div className="card-body">
                {(() => {
                  const plan = gapPlan(result.highlights, result.gaps, resultJd)
                  return (
                    <>
                      {plan.confirm.length ? (
                        <>
                          <div className="small muted mb8">待确认 —— 只有你自己能核实的事实，投前过一遍：</div>
                          {plan.confirm.map((c, i) => (
                            <div key={i} className="row" style={{ alignItems: 'flex-start', marginBottom: 6 }}>
                              <span className="badge warn">?</span>
                              <span>{c}</span>
                            </div>
                          ))}
                          <div className="divider" style={{ margin: '10px 0' }} />
                        </>
                      ) : null}
                      {plan.missing.length ? (
                        <>
                          {plan.missing.map((m, i) => (
                            <div key={i} className="row" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
                              <span className="badge">!</span>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div>{m.item}</div>
                                <div className="small muted mt4">→ {m.action}</div>
                              </div>
                            </div>
                          ))}
                        </>
                      ) : (
                        <div className="small muted">没有明显缺口。</div>
                      )}
                    </>
                  )
                })()}
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <h3>打招呼话术</h3>
                <span className="spacer" />
                <button className="btn sm primary" onClick={() => void copy(result.greeting)}>
                  复制
                </button>
              </div>
              <div className="card-body">
                <div className="md" style={{ background: '#fffaf5', border: '1px solid #ffe2d3', padding: 12, borderRadius: 9 }}>
                  {result.greeting || '（未生成）'}
                </div>
                <div className="small muted mt8">
                  已按纪律约束：不写学校名、不提未接触的技术、数字口径与简历一致（5 项目 / 6 仓库 / 508 测试）。发送前请自己再读一遍，改成更像你自己说话的样子。
                </div>
              </div>
            </section>
          </>
        ) : (
          <section className="card">
            <div className="card-head">
              <h3>怎么用</h3>
            </div>
            <div className="card-body">
              <ol className="md" style={{ paddingLeft: 18, lineHeight: 1.9 }}>
                <li>先在「目标条件」里填好画像与项目数字口径，评估和话术都会以它为准。</li>
                <li>粘一个 JD，点开始评估，拿到匹配度、亮点、缺口和一句话打招呼。</li>
                <li>值得投的点「加入岗位池」，再转到投递看板，进入流水线管理。</li>
                <li>面试前在「面试跟进」里用 AI 面试准备：关联那次投递，自动带入 JD 与你投的简历出题。</li>
              </ol>
              <div className="hint mt16">
                数据来源：本页结论由云端大模型基于你录入的 JD 与画像生成，仅作求职辅助，不构成任何录用承诺或保证。
              </div>
            </div>
          </section>
        )}
      </div>

      {detail ? (
        <Modal
          wide
          title={`${detail.company} · ${detail.title}`}
          onClose={() => setDetail(null)}
          footer={
            <>
              <button className="btn danger" onClick={() => void removeReport(detail)}>
                删除记录
              </button>
              <span className="spacer" />
              <button className="btn" onClick={() => void copy(String(detail.greeting ?? ''))}>
                复制打招呼
              </button>
              <button className="btn primary" onClick={() => void reuse(detail)}>
                载入左侧
              </button>
            </>
          }
        >
          <div className="row mb16">
            <ScoreDonut value={Number(detail.score ?? 0)} size={76} />
            <div>
              <div style={{ fontWeight: 600 }}>{detail.verdict}</div>
              <div className="small muted">评估时间 {fmtDateTime(detail.created_at)}</div>
            </div>
          </div>
          <div className="grid grid-2">
            <div>
              <div className="small muted">已满足（亮点）</div>
              <div className="md">{detail.highlights}</div>
            </div>
            <div>
              <div className="small muted">差距与补齐动作</div>
              {(() => {
                const plan = gapPlan(null, String(detail.gaps ?? ''), String(detail.jd_text ?? ''))
                if (!plan.missing.length && !plan.confirm.length) return <div className="md">（无）</div>
                return (
                  <div className="md">
                    {plan.missing.map((m, i) => (
                      <div key={i} style={{ marginBottom: 8 }}>
                        · {m.item}
                        <br />
                        <span className="small muted">→ {m.action}</span>
                      </div>
                    ))}
                    {plan.confirm.map((c, i) => (
                      <div key={`c${i}`} style={{ marginBottom: 8 }}>
                        <span style={{ color: '#b45309' }}>? 待确认：</span>
                        {c}
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          </div>
          <div className="small muted mt16">打招呼</div>
          <div className="md">{detail.greeting}</div>
          <div className="small muted mt16">JD 原文</div>
          <div className="md" style={{ maxHeight: 200, overflow: 'auto', background: '#fafbfc', padding: 10, borderRadius: 8 }}>
            {detail.jd_text}
          </div>
        </Modal>
      ) : null}

    </div>
  )
}
