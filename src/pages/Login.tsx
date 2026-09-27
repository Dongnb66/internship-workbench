import { useState } from 'react'
import { cloud, errText } from '../cloud'
import { Field } from '../components/ui'
import { codesAreConfigured, signupGate } from '../lib/registration'

type Mode = 'otp' | 'password' | 'reset'

/**
 * 验证码挑战保存在事件处理函数之外：发码与校验是两个独立动作。
 * 发码必须显式触发，校验只读这里存下的结果 —— 否则重试验证码时会重复发码。
 */
let pending: { email: string; verificationId: string; isExistingUser: boolean } | null = null
let resetPending = false

export default function Login() {
  // 默认落在「验证码登录」：已有账号一步到位；新邮箱还要邀请码（见 registration.ts）
  const [mode, setMode] = useState<Mode>('otp')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [invite, setInvite] = useState('')
  // 这个邮箱是不是新用户，要等发码之后才知道（上游给的），所以单独存一份给界面用
  const [isNewEmail, setIsNewEmail] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [codeSent, setCodeSent] = useState(false)

  const startCountdown = () => {
    setCountdown(60)
    const timer = window.setInterval(() => {
      setCountdown((v) => {
        if (v <= 1) {
          window.clearInterval(timer)
          return 0
        }
        return v - 1
      })
    }, 1000)
  }

  /** 获取验证码：登录/注册与找回密码共用入口，按当前模式决定走哪条链路 */
  async function sendCode() {
    if (!email) {
      setError('请先填写邮箱')
      return
    }
    setError('')
    setInfo('')
    setBusy(true)
    try {
      if (mode === 'reset') {
        const started = await cloud.auth.resetPasswordForEmail(email)
        if (started.error) {
          setError(errText(started.error))
          return
        }
        resetPending = true
        setInfo(`验证码已发送到 ${email}，请查收（含垃圾箱）`)
        setCodeSent(true)
        startCountdown()
        return
      }

      const sent = await cloud.auth.sendOtp({ email })
      if (sent.error) {
        setError(errText(sent.error))
        return
      }
      pending = { email, verificationId: sent.data.verificationId, isExistingUser: sent.data.isExistingUser }
      setIsNewEmail(sent.data.isExistingUser === false)
      setInfo(
        sent.data.isExistingUser === false
          ? `验证码已发送到 ${email}。这个邮箱还没有账号：新邮箱要凭邀请码开账号（下一步会用到）。`
          : `验证码已发送到 ${email}，请查收（含垃圾箱）`,
      )
      setCodeSent(true)
      startCountdown()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  async function loginWithPassword() {
    setError('')
    setInfo('')
    setBusy(true)
    try {
      const res = await cloud.auth.signInWithPassword({ email, password })
      if (res.error) {
        // 不能一刀切「邮箱或密码不正确」：早期验证码注册的账号从未设置过密码
        //（0.3.1 之前登录页没有设密码字段），signInWithPassword 必然失败——
        // 真实原因被掩盖后，用户只会反复试密码，最后误以为只能被"重置"。
        setError(
          `登录失败：${errText(res.error)}。若该邮箱从未设置过密码（早期用验证码注册的账号），请切到「找回密码」设置一个，或直接用「验证码登录」。`,
        )
        return
      }
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  /** 校验验证码：新邮箱走注册（必须设密码），已存在的邮箱直接登录 */
  async function submitCode() {
    const current = pending
    if (!current || current.email !== email) {
      setError('请先为当前邮箱获取验证码')
      return
    }
    if (!current.isExistingUser && password.length < 6) {
      setError('请设置一个至少 6 位的登录密码')
      return
    }
    /**
     * 注册收口：账号只在下面这一次 `verifyOtp` 里产生（上游按 `isExistingUser` 决定
     * 是登录还是开新号），所以门必须挡在这一行之前——过了门才准调用。
     *
     * 诚实的边界：这挡的是**从界面进来**的路人。绕过页面直接拿应用标识调认证接口的，
     * 代码管不了；那半边要创建者在云控制台关 sign-up。界面上面那句话就是为此而写。
     */
    const gate = signupGate({ isExistingUser: current.isExistingUser, code: invite })
    if (!gate.allowed) {
      setError(gate.reason)
      return
    }
    setError('')
    setBusy(true)
    try {
      const res = await cloud.auth.verifyOtp({
        email: current.email,
        verificationId: current.verificationId,
        isExistingUser: current.isExistingUser,
        token: code,
        password: current.isExistingUser ? undefined : password,
      })
      if (res.error) {
        setError('验证码不正确或已过期，可重新获取')
        return
      }
      pending = null
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  async function submitReset() {
    if (!resetPending) {
      setError('请先点击「发送验证码」')
      return
    }
    if (newPassword.length < 6) {
      setError('新密码至少 6 位')
      return
    }
    setError('')
    setBusy(true)
    try {
      const started = await cloud.auth.resetPasswordForEmail(email)
      if (started.error) {
        setError(errText(started.error))
        return
      }
      const done = await started.data.updateUser({ nonce: code, password: newPassword })
      if (done.error) {
        setError(errText(done.error))
        return
      }
      resetPending = false
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError('')
    setInfo('')
    setCodeSent(false)
    setInvite('')
    setIsNewEmail(false)
    pending = null
    resetPending = next === 'reset'
  }

  const tabs: Array<{ key: Mode; label: string }> = [
    { key: 'otp', label: '验证码登录' },
    { key: 'password', label: '密码登录' },
    { key: 'reset', label: '找回密码' },
  ]

  const needPasswordField = mode === 'otp'
  /** 新邮箱且名单还没配置：这不是用户的错，界面要说什么就是什么 */
  const signupClosed = codesAreConfigured() === false

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <span className="logo-dot">实</span>
          <div>
            <h1 className="login-title">实习管理工作台</h1>
            <span className="small muted">岗位池 · 投递看板 · 面试跟进 · AI 分析</span>
          </div>
        </div>
        <p className="login-sub">
          已有账号：用验证码或密码登录。<strong>新邮箱不再自行注册</strong>——需要应用创建者给的邀请码。
          {signupClosed ? '（当前这台站还没设置邀请码，所以新账号一律开不出来。）' : ''}
        </p>

        <div className="row wrap mb16" style={{ gap: 6 }}>
          {tabs.map((t) => (
            <button key={t.key} className={mode === t.key ? 'chip on' : 'chip'} onClick={() => switchMode(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        <Field label="邮箱">
          <input
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              // 换了收件邮箱，之前那份挑战作废
              if (pending && pending.email !== e.target.value) setCodeSent(false)
            }}
            placeholder="you@example.com"
          />
        </Field>

        {mode === 'password' ? (
          <Field label="密码">
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
            />
          </Field>
        ) : null}

        {needPasswordField ? (
          <Field
            label="登录密码"
            hint="首次使用请设置（至少 6 位）。注意：已有账号用验证码登录时，这里填的密码不会生效（认证服务会忽略）——老账号补设密码请用「找回密码」"
          >
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位（仅首次注册时生效）"
            />
          </Field>
        ) : null}

        {mode === 'otp' && isNewEmail ? (
          <Field label="邀请码" hint="向应用创建者要一个。这一步之后才会真的创建账号；已有账号不需要它">
            <input
              className="input"
              type="text"
              autoComplete="off"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              placeholder="创建者发给你的邀请码"
            />
          </Field>
        ) : null}

        {mode === 'otp' || mode === 'reset' ? (
          <Field label="邮箱验证码">
            <div className="row">
              <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位验证码" />
              <button className="btn" type="button" onClick={sendCode} disabled={busy || countdown > 0}>
                {countdown > 0 ? `${countdown}s` : codeSent ? '重新发送' : '发送验证码'}
              </button>
            </div>
          </Field>
        ) : null}

        {mode === 'reset' ? (
          <Field label="新密码">
            <input className="input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="至少 6 位" />
          </Field>
        ) : null}

        {error ? <div className="hint mb8">{error}</div> : null}
        {info ? <div className="small muted mb8">{info}</div> : null}

        {mode === 'password' ? (
          <button className="btn primary" style={{ width: '100%' }} onClick={loginWithPassword} disabled={busy || !email || !password}>
            {busy ? '登录中…' : '登录'}
          </button>
        ) : null}
        {mode === 'otp' ? (
          <button className="btn primary" style={{ width: '100%' }} onClick={submitCode} disabled={busy || !code}>
            {busy ? '处理中…' : '登录 / 注册'}
          </button>
        ) : null}
        {mode === 'reset' ? (
          <button className="btn primary" style={{ width: '100%' }} onClick={submitReset} disabled={busy || !code || !newPassword}>
            {busy ? '提交中…' : '重置密码并登录'}
          </button>
        ) : null}

        <p className="small muted mt16" style={{ lineHeight: 1.7 }}>
          本工作台使用邮箱账号：支持验证码登录（首次使用自动注册）与邮箱密码登录。手机号 / 短信与微信登录由认证服务仅在小程序端提供，网页端不开放。验证码与登录需在正式发布地址上完成，本地预览环境收不到邮件。
        </p>
      </div>
    </div>
  )
}
