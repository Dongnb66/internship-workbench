import { useRef, useState } from 'react'
import { cloud, errText } from '../cloud'
import { Field } from '../components/ui'
import { emailProblem } from '../lib/email'
import { registrationMode, signupGate } from '../lib/registration'

type Mode = 'otp' | 'password' | 'reset'

type Pending = { email: string; verificationId: string; isExistingUser: boolean }

/**
 * 验证码挑战保存在事件处理函数之外：发码与校验是两个独立动作。
 * 发码必须显式触发，校验只读这里存下的结果 —— 否则重试验证码时会重复发码。
 *
 * **为什么存 sessionStorage 而不是模块变量。**
 * 原先这里是 `let pending = null` —— 一个模块级内存。它会在**页面刷新时静默消失**：
 * 用户点「发送验证码」→ 去邮箱取码 → 顺手刷新一下页面（或 SPA 被重新挂载）→
 * 回来填码 → 点「登录 / 注册」→ 命中 `if (!current)` 直接 return，**一个网络请求都不发**。
 * 界面只给一句「请先为当前邮箱获取验证码」，而用户刚刚才收到码，于是他只会认为
 * 「这个站的登录坏了」，反复重试同一个动作 —— 拿到码也永远登不进去。
 *
 * 换成 sessionStorage 后，同一个标签页内刷新不再丢（跨标签页的兜底见下面 stores 那段）。
 */
const PENDING_KEY = 'iwb.login.pending'

/**
 * 除了 sessionStorage，还留一份内存和一份 localStorage：
 * ① 内存 —— 隐私模式 / 内嵌窗口 / 被安全软件拦的环境里，碰 storage 会直接抛异常。
 *    以前 catch 一吞，挑战就再也读不回来：用户手里明明有码，只会看到「验证码已失效」。
 *    同一个页面会话里，内存这份一定在，所以发码与验码至少能连上。
 * ② localStorage —— sessionStorage 按标签页隔离，换个标签页/新窗口打开就是空的。
 *    挑战本身不是凭证（真正的凭证是那串验证码），跨标签页共用没有安全问题。
 */
let memoryPending: Pending | null = null

/**
 * 「设置 / 找回密码」发码时拿到的挑战（带 `updateUser`）。它带闭包、没法进 storage，
 * 只活在当前页面：刷新后必须重新发码 —— 与验证码一次性相符。
 * 存它是为了**别再发第二封邮件**：上游限制 1 分钟 1 封，发两封第二封必被限流。
 */
type ResetChallenge = { updateUser: (u: { nonce: string; password: string }) => Promise<{ error?: unknown }> }

function stores(): Storage[] {
  const out: Storage[] = []
  for (const get of [() => window.sessionStorage, () => window.localStorage]) {
    try {
      const s = get()
      if (s) out.push(s)
    } catch {
      /* 这个存储拿不到就跳过，不影响另一个 */
    }
  }
  return out
}

function coercePending(v: Partial<Pending> | null | undefined): Pending | null {
  if (!v || typeof v.email !== 'string' || typeof v.verificationId !== 'string' || !v.verificationId) return null
  return { email: v.email, verificationId: v.verificationId, isExistingUser: v.isExistingUser === true }
}

function readPending(): Pending | null {
  if (memoryPending) return memoryPending
  for (const s of stores()) {
    try {
      const raw = s.getItem(PENDING_KEY)
      if (!raw) continue
      const v = coercePending(JSON.parse(raw) as Partial<Pending> | null)
      if (v) {
        memoryPending = v
        return v
      }
    } catch {
      /* 这一份坏了就试下一份 */
    }
  }
  return null
}

function writePending(v: Pending | null) {
  memoryPending = v
  for (const s of stores()) {
    try {
      if (v) s.setItem(PENDING_KEY, JSON.stringify(v))
      else s.removeItem(PENDING_KEY)
    } catch {
      /* 某一个存储不可用不影响别的 */
    }
  }
}

