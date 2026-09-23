import { useEffect, useMemo, useState } from 'react'
import { errText } from '../cloud'
import { Empty, Field, Modal } from '../components/ui'
import { generateApplyAnswers } from '../lib/ai'
import { listRows } from '../lib/api'
import { notifyErr, notifyOk } from '../lib/toast'
import type { Row } from '../types'
import type { PageProps } from './Overview'

export default function ApplyKit({ profile, go }: PageProps) {
  const [resumes, setResumes] = useState<Row[]>([])
  const [aiOpen, setAiOpen] = useState(false)
  const [aiForm, setAiForm] = useState({ company: '', title: '', jd: '' })
  const [aiOut, setAiOut] = useState('')
  const [aiBusy, setAiBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        setResumes(await listRows('resumes', { limit: 200 }))
      } catch (error) {
        notifyErr(errText(error))
      }
    })()
  }, [])

  const kit = useMemo(() => {
    const p = profile ?? {}
    const main = resumes.find((r) => r.is_default) ?? resumes[0]
    const skills = (p.skills ?? []).join('、')
    const directions = (p.directions ?? []).join('、')
    return [
      { label: '姓名', value: p.full_name ?? '', required: true },
      { label: '性别', value: '', required: true, hint: '按证件如实填' },
      { label: '联系电话', value: p.phone ?? '', required: true },
      { label: '电子邮箱', value: p.contact_email ?? '', required: true },
      { label: '学校', value: p.school ?? '', required: true },
      { label: '学历', value: '本科', required: true },
      { label: '专业', value: p.major ?? '', required: true },
      { label: '年级', value: p.grade ?? '', required: false },
      { label: '毕业年份', value: p.grad_year ?? '', required: true },
      { label: '期望城市', value: (p.expect_city ?? []).join('、'), required: false },
      { label: '期望岗位', value: directions || (p.expect_type ?? []).join('、'), required: false },
      { label: '期望日薪', value: p.expect_daily ? `${p.expect_daily} 元/天` : '', required: false },
      { label: '可到岗时间', value: p.available_from ? String(p.available_from).slice(0, 10) : '', required: false },
      { label: '可实习时长', value: p.available_days ?? '', required: false },
      { label: '技能关键词', value: skills, required: false },
      { label: 'GitHub', value: p.github ?? '', required: false },
      { label: '作品集', value: p.portfolio ?? '', required: false },
      { label: '一句话自我介绍', value: p.self_intro ?? '', required: false },
      { label: '项目经历', value: main?.projects ?? p.resume_summary ?? '', required: false },
      { label: '简历文件名', value: main ? `${main.name} ${main.version ?? ''}`.trim() : '', required: false },
    ]
  }, [profile, resumes])

  const missing = kit.filter((f) => f.required && !f.value)

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      notifyOk(`${label} 已复制`)
    } catch {
      notifyErr('复制失败，请手动选中')
    }
  }

  async function copyAll() {
    const text = kit
      .filter((f) => f.value)
      .map((f) => `${f.label}：${f.value}`)
      .join('\n')
    await copy(text, '填写包')
  }

  function exportJson() {
    const payload = {
      generatedAt: new Date().toISOString(),
      source: 'internship-workbench',
      profile: Object.fromEntries(kit.filter((f) => f.value).map((f) => [f.label, f.value])),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'applykit.json'
    a.click()
    URL.revokeObjectURL(url)
    notifyOk('已导出 applykit.json，可导入浏览器插件')
  }

  async function runAi() {
    setAiBusy(true)
    setAiOut('')
    try {
      const text = await generateApplyAnswers(aiForm.company, aiForm.title, aiForm.jd, profile)
      setAiOut(text)
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <section className="card">
        <div className="card-head">
          <h3>网申填写包</h3>
          <span className="spacer" />
          <button className="btn sm" onClick={copyAll}>
            一键复制全部
          </button>
          <button className="btn sm primary" onClick={exportJson}>
            导出插件数据
          </button>
        </div>
        <div className="card-body">
          {missing.length ? (
            <div className="hint mb16">
              还缺 {missing.map((m) => m.label).join('、')}：
              <button className="linkish" style={{ marginLeft: 6 }} onClick={() => go('settings')}>
                去目标条件补全
              </button>
            </div>
          ) : (
            <div className="hint mb16">字段已齐，可以直接对着网申表单逐个粘贴，或用浏览器插件自动填充。</div>
          )}
          {kit.map((f) => (
            <div key={f.label} className="row" style={{ alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span className="muted small" style={{ width: 118, flex: '0 0 118px', paddingTop: 2 }}>
                {f.label}
                {f.required ? <span style={{ color: 'var(--up)' }}> *</span> : null}
              </span>
              <span style={{ flex: 1, wordBreak: 'break-all', color: f.value ? 'inherit' : 'var(--muted)' }}>{f.value || '（未填写）'}</span>
              {f.value ? (
                <button className="btn sm ghost" onClick={() => void copy(f.value, f.label)}>
                  复制
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <div className="grid" style={{ gap: 14 }}>
        <section className="card">
          <div className="card-head">
            <h3>浏览器插件自动填表</h3>
          </div>
          <div className="card-body">
            <ol className="md" style={{ paddingLeft: 18, lineHeight: 1.9, fontSize: 13 }}>
              <li>点上方「导出插件数据」，得到 applykit.json。</li>
              <li>打开 Chrome → 地址栏输入 chrome://extensions → 打开右上角「开发者模式」。</li>
              <li>点「加载已解压的扩展程序」，选择本仓库的 <code>extension/</code> 目录。</li>
              <li>在网申页面点插件图标 → 导入 applykit.json → 点「一键填充」。</li>
            </ol>
            <div className="small muted mt8">
              插件按字段关键词（姓名 / 手机 / 邮箱 / 学校 / 专业 / 毕业时间 / 期望岗位 等）匹配表单控件，填充后会高亮标出，方便你逐个核对再提交。所有数据只存在你本机浏览器里。
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>开放题答案</h3>
            <span className="spacer" />
            <button className="btn sm primary" onClick={() => setAiOpen(true)}>
              让 AI 写一版
            </button>
          </div>
          <div className="card-body">
            <div className="small muted">
              期望薪资、可实习时长、为什么选择我们、自我介绍——这些开放题最容易写得像模板。粘一个 JD，AI 会按 JD 和你自己的项目写一版。
            </div>
            {aiOut ? <div className="md mt16" style={{ background: '#fafbfc', padding: 12, borderRadius: 9 }}>{aiOut}</div> : null}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>填写纪律</h3>
          </div>
          <div className="card-body md" style={{ fontSize: 13 }}>
            · 网申表单里的必填项如实填，包括学校；但在 BOSS / 实习僧的打招呼正文里不出现校名。
            <br />
            · 四级等短板：只在该平台表单明确必填时如实填，其余场合不主动提。
            <br />
            · 项目数字口径统一：5 个项目 / 6 个仓库 / 508 条测试，HR 一 clone 就要对得上。
            <br />· 技能只写真的用过的：没碰过的技术不在表单里硬塞。
          </div>
        </section>
      </div>

      {aiOpen ? (
        <Modal
          wide
          title="生成网申开放题答案"
          onClose={() => setAiOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setAiOpen(false)}>
                关闭
              </button>
              <button className="btn" onClick={() => void copy(aiOut, '开放题答案')} disabled={!aiOut}>
                复制全部
              </button>
              <button className="btn primary" onClick={runAi} disabled={aiBusy}>
                {aiBusy ? '生成中…' : '生成'}
              </button>
            </>
          }
        >
          <div className="grid grid-2">
            <Field label="公司">
              <input className="input" value={aiForm.company} onChange={(e) => setAiForm({ ...aiForm, company: e.target.value })} />
            </Field>
            <Field label="岗位">
              <input className="input" value={aiForm.title} onChange={(e) => setAiForm({ ...aiForm, title: e.target.value })} />
            </Field>
          </div>
          <Field label="JD（可选）">
            <textarea className="textarea" style={{ minHeight: 160 }} value={aiForm.jd} onChange={(e) => setAiForm({ ...aiForm, jd: e.target.value })} />
          </Field>
          {aiOut ? (
            <div className="md" style={{ background: '#fafbfc', padding: 12, borderRadius: 9 }}>
              {aiOut}
            </div>
          ) : (
            <Empty text="生成结果会显示在这里。" />
          )}
        </Modal>
      ) : null}
    </div>
  )
}
