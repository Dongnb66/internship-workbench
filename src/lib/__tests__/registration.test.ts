import { describe, expect, it } from 'vitest'

/**
 * 注册收口的断言。
 *
 * 现状（实测过的事实）：登录页原先写着「无需单独注册：填邮箱收验证码，首次使用会自动创建账号」，
 * 而这个站的地址是公网可达的——任何人拿到链接都能开一个账号，然后每一个 AI 调用都记在
 * 应用创建者的额度上（Creator quota）。这次要把它关掉。
 *
 * **这条门能做到什么、做不到什么，必须写清楚，否则文档就成了假话**：
 * - 做得到：让**这个应用自己**不再创建账号——验证码那一页拿不到邀请码就不调 `verifyOtp`，
 *   而账号只有那一步会产生。所以从界面进来的路人被挡在外面。
 * - 做不到：挡住绕过界面、直接拿应用标识去调认证接口的人。真正的服务端开关
 *   （认证服务的 sign-up 设置）不在代码可达范围内，而且本机构的建表工具没挂载，
 *   连「邀请码名单放数据库」这条路都走不了。所以名单只能是源码里的一份常量，
 *   而这句话必须显示在界面上，让人知道边界在哪。
 */
import { INVITE_CODES, PLACEHOLDER_CODE, codesAreConfigured, normalizeCode, signupGate } from '../registration'

/** 一份「已经配置好」的名单：判定读的是名单本身，不是某个全局布尔 */
const OPEN = ['WB-2026-ab12', 'WB-2026-cd34']

describe('老用户不受影响', () => {
  for (const code of ['', '对的码', '错的码']) {
    it(`已存在的账号，邀请码是「${code || '空'}」也照样能登录`, () => {
      const g = signupGate({ isExistingUser: true, code, list: OPEN })
      expect(g.allowed).toBe(true)
      expect(g.createsAccount).toBe(false)
    })
  }

  it('名单还没配置时也不拿这个为难老用户（门只管新增）', () => {
    expect(signupGate({ isExistingUser: true, code: '', list: [PLACEHOLDER_CODE] }).allowed).toBe(true)
  })
})

describe('新注册一律先要邀请码', () => {
  it('没填码 → 拒绝，并把「去哪弄码」说清楚', () => {
    const g = signupGate({ isExistingUser: false, code: '', list: OPEN })
    expect(g.allowed).toBe(false)
    expect(g.reason).toMatch(/邀请码/)
    expect(g.reason).toMatch(/创建者|要/)
  })

  it('码对得上 → 放行，并明说这一步会真的创建账号（不许悄悄建号）', () => {
    const g = signupGate({ isExistingUser: false, code: OPEN[0], list: OPEN })
    expect(g.allowed).toBe(true)
    expect(g.createsAccount).toBe(true)
  })

  it('大小写与前后空格不影响（人抄码会抄成各种样子）', () => {
    expect(signupGate({ isExistingUser: false, code: `  ${OPEN[0].toLowerCase()}  `, list: OPEN }).allowed).toBe(true)
  })

  it('后缀花招不算通过：按全等比，不按「以…开头」', () => {
    expect(signupGate({ isExistingUser: false, code: `${OPEN[0]}EXTRA`, list: OPEN }).allowed).toBe(false)
    expect(signupGate({ isExistingUser: false, code: `X${OPEN[0]}`, list: OPEN }).allowed).toBe(false)
    // 这一条是变异检查逼出来的：只测「前后加字符」杀不掉 `startsWith(code)` 那种写法——
    // 而那种写法真正的漏洞在**猜短码**：只要猜对前几位就进来了。
    expect(signupGate({ isExistingUser: false, code: OPEN[0].slice(0, 6), list: OPEN }).allowed).toBe(false)
    expect(signupGate({ isExistingUser: false, code: 'WB', list: OPEN }).allowed).toBe(false)
  })

  it('名单里只有占位符 = 关闭；而占位符本身永远不算可用码（它就写在源码里，公开可读）', () => {
    expect(signupGate({ isExistingUser: false, code: PLACEHOLDER_CODE, list: [PLACEHOLDER_CODE] }).allowed).toBe(false)
    // 哪怕别人在名单里另外加了真码，抄来的占位符也进不来
    expect(signupGate({ isExistingUser: false, code: PLACEHOLDER_CODE, list: [PLACEHOLDER_CODE, ...OPEN] }).allowed).toBe(false)
  })

  it('两种拒绝说得清是两种原因：站没配置，与用户码不对（合并成一句就会误导人）', () => {
    expect(signupGate({ isExistingUser: false, code: PLACEHOLDER_CODE, list: [PLACEHOLDER_CODE] }).reason).toMatch(
      /还没设置邀请码|谁都注册不进来/,
    )
    expect(signupGate({ isExistingUser: false, code: '瞎猜的', list: OPEN }).reason).toMatch(/邀请码不对/)
    expect(signupGate({ isExistingUser: false, code: '', list: OPEN }).reason).toMatch(/向应用创建者要/)
  })

  it('拒绝理由里不回显提交上来的码（截图与日志里会留下它）', () => {
    const g = signupGate({ isExistingUser: false, code: 'some-guessed-code', list: OPEN })
    expect(g.reason).not.toContain('some-guessed-code')
  })

  it('名单为空数组时按未配置处理（空名单不该等于「什么码都行」）', () => {
    expect(normalizeCode('')).toBe('')
    expect(signupGate({ isExistingUser: false, code: 'anything', list: [] }).allowed).toBe(false)
  })
})

describe('默认状态：这个仓库现在到底开不开', () => {
  it('出厂名单只有占位符 → 站上是关闭状态（新注册进不来）', () => {
    expect(INVITE_CODES).toEqual([PLACEHOLDER_CODE])
    expect(codesAreConfigured(INVITE_CODES)).toBe(false)
    expect(signupGate({ isExistingUser: false, code: '任何人猜得到的码' }).allowed).toBe(false)
  })

  it('创建者换成真码之后才算「配置好了」——判定只有一份，不在测试里另写一遍规则', () => {
    expect(codesAreConfigured([PLACEHOLDER_CODE, ' WB-2026-ab12 '])).toBe(true)
    expect(codesAreConfigured([])).toBe(false)
    expect(codesAreConfigured([PLACEHOLDER_CODE])).toBe(false)
  })
})