export default function Login() {
  // 默认落在「验证码登录」：已有账号与新邮箱共用这一步（口径与开关见 registration.ts）
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
  // 密码登录失败时，把「去设置密码」的入口亮出来（老账号可能压根没设过密码）
  const [suggestReset, setSuggestReset] = useState(false)
  // 「设置 / 找回密码」发码时拿到的挑战：提交时复用它，避免又发一封邮件撞上 1 分钟限流
  const resetChallenge = useRef<ResetChallenge | null>(null)

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
    // 前置校验：只填纯数字这类明显不是邮箱的输入，不再把服务端的正则原文
    // （value does not match regex pattern ...）抛到界面上 —— 见 lib/email.ts 文件头
    const problem = emailProblem(email)
    if (problem) {
      setError(problem)
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
        /**
         * 挑战必须留在手里：`updateUser({ nonce })` 用的就是这一次发码的挑战。
         * 以前没存，`submitReset` 里又调了一遍 `resetPasswordForEmail` —— 等于连发两封，
         * 撞上「1 分钟只能收 1 封」限流，用户看到的就是一直重置不成。
         */
        resetChallenge.current = started.data
        setInfo(`验证码已发送到 ${email}，请查收（含垃圾箱）。填好新密码点下面的按钮即可。`)
        setCodeSent(true)
        startCountdown()
        return
      }

      const sent = await cloud.auth.sendOtp({ email })
      if (sent.error) {
        setError(errText(sent.error))
        return
      }
      const challenge = sent.data
      if (!challenge || !challenge.verificationId) {
        // 邮件已经发出去了，但这次挑战的凭据没拿到 —— 之后填什么码都验不过。
        // 与其让用户跑去收件箱取码、回来再被「验证码已失效」骗一次，不如现在就说清楚。
        setError('验证码已经发出，但这次没拿到校验凭据（上游返回缺 verificationId）。请再点一次「发送验证码」；反复出现说明云服务配置有问题。')
        return
      }
      writePending({ email, verificationId: challenge.verificationId, isExistingUser: challenge.isExistingUser })
      setIsNewEmail(challenge.isExistingUser === false)
      setInfo(
        challenge.isExistingUser === false
          ? `验证码已发送到 ${email}。这个邮箱还没有账号，验完码会自动开一个，请同时设好登录密码（下次就能直接用密码登录）。`
          : `验证码已发送到 ${email}，请查收（含垃圾箱）。这个邮箱已有账号：如果之前从没设过密码，请用「找回密码」设一次，之后就不必每次等验证码了。`,
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
    const problem = emailProblem(email)
    if (problem) {
      setError(problem)
      return
    }
    setError('')
    setInfo('')
    setSuggestReset(false)
    setBusy(true)
    try {
      const res = await cloud.auth.signInWithPassword({ email, password })
      if (res.error) {
        // 不能一刀切「邮箱或密码不正确」：早期验证码注册的账号从未设置过密码
        //（0.3.1 之前登录页没有设密码字段），signInWithPassword 必然失败——
        // 真实原因被掩盖后，用户只会反复试密码，最后误以为只能被"重置"。
        setSuggestReset(true)
        setError(
          `登录失败：${errText(res.error)}。若这个邮箱是用验证码注册、从没设过密码，点右边「去设置密码」走一次找回密码，之后就能直接用密码登录。`,
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
    const current = readPending()
    /**
     * 两种「拿不到挑战」要分开说 —— 以前合成一句「请先为当前邮箱获取验证码」，
     * 而用户刚刚才收到码，看到这句只会以为站点坏了，然后一直点同一个按钮。
     */
    if (!current) {
      setError('这个页面上的验证码已失效（页面刷新过，或换过标签页）。请重新点「发送验证码」。')
      return
    }
    if (current.email !== email) {
      setError('邮箱已经改过了，请为当前填的邮箱重新获取验证码。')
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
        // 带上上游原文：一律盖成「验证码不正确或已过期」时，
        // 「码是对的但一直失败」这种情况就永远查不出原因（挑战过期 / 邮箱不一致 / 服务端拒绝都不一样）。
        setError(`验证失败：${errText(res.error)}。码刚拿到就失败的话，请重新点「发送验证码」再来一次。`)
        return
      }
      writePending(null)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  async function submitReset() {
    const challenge = resetChallenge.current
    if (!challenge) {
      setError('这个页面上的验证码已失效（页面刷新过，或换过标签页）。请重新点「发送验证码」，收到新码后再提交。')
      return
    }
    if (newPassword.length < 6) {
      setError('新密码至少 6 位')
      return
    }
    setError('')
    setBusy(true)
    try {
      // 用发码时那一次挑战，不再重复请求新邮件（重复请求会撞「1 分钟 1 封」限流）
      const done = await challenge.updateUser({ nonce: code, password: newPassword })
      if (done.error) {
        setError(`重置失败：${errText(done.error)}`)
        return
      }
      resetChallenge.current = null
      setInfo('密码已设置成功。之后可以直接用「密码登录」，不必再等验证码。')
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
    setSuggestReset(false)
    // 验证码是一次性的：换流程后旧码不再对应新流程的挑战，留着只会让人误提交
    setCode('')
    setNewPassword('')
    writePending(null)
    // 换流程后这次发码的挑战作废；回到重置流程必须重新发码
    resetChallenge.current = null
  }

  const tabs: Array<{ key: Mode; label: string }> = [
    { key: 'otp', label: '验证码登录' },
    { key: 'password', label: '密码登录' },
    { key: 'reset', label: '设置 / 找回密码' },
  ]

  /**
   * 只有「已确认是新邮箱」才出现设密码的输入框。
   * 老账号在 verifyOtp 里填的密码会被认证服务直接忽略（SDK 契约原文：
   * 「注册路径可选设置密码；已存在用户忽略此项」）。以前这个框一直显示，
   * 用户照着填、以为密码注册成功了，第二天用密码登录必然失败 —— 就是这来的。
   */
  const needPasswordField = mode === 'otp' && isNewEmail
  /**
   * 要不要问邀请码，读的是 `registrationMode()` 这一个事实源：名单里有真码才要。
   * 出厂是开放状态 —— 这时候页面上还写着「需要邀请码」就是在骗人，
   * 所以这句话跟判定共用同一个来源，不各写一遍。
   */
  const inviteNeeded = mode === 'otp' && isNewEmail && registrationMode() === 'invite'

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
          填邮箱收验证码即可：已有账号就登录，新邮箱会自动开一个（注册时设好登录密码）。
          设过密码之后就能直接用「密码登录」，不必每次等验证码。
          <strong>AI 功能需要你自己的模型 Key（或本机模型）</strong>，本应用的额度记在创建者账号上，不默认替使用者承担。
          {inviteNeeded ? '这个站现在按邀请码开账号，新邮箱记得带上创建者给你的码。' : ''}
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
              // 换了收件邮箱，之前那份挑战作废 —— 挑战现在存在 sessionStorage 里，刷新也不丢
              const p = readPending()
              if (p && p.email !== e.target.value) setCodeSent(false)
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
            hint="至少 6 位。这就是新账号的登录密码，下次可以直接用「密码登录」"
          >
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
            />
          </Field>
        ) : null}

        {mode === 'otp' && codeSent && !isNewEmail ? (
          <div className="hint mb8">
            这个邮箱已有账号，现在用验证码就能进去。想以后免验证码？
            <button
              className="btn sm"
              style={{ marginLeft: 8 }}
              onClick={() => switchMode('reset')}
            >
              设置密码
            </button>
          </div>
        ) : null}

        {inviteNeeded ? (
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

        {error ? (
          <div className="hint mb8">
            {error}
            {suggestReset ? (
              <button
                className="btn sm"
                style={{ marginLeft: 8 }}
                onClick={() => {
                  setSuggestReset(false)
                  switchMode('reset')
                }}
              >
                去设置密码
              </button>
            ) : null}
          </div>
        ) : null}
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
          本工作台用邮箱账号：验证码登录（首次自动注册）或密码登录。手机号 / 微信登录仅小程序端提供；验证码与登录需在正式发布地址完成，本地预览收不到邮件。
        </p>
      </div>
    </div>
  )
}
