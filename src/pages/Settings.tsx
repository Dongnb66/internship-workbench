import { useEffect, useState } from 'react'
import { cloud, errText } from '../cloud'
import { Field, Modal } from '../components/ui'
import { listRows, saveProfile } from '../lib/api'
import { PROFILE_TEMPLATE } from '../lib/constants'
import { healthSummary, profileHealth } from '../lib/healthCheck'
import { textToArray } from '../lib/format'
import { DEFAULT_PACE, GREET_CHECKLIST } from '../lib/pace'
import { notifyErr, notifyOk } from '../lib/toast'
import type { PageProps } from './Overview'

/**
 * 数据导出的表清单 = 用户自己的数据。
 *
 * 刻意**不含** `jobs_public`：那是岗位广场的公共岗位库，不属于任何用户，
 * 导出个人备份时带上它会让「备份」这个概念变糊 —— 备份应当只包含你自己的东西，
 * 公共岗位随时可以从广场重新加入。
 */
const TABLES = ['jobs', 'applications', 'interviews', 'offers', 'resumes', 'tasks', 'ai_reports', 'knowledge', 'profile', 'messages']

export default function Settings({ profile, onChanged }: PageProps) {
  const [form, setForm] = useState({
    full_name: '',
    grade: '',
    grad_year: '',
    major: '',
    school: '',
    phone: '',
    contact_email: '',
    github: '',
    portfolio: '',
    available_from: '',
    available_days: '',
    self_intro: '',
    expect_city: '',
    expect_type: '',
    expect_daily: '',
    skills: '',
    directions: '',
    resume_summary: '',
    daily_greet_limit: '',
    greet_window: '',
    min_interval_min: '',
  })
  const [busy, setBusy] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [pw, setPw] = useState({ oldPassword: '', newPassword: '' })
  const [exporting, setExporting] = useState(false)
  const [resumeCount, setResumeCount] = useState(0)

  useEffect(() => {
    // 体检需要知道简历库有几份；失败不影响主表单（按 0 处理，体检会提示去录简历）
    listRows('resumes', { limit: 200 })
      .then((rows) => setResumeCount(rows.length))
      .catch(() => setResumeCount(0))
  }, [])

  const health = profileHealth(profile, resumeCount)
  const healthSum = healthSummary(health)

  useEffect(() => {
    if (!profile) return
    setForm({
      full_name: profile.full_name ?? '',
      grade: profile.grade ?? '',
      grad_year: profile.grad_year ?? '',
      major: profile.major ?? '',
      school: profile.school ?? '',
      phone: profile.phone ?? '',
      contact_email: profile.contact_email ?? '',
      github: profile.github ?? '',
      portfolio: profile.portfolio ?? '',
      available_from: profile.available_from ? String(profile.available_from).slice(0, 10) : '',
      available_days: profile.available_days ?? '',
      self_intro: profile.self_intro ?? '',
      expect_city: (profile.expect_city ?? []).join('、'),
      expect_type: (profile.expect_type ?? []).join('、'),
      expect_daily: profile.expect_daily ? String(profile.expect_daily) : '',
      skills: (profile.skills ?? []).join('、'),
      directions: (profile.directions ?? []).join('、'),
      resume_summary: profile.resume_summary ?? '',
      daily_greet_limit: profile.daily_greet_limit ? String(profile.daily_greet_limit) : '',
      greet_window: profile.greet_window ?? '',
      min_interval_min: profile.min_interval_min ? String(profile.min_interval_min) : '',
    })
  }, [profile])

  async function save() {
    setBusy(true)
    try {
      await saveProfile({
        full_name: form.full_name || null,
        grade: form.grade || null,
        grad_year: form.grad_year || null,
        major: form.major || null,
        school: form.school || null,
        phone: form.phone || null,
        contact_email: form.contact_email || null,
        github: form.github || null,
        portfolio: form.portfolio || null,
        available_from: form.available_from || null,
        available_days: form.available_days || null,
        self_intro: form.self_intro || null,
        expect_city: textToArray(form.expect_city),
        expect_type: textToArray(form.expect_type),
        expect_daily: form.expect_daily ? Number(form.expect_daily) : null,
        skills: textToArray(form.skills),
        directions: textToArray(form.directions),
        resume_summary: form.resume_summary || null,
        daily_greet_limit: form.daily_greet_limit ? Number(form.daily_greet_limit) : null,
        greet_window: form.greet_window || null,
        min_interval_min: form.min_interval_min ? Number(form.min_interval_min) : null,
      })
      notifyOk('已保存画像与目标条件')
      await onChanged()
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setBusy(false)
    }
  }

  function fillTemplate() {
    setForm({
      full_name: PROFILE_TEMPLATE.full_name,
      grade: PROFILE_TEMPLATE.grade,
      grad_year: PROFILE_TEMPLATE.grad_year,
      major: PROFILE_TEMPLATE.major,
      school: PROFILE_TEMPLATE.school,
      phone: '',
      contact_email: '',
      github: 'https://github.com/Dongnb66',
      portfolio: 'https://github.com/Dongnb66/vibe-portfolio',
      available_from: '',
      available_days: PROFILE_TEMPLATE.available_days,
      self_intro: PROFILE_TEMPLATE.self_intro,
      expect_city: PROFILE_TEMPLATE.expect_city.join('、'),
      expect_type: PROFILE_TEMPLATE.expect_type.join('、'),
      expect_daily: String(PROFILE_TEMPLATE.expect_daily),
      skills: PROFILE_TEMPLATE.skills.join('、'),
      directions: PROFILE_TEMPLATE.directions.join('、'),
      resume_summary: PROFILE_TEMPLATE.resume_summary,
      daily_greet_limit: '8',
      greet_window: '09:00-21:00',
      min_interval_min: '30',
    })
    notifyOk('已填入模板，请补手机号与邮箱后保存（数字口径需与简历一致）')
  }

  async function changePassword() {
    if (pw.newPassword.length < 6) {
      notifyErr('新密码至少 6 位')
      return
    }
    setBusy(true)
    try {
      const res = await cloud.auth.resetPasswordForOld({ oldPassword: pw.oldPassword, newPassword: pw.newPassword })
      if (res.error) {
        notifyErr(errText(res.error))
        return
      }
      notifyOk('密码已更新')
      setPwOpen(false)
      setPw({ oldPassword: '', newPassword: '' })
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setBusy(false)
    }
  }

  async function exportAll() {
    setExporting(true)
    try {
      const dump: Record<string, unknown> = { exportedAt: new Date().toISOString() }
      for (const t of TABLES) {
        try {
          dump[t] = await listRows(t, { limit: 1000 })
        } catch {
          dump[t] = []
        }
      }
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `实习工作台备份_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      notifyOk('已导出 JSON 备份')
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <section className="card">
        <div className="card-head">
          <h3>个人画像与目标条件</h3>
          <span className="spacer" />
          <button className="btn sm" onClick={fillTemplate}>
            填入模板
          </button>
        </div>
        <div className="card-body">
          <div className="hint mb16">
            AI 评估、匹配度和打招呼话术都以这份画像为准。项目数字口径务必与简历一致，避免 HR 一 clone 就对不上。
          </div>
          <div className="grid grid-2">
            <Field label="姓名">
              <input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </Field>
            <Field label="年级">
              <input className="input" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} />
            </Field>
            <Field label="届数">
              <input className="input" value={form.grad_year} onChange={(e) => setForm({ ...form, grad_year: e.target.value })} />
            </Field>
            <Field label="专业">
              <input className="input" value={form.major} onChange={(e) => setForm({ ...form, major: e.target.value })} />
            </Field>
            <Field label="学校" hint="网申表单必填项，如实填写；打招呼话术里不会出现校名">
              <input className="input" value={form.school} onChange={(e) => setForm({ ...form, school: e.target.value })} />
            </Field>
            <Field label="手机号" hint="仅用于网申填写包与浏览器插件自动填表">
              <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="常用邮箱">
              <input className="input" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
            </Field>
            <Field label="GitHub">
              <input className="input" value={form.github} onChange={(e) => setForm({ ...form, github: e.target.value })} />
            </Field>
            <Field label="作品集 / 在线简历">
              <input className="input" value={form.portfolio} onChange={(e) => setForm({ ...form, portfolio: e.target.value })} />
            </Field>
            <Field label="可到岗时间">
              <input className="input" type="date" value={form.available_from} onChange={(e) => setForm({ ...form, available_from: e.target.value })} />
            </Field>
            <Field label="可实习时长 / 每周天数">
              <input className="input" value={form.available_days} onChange={(e) => setForm({ ...form, available_days: e.target.value })} />
            </Field>
            <Field label="期望城市" hint="顿号分隔">
              <input className="input" value={form.expect_city} onChange={(e) => setForm({ ...form, expect_city: e.target.value })} />
            </Field>
            <Field label="期望岗位类型" hint="顿号分隔">
              <input className="input" value={form.expect_type} onChange={(e) => setForm({ ...form, expect_type: e.target.value })} />
            </Field>
            <Field label="期望日薪（元）">
              <input className="input" value={form.expect_daily} onChange={(e) => setForm({ ...form, expect_daily: e.target.value })} />
            </Field>
            <Field label="目标方向" hint="顿号分隔">
              <input className="input" value={form.directions} onChange={(e) => setForm({ ...form, directions: e.target.value })} />
            </Field>
          </div>
          <Field label="技能关键词" hint="用于岗位匹配度打分，顿号分隔">
            <input className="input" value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} />
          </Field>
          <Field label="一句话自我介绍" hint="网申「自我介绍 / 你为什么适合」栏位直接用这段">
            <textarea className="textarea" value={form.self_intro} onChange={(e) => setForm({ ...form, self_intro: e.target.value })} />
          </Field>
          <Field label="项目与可验证事实" hint="AI 生成话术时只会引用这里写的事实">
            <textarea className="textarea" style={{ minHeight: 150 }} value={form.resume_summary} onChange={(e) => setForm({ ...form, resume_summary: e.target.value })} />
          </Field>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? '保存中…' : '保存画像'}
          </button>
        </div>
      </section>

      <div className="grid" style={{ gap: 14 }}>
        <section className="card">
          <div className="card-head">
            <h3>简历体检</h3>
            <span className="spacer" />
            <span className={healthSum.allOk ? 'badge ok' : 'badge warn'}>
              {healthSum.passed}/{healthSum.total} 通过
            </span>
          </div>
          <div className="card-body">
            <div className="hint mb16">
              规则版体检，不消耗模型额度：只查事实完整性与数字口径。全部通过后，AI 评估和打招呼话术才有可靠的原料。
            </div>
            {health.map((item) => (
              <div key={item.label} className="row" style={{ alignItems: 'flex-start', marginBottom: 7 }}>
                <span className={item.ok ? 'badge ok' : 'badge warn'}>{item.ok ? '✓' : '!'}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className={item.ok ? 'muted' : ''}>{item.label}</div>
                  {!item.ok && item.fix ? <div className="small muted">→ {item.fix}</div> : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>账号</h3>
          </div>
          <div className="card-body">
            <div className="row mb8">
              <span className="muted small">当前账号</span>
              <span className="spacer" />
              <span>已登录</span>
            </div>
            <div className="row">
              <button className="btn" onClick={() => setPwOpen(true)}>
                修改密码
              </button>
              <button className="btn" onClick={() => void cloud.auth.signOut()}>
                退出登录
              </button>
            </div>
            <div className="small muted mt16">数据按账号隔离，其他人登录看不到你的岗位池与投递记录。</div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>数据</h3>
          </div>
          <div className="card-body">
            <button className="btn" onClick={exportAll} disabled={exporting}>
              {exporting ? '导出中…' : '导出全部数据（JSON 备份）'}
            </button>
            <div className="small muted mt16">
              导出内容包含岗位池、投递记录、面试跟进、Offer、简历库、待办、AI 报告与知识库，可用于本地留档或迁移。
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>投递节奏守则</h3>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={() => setForm({ ...form, daily_greet_limit: String(DEFAULT_PACE.dailyLimit), greet_window: DEFAULT_PACE.window, min_interval_min: String(DEFAULT_PACE.minIntervalMin) })}>
              恢复默认
            </button>
          </div>
          <div className="card-body">
            <div className="hint mb16">
              总览页的「今日节奏」按这三项判断现在能不能发、还剩几条。核心目的不是限制你，而是避免一天群发百条被平台判定骚扰、以及投得太散导致跟进不过来。
            </div>
            <div className="grid grid-3">
              <Field label="每日上限" hint="条">
                <input className="input" value={form.daily_greet_limit} onChange={(e) => setForm({ ...form, daily_greet_limit: e.target.value })} placeholder={String(DEFAULT_PACE.dailyLimit)} />
              </Field>
              <Field label="发送时间窗" hint="HH:MM-HH:MM">
                <input className="input" value={form.greet_window} onChange={(e) => setForm({ ...form, greet_window: e.target.value })} placeholder={DEFAULT_PACE.window} />
              </Field>
              <Field label="最小间隔" hint="分钟">
                <input className="input" value={form.min_interval_min} onChange={(e) => setForm({ ...form, min_interval_min: e.target.value })} placeholder={String(DEFAULT_PACE.minIntervalMin)} />
              </Field>
            </div>
            <button className="btn primary mt8" onClick={save} disabled={busy}>
              {busy ? '保存中…' : '保存节奏设置'}
            </button>

            <div className="divider" />
            <div className="small muted mb8">发送前自检清单（每个岗位发之前过一遍）</div>
            <ol className="md" style={{ fontSize: 13, paddingLeft: 20, margin: 0 }}>
              {GREET_CHECKLIST.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>使用节奏建议</h3>
          </div>
          <div className="card-body md" style={{ fontSize: 13 }}>
            1. 每天固定 20 分钟：更新投递阶段 + 处理 7 天内到期事项。
            <br />
            2. 每周一次：把本周新 JD 过一遍 AI 评估，低于 55 分的不投。
            <br />
            3. 面试后当晚：在「面试跟进」记录问题与复盘，AI 会整理成结构化清单。
            <br />
            4. 拿到 Offer 后：填多维评分，看清自己在乎的到底是成长、钱还是通勤。
          </div>
        </section>
      </div>

      {pwOpen ? (
        <Modal
          title="修改密码"
          onClose={() => setPwOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setPwOpen(false)}>
                取消
              </button>
              <button className="btn primary" onClick={changePassword} disabled={busy}>
                {busy ? '提交中…' : '确认修改'}
              </button>
            </>
          }
        >
          <Field label="当前密码">
            <input className="input" type="password" value={pw.oldPassword} onChange={(e) => setPw({ ...pw, oldPassword: e.target.value })} />
          </Field>
          <Field label="新密码" hint="至少 6 位">
            <input className="input" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          </Field>
        </Modal>
      ) : null}
    </div>
  )
}
