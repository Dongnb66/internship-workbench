import { useEffect, useState } from 'react'
import { cloud, errText } from '../cloud'
import { Field, Modal } from '../components/ui'
import { getModelChoice, getQuotaSnapshot, getTokenStats, listUsableModels, modelCostLabel, pickModel, setModelChoice, type TokenStats, type UsableModel } from '../lib/ai'
import { listRows, saveProfile } from '../lib/api'
import { setUsageOptOut, usageOptOut } from '../lib/usage'
import { BYO_PRESETS } from '../lib/aiChannels'
import {
  getByoModel,
  hasUserKey,
  isLocalServiceReady,
  currentPreset,
  setByoModel,
  setByoPresetId,
  setOwnerTrialEnabled,
  getOwnerTrialEnabled,
  setUserKey,
} from '../lib/billing'
import { channelCard, checkConnection, keyHint } from '../lib/byoSetup'
import { OWNER_EMAIL, isOwnerAccount } from '../lib/ownerAccount'
import { templateToForm } from '../lib/profileFill'
import { useSession } from '../lib/hooks'
import { healthSummary, profileHealth } from '../lib/healthCheck'
import { textToArray } from '../lib/format'
import { DEFAULT_PACE, GREET_CHECKLIST } from '../lib/pace'
import { DEFAULT_QUOTA, type QuotaStatus } from '../lib/quota'
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
  // 匿名统计开关（默认开：只记功能次数；GPC 在 lib/usage.ts 里优先级更高）
  const [usageOn, setUsageOn] = useState(() => !usageOptOut())
  const [resumeCount, setResumeCount] = useState(0)
  const [models, setModels] = useState<UsableModel[]>([])
  const [modelsErr, setModelsErr] = useState('')
  const [chosen, setChosen] = useState('')
  const [effective, setEffective] = useState('')
  const [savingModel, setSavingModel] = useState(false)
  // 会话内累计消耗：进出设置页时刷新，让「花的是谁的额度」这件事可见
  const [stats, setStats] = useState<TokenStats>({ calls: 0, prompt: 0, completion: 0, total: 0 })
  // 今日额度（设备级 localStorage 台账）：和上面那个「本会话消耗」是两件事——
  // 会话统计关了就归零，额度台账按日历日算，是护栏实际依据的那份。
  const [quota, setQuota] = useState<QuotaStatus | null>(null)
  /**
   * AI 通道这块的状态全部是**设备级**的（localStorage）：Key 与所选厂商只属于这台浏览器。
   * 刻意没有「回填 Key」这一步——输入框永远从空开始，存进去之后界面只剩掩码。
   */
  const [channel, setChannel] = useState(() => currentPreset())
  const [keyDraft, setKeyDraft] = useState('')
  const [hasKey, setHasKey] = useState(() => hasUserKey())
  const [localReady, setLocalReady] = useState(() => isLocalServiceReady())
  const [modelDraft, setModelDraft] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [trial, setTrial] = useState(() => getOwnerTrialEnabled())
  // 会话身份：试用开关只认创建者本人的账号（判定只有一处，见 lib/ownerAccount.ts）
  const { session } = useSession()
  const sessionEmail = () => (session as any)?.user?.email ?? ''
  const isOwner = isOwnerAccount(sessionEmail())

  const card = channelCard(channel, { hasKey, localReady })

  /**
   * 「现在会用哪个模型」——草稿优先，否则是这一档已经记下的（从没记过就是表里第一个）。
   * 候选按钮的高亮与下面「当前会用」那句**共用这一个值**：两处各算一遍，迟早说不到一起。
   */
  const modelInUse = modelDraft.trim() || getByoModel(channel)

  useEffect(() => {
    setStats(getTokenStats())
    // 额度台账只服务「用本应用的额度」那一档；看不到那张卡的人不必去读它
    if (isOwner) setQuota(getQuotaSnapshot())
  }, [isOwner])

  useEffect(() => {
    // 选了本机档就先默默探一次：卡片上那句「能不能用」得有事实依据，而不是等用户点自检
    if (!currentPreset().httpLocal) return
    checkConnection({ preset: currentPreset(), model: getByoModel() })
      .then(() => setLocalReady(isLocalServiceReady()))
      .catch(() => setLocalReady(false))
  }, [])

  useEffect(() => {
    // 模型目录只服务「用本应用的额度」那一档。看不到那张卡的人（非创建者）不必白拉一次目录
    if (!isOwner) return
    listUsableModels()
      .then((list) => {
        setModels(list)
        setChosen(getModelChoice() ?? '')
      })
      .catch((error) => setModelsErr(errText(error)))
  }, [isOwner])

  useEffect(() => {
    // 显示「当前生效」的实际落点：可能因所选模型被禁用而回退到默认
    if (!isOwner) return
    pickModel()
      .then((m) => setEffective(m ?? ''))
      .catch(() => setEffective(''))
  }, [isOwner, models, chosen])

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
    // 数字字段必须校验：Number('2000元') = NaN，NaN 会原样存库并绕过下游的
    // `?? 默认值` 链路（NaN 不是 nullish），总览页会显示「剩余 NaN 条」且上限判断失效
    const numericFields: Array<[keyof typeof form, string]> = [
      ['expect_daily', '期望日薪'],
      ['daily_greet_limit', '每日打招呼上限'],
      ['min_interval_min', '最小间隔（分钟）'],
    ]
    for (const [key, label] of numericFields) {
      const raw = String(form[key] ?? '').trim()
      if (raw && !Number.isFinite(Number(raw))) {
        notifyErr(`「${label}」需要填数字（当前：${raw}）`)
        return
      }
    }
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
    setForm(templateToForm())
    notifyOk('已填入模板：先把每一处【】替换成你自己的信息，再补手机号与邮箱后保存（数字口径要能在仓库里核对）')
  }

  /** 换厂商：档位是显式选择，所以选完立刻把「谁付钱」与就绪状态换过来 */
  function pickVendor(id: string) {
    setByoPresetId(id)
    const next = currentPreset()
    setChannel(next)
    setKeyDraft('')
    setHasKey(hasUserKey())
    setModelDraft('')
    setCheckResult(null)
    if (next.httpLocal) {
      setLocalReady(false)
      checkConnection({ preset: next, model: getByoModel(next) })
        .then(() => setLocalReady(isLocalServiceReady()))
        .catch(() => setLocalReady(false))
    }
  }

  function saveKey() {
    const v = keyDraft.trim()
    if (!v) {
      notifyErr('先粘贴 Key 再保存')
      return
    }
    setUserKey(v)
    // 存完立刻清空输入框：留在 state 里就多一处能被翻出来的地方
    setKeyDraft('')
    setHasKey(hasUserKey())
    notifyOk('已保存到这台设备的浏览器里；本应用没有服务端保管它')
  }

  function forgetKey() {
    setUserKey(null)
    setHasKey(false)
    notifyOk('已删除本机保存的 Key')
  }

  function saveByoModel() {
    setByoModel(channel.id, modelDraft)
    notifyOk(`已记下：${channel.label} 用 ${getByoModel(channel)}`)
  }

  /**
   * 点一个「常见模型」＝**选中并立刻记下**，不需要再点一次「记住模型名」。
   *
   * 为什么要有这个函数：`channel.models` 一直存在，`aiChannels.ts` 里那个字段的注释写的就是
   * 「前端下拉用」，但界面只把它拼进了一句提示文字 —— 用户想换模型只能自己去厂商文档里抄名字。
   * 谁订的模型名谁最清楚，本应用手里已经有这份名单，没有理由不让人点。
   *
   * 为什么**同时保留手填**（不做成只读下拉）：新模型、预览版、自建别名/中转别名都可能不在表里，
   * 而模型名不影响请求发去哪（主机才影响，见 aiChannels.ts 文件头第 1 条），所以手填是安全的。
   * 表里的名单只是「常见」，不是「允许」。
   *
   * 这里必须连草稿一起改写：`modelInUse` 是「草稿优先」的，只存不写草稿的话，
   * 输入框里那条旧文字会盖住刚选中的值，界面自相矛盾。
   */
  function pickByoModel(name: string) {
    const m = String(name ?? '').trim()
    if (!m) return
    setModelDraft(m)
    setByoModel(channel.id, m)
    notifyOk(`已记下：${channel.label} 用 ${getByoModel(channel)}`)
  }

  async function selfCheck() {
    setChecking(true)
    setCheckResult(null)
    try {
      const r = await checkConnection({ preset: channel, model: getByoModel(channel) })
      setCheckResult(r)
      setLocalReady(isLocalServiceReady())
    } catch (error) {
      setCheckResult({ ok: false, text: errText(error) })
    } finally {
      setChecking(false)
    }
  }

  /**
   * 开关只是入口，不是授权：写存储这一处再过一次身份判定。
   * 不然任何人从控制台、或将来别的调用点，都能绕过界面把创建者的钱包打开。
   */
  function toggleTrial(next: boolean) {
    if (!isOwnerAccount(sessionEmail())) {
      notifyErr('这道开关只有应用创建者的账号能用')
      return
    }
    setOwnerTrialEnabled(next)
    setTrial(next)
    notifyOk(next ? '已开启「用本应用的额度试用」：这一档花的是应用创建者的额度' : '已关闭试用档：AI 只走你自己自备的通道')
  }

  async function saveModel() {
    setSavingModel(true)
    try {
      setModelChoice(chosen || null)
      const eff = await pickModel()
      setEffective(eff ?? '')
      notifyOk(eff ? `已切换：AI 调用将使用 ${eff}` : '未找到可用模型，AI 功能暂不可用')
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setSavingModel(false)
    }
  }

  /** 下拉里选中（或实际生效）的那条目录记录：用来显示它的计费信息 */
  const chosenModel = models.find((m) => m.id === (chosen || effective))

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
            <h3>AI 通道</h3>
            <span className="spacer" />
            <span className="badge">{card.configured && card.sendable ? '可用' : card.configured ? '待就绪' : '未配置'}</span>
          </div>
          <div className="card-body">
            <div className="hint mb16">
              AI 只走你在这里选的那一条通道，而且<strong>默认是自备 Key</strong>，花的是你自己账户的余额。
              「用本应用的额度」那一档记在<strong>应用创建者的账号</strong>上，所以它默认关着，不会替使用者垫钱。
            </div>

            <Field label="通道" hint="厂商白名单是写死在代码里的：这里列不出来的地址，本应用一律不发（那等于做一个谁都能借的转发器）">
              <div className="row wrap" style={{ gap: 6 }}>
                {BYO_PRESETS.map((p) => (
                  <button key={p.id} type="button" className={channel.id === p.id ? 'chip on' : 'chip'} onClick={() => pickVendor(p.id)}>
                    {p.label}
                  </button>
                ))}
              </div>
            </Field>

            <div className="small mt8">
              谁付钱：<strong>{card.whoPays}</strong>
            </div>
            <div className={card.configured && card.sendable ? 'small muted mt8' : 'hint mt8'}>{card.status}</div>

            {card.needsKey ? (
              <Field label="你的 Key" hint={keyHint()}>
                <div className="row" style={{ gap: 6 }}>
                  <input
                    className="input"
                    type="password"
                    autoComplete="off"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder="粘贴一次即可；保存后输入框立刻清空，界面只显示头尾掩码"
                  />
                  <button className="btn primary" type="button" onClick={saveKey} disabled={!keyDraft.trim()}>
                    保存 Key
                  </button>
                  {hasKey ? (
                    <button className="btn" type="button" onClick={forgetKey}>
                      删除
                    </button>
                  ) : null}
                </div>
              </Field>
            ) : (
              <div className="hint mt8">
                这一档不需要 Key：模型跑在你自己的电脑上，不花任何人的钱。装法：官网装 Ollama，命令行
                <code> ollama pull qwen3:4b </code>，再 <code>ollama serve</code>（默认端口 11434）。
                慢一些，但没有额度、限流与账单这回事。
              </div>
            )}

            <Field
              label="模型名"
              hint={`直接发给 ${channel.label}。下面这一家的常见模型点一下即生效；也可以手填表里没列的（新模型、预览版、自建别名）`}
            >
              {channel.models.length > 0 ? (
                <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
                  {channel.models.map((m) => (
                    <button key={m} type="button" className={modelInUse === m ? 'chip on' : 'chip'} onClick={() => pickByoModel(m)}>
                      {m}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="row" style={{ gap: 6 }}>
                <input className="input" value={modelDraft} onChange={(e) => setModelDraft(e.target.value)} placeholder={getByoModel(channel)} />
                <button className="btn" type="button" onClick={saveByoModel} disabled={!modelDraft.trim()}>
                  记住模型名
                </button>
              </div>
            </Field>
            <div className="small muted mt8">当前会用：{modelInUse}</div>

            <div className="row mt16" style={{ gap: 8 }}>
              <button className="btn" type="button" onClick={selfCheck} disabled={checking}>
                {checking ? '自检中…' : '自检一下'}
              </button>
              <span className="spacer" />
              <span className="small muted">{card.note}</span>
            </div>
            {checkResult ? (
              <div className="hint mt8" style={{ color: checkResult.ok ? '#16a34a' : '#d97706' }}>
                {checkResult.text}
              </div>
            ) : null}

            {isOwner ? (
              <div className="mt16">
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={trial} onChange={(e) => toggleTrial(e.target.checked)} />
                  <span>
                    允许「用本应用的额度试用」
                    <span className="small muted">（这一档花的是应用创建者的额度，且仍受下面的日限与步数护栏约束）</span>
                  </span>
                </label>
              </div>
            ) : OWNER_EMAIL ? (
              <div className="small muted mt16">
                「用本应用的额度试用」这道开关只对<strong>应用创建者的账号</strong>显示。当前登录的不是创建者账号，所以这里看不到它。
                AI 请自备 Key，或选本机模型。
              </div>
            ) : (
              <div className="hint mt16">
                还没有「用本应用的额度」这一档可用：创建者邮箱没在 <code>src/lib/ownerAccount.ts</code> 的
                <code> OWNER_EMAIL </code>里设置，所以<strong>谁都不算创建者</strong>，这道开关对谁都不显示。
                留空是刻意的默认关闭。要开这一档，先填上你自己的登录邮箱，再用该账号来这里勾选。
              </div>
            )}

            <div className="small muted mt16">
              本次会话（当前标签页，关闭即归零）：已调用 {stats.calls} 次 · 输入 {stats.prompt} tokens · 输出 {stats.completion} tokens
            </div>
          </div>
        </section>

        {isOwner ? (
          <section className="card">
            <div className="card-head">
              <h3>AI 模型</h3>
              <span className="spacer" />
              <span className="badge">{effective ? `当前生效：${effective}` : '未就绪'}</span>
            </div>
            <div className="card-body">
              <div className="hint mb16">
                这一节只配<strong>「用本应用的额度」那一档</strong>的模型。自备 Key 与本机模型的模型名填在「AI 通道」卡里，与这里无关。
              </div>
              {modelsErr ? (
                <div className="small" style={{ color: '#d97706' }}>模型目录加载失败：{modelsErr}（不影响其他功能）</div>
            ) : models.length === 0 ? (
                <div className="small muted">模型目录加载中…</div>
            ) : (
                <>
                  <Field label="模型" hint={`共 ${models.length} 个可用模型可选；倍率来自平台下发的目录`}>
                    <select className="select" value={chosen} onChange={(e) => setChosen(e.target.value)}>
                      <option value="">（使用平台默认：Auto，思考型 · 倍率浮动）</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {m.credits ? ` · ${m.credits.replace(/credits?/i, '').trim()}` : ''}
                          {m.reasoning ? ' · 思考型（更慢）' : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="small muted mt8">计费：{modelCostLabel(chosenModel)}</div>
                  <div className="hint mt8">
                    不选＝走平台的 <strong>Auto</strong>：它每次都自动挑模型，且是<strong>高推理档的思考型</strong>，
                    所以又快又便宜都不是它的目标。想稳、想省钱、想快，就在上面选一个具体模型。
                  </div>
                  <button className="btn primary mt8" onClick={saveModel} disabled={savingModel}>
                    {savingModel ? '保存中…' : '保存模型选择'}
                  </button>
                  <div className="hint mt16">
                    <strong>这一档怎么来的</strong>：调用平台模型目录里的模型（DeepSeek / GLM / Kimi / 混元…），
                    厂商 Key 存在云服务端、<strong>不用你自己填</strong>，
                    额度的错误码前缀是 <code>quota_</code>（<em>Creator quota</em>）。
                    <br />
                    <strong>限额护栏</strong>：每天 {DEFAULT_QUOTA.dailyTasks} 件 AI 任务、单件 {DEFAULT_QUOTA.maxCallsPerTask} 步、
                    全天 {DEFAULT_QUOTA.maxCallsPerDay} 次调用，任一上限命中即拒绝并说明原因。
                    应用侧读不到余额（SDK 只有模型目录和调用两个接口），下面几行就是全部的可见性。
                  </div>
                  <div className="small mt8">
                    今日额度：已用 {quota?.usedTasks ?? 0} / {DEFAULT_QUOTA.dailyTasks} 件事 · 剩 {quota?.remainingTasks ?? DEFAULT_QUOTA.dailyTasks} 件 · 今日累计 {quota?.callsToday ?? 0} 次调用
                  </div>
                  {quota?.degraded ? (
                    <div className="hint mt8">
                      <strong>额度台账当前不可用</strong>（浏览器隐私模式，或本机存储配额爆了）：护栏处于
                      <strong>放行</strong>状态，挡不住超额调用。回到正常浏览模式即可恢复计数。
                    </div>
                  ) : (
                    <div className="small muted mt8">
                      台账记在<strong>这台设备</strong>的浏览器里：清站点数据或换浏览器会重新计数，跨设备不同步。
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        ) : null}

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
        <label className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={usageOn}
            onChange={(e) => {
              setUsageOn(e.target.checked)
              setUsageOptOut(!e.target.checked)
            }}
          />
          <span className="small">
            匿名使用统计（只记<b>功能使用次数</b>，如是否抓取成功；<b>不收集</b>岗位/简历/投递内容，随时可关）
          </span>
        </label>
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
