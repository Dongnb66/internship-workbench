import { describe, expect, it } from 'vitest'

/**
 * 「用户自备 key」通道的断言（用户拍板走 A：新增常驻后端 + 保管用户的 key）。
 *
 * 拍板不等于放弃防线。这个文件钉的是四件事，每件都对应一种真实会出事的方式：
 * 1. **转发目标必须是厂商白名单**——否则这个后端就成了任何人可用的跳板（SSRF / 开放代理）。
 *    用户自己填的 baseURL 一律拒绝，不提供「我知道我在干什么」的口子：
 *    一个能被公网访问的转发口，滥用的不是填它的那个人，而是拿到这个 URL 的**所有人**。
 * 2. **key 只在本机内存与厂商之间流动**：不进 URL、不进日志、不进错误文案。
 *    「后端保管 key」不等于「后端记录 key」，这两件事必须分开实现、分开断言。
 * 3. **通道是显式选择**：平台额度（创建者付）与自备 key（用户付）不能自动漂移，
 *    默认值尤其不能悄悄是「创建者付」——那正是这次要解决的问题。
 * 4. 厂商差异（鉴权头写法、默认模型、是否支持流式）以**数据表**表达，
 *    网关与前端共用同一份事实源，有契约测试钉住逐字一致。
 */
import {
  AI_CHANNEL_DEFAULT,
  CHANNELS,
  assertForwardTarget,
  describeChannel,
  findPreset,
  redactKey,
} from '../aiChannels'

describe('厂商通道表', () => {
  it('自费档必须知道把 key 发给谁；平台档走 SDK，不该有厂商主机', () => {
    for (const c of CHANNELS) {
      expect(c.id).toBeTruthy()
      expect(c.label).toBeTruthy()
      expect(['user', 'creator']).toContain(c.paidBy)
      expect(['bearer', 'x-api-key']).toContain(c.authStyle)
      expect(c.whoPays.length).toBeGreaterThan(8)
      if (c.paidBy === 'user') {
        // 没有主机/路径就等于「把用户的 key 发到一个说不清的地方」，这是最坏的一种
        expect(c.host).toMatch(/^[a-z0-9.-]+$/i)
        expect(c.chatPath).toMatch(/^\//)
        expect(c.models.length).toBeGreaterThan(0)
      } else {
        // 平台档的模型清单在运行时从云服务目录拿（`models.list()`），
        // 这里写死一份就是假事实——目录会变，界面会跟着说谎
        expect(c.host).toBe('')
        expect(c.chatPath).toBe('')
      }
    }
    // 默认值必须是**用户自费**的那一档：这是这次改动的目的本身
    expect(AI_CHANNEL_DEFAULT).toBe('byo')
    expect(CHANNELS.map((c) => c.id)).toContain(AI_CHANNEL_DEFAULT)
    expect(describeChannel(AI_CHANNEL_DEFAULT).paidBy).toBe('user')
  })

  it('认得出这几家 OpenAI 兼容端点，且 https-only', () => {
    expect(findPreset('https://api.deepseek.com/v1')?.host).toBe('api.deepseek.com')
    expect(findPreset('https://open.bigmodel.cn/api/paas/v4')?.host).toBe('open.bigmodel.cn')
    expect(findPreset('https://api.moonshot.cn/v1')?.host).toBe('api.moonshot.cn')
    expect(findPreset('http://api.deepseek.com/v1')).toBeNull() // 明文 http 不接受
  })

  it('认不出的 baseURL 返回 null，而不是勉强匹配一个（避免把 key 发给陌生主机）', () => {
    expect(findPreset('https://evil.example.com/v1')).toBeNull()
    expect(findPreset('')).toBeNull()
  })
})

describe('转发白名单（SSRF / 开放代理防护）', () => {
  it('白名单内的厂商路径放行；非常规端口、后缀伪装一律拒绝', () => {
    const ok = assertForwardTarget('https://api.deepseek.com/chat/completions')
    expect(ok.allowed).toBe(true)
    // 端口这一条是变异检查逼出来的：厂商都在 443 上，非默认端口只可能是
    // 借白名单主机名打到一个别的监听口，而测试原来完全没有这一类地址。
    expect(assertForwardTarget('https://api.deepseek.com:8443/chat/completions').allowed).toBe(false)
  })

  it('白名单外一律拒绝，包括看起来像厂商的子域与大小写花招', () => {
    for (const url of [
      'https://api.deepseek.com.evil.cn/chat/completions',
      'https://API.DEEPSEEK.COM@evil.cn/',
      'https://evil.cn/?next=https://api.deepseek.com',
      'http://api.deepseek.com/chat/completions',
      'https://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:6379/',
    ]) {
      const r = assertForwardTarget(url)
      expect(r.allowed, `这个地址本不该被放行：${url}`).toBe(false)
      expect(r.reason).toBeTruthy()
    }
  })

  it('拒绝理由里不带 key（错误会被打印或被用户截图问人）', () => {
    const r = assertForwardTarget('https://evil.cn/x?sk-deadbeef')
    expect(r.reason ?? '').not.toContain('sk-deadbeef')
  })
})

describe('key 的可见性', () => {
  it('redactKey 把 key 换成掩码，保留前后可读片段用于排障', () => {
    const key = 'sk-abcdef1234567890wxyz'
    const out = redactKey(key)
    expect(out).not.toContain(key)
    expect(out).toMatch(/sk-abc/)
    expect(out).toMatch(/\*{3,}/)
  })

  it('对任意文本做脱敏：日志与错误文案里没有 key 的位置', () => {
    const key = 'sk-abcdef1234567890wxyz'
    const noisy = `请求失败 Authorization: Bearer ${key} 以及 body 里 "${key}"`
    const safe = redactKey(noisy)
    expect(safe).not.toContain(key)
    expect(safe.match(/\*{3,}/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('空 key 不会被误脱敏成奇怪的字符串', () => {
    expect(redactKey('')).toBe('')
    expect(redactKey(null as never)).toBe('')
  })
})

describe('通道是显式选择', () => {
  it('平台额度档仍然可选（创建者自己用），但它不是默认', () => {
    expect(describeChannel('platform').paidBy).toBe('creator')
    expect(describeChannel('byo').paidBy).toBe('user')
    expect(describeChannel(AI_CHANNEL_DEFAULT).paidBy).toBe('user')
  })

  it('未知档位不抛错也不静默变成自费/免费，而是回落到默认档并说明', () => {
    const s = describeChannel('乱填的值' as never)
    expect(s.id).toBe(AI_CHANNEL_DEFAULT)
    expect(s.fallback).toBe(true)
  })

  it('每档都带一句「谁付钱」的说明，界面必须能直接把这句话显示出来', () => {
    for (const c of CHANNELS) {
      expect(c.whoPays).toMatch(/你|创建者|用户|自己/)
      expect(c.whoPays.length).toBeGreaterThan(8)
    }
  })
})
