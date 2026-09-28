import { describe, expect, it } from 'vitest'
import { emailLooksValid, emailProblem, humanizeCloudError } from '../email'

/** 用户 2026-09-28 实测抓到的原文（邮箱框里只填了纯数字） */
const SERVER_ECHO =
  'invalid SendVerificationCodeRequest.Email: value does not match regex pattern "^[^1][0-9A-Za-z_]{1,40}@[0-9A-Za-z_]{1,40}\\.[A-Za-z]{1,10}$"'

describe('emailProblem', () => {
  it('空值 → 先提示填邮箱', () => {
    expect(emailProblem('')).toBe('请先填写邮箱')
    expect(emailProblem('   ')).toBe('请先填写邮箱')
  })

  it('纯数字（缺 @ 与域名）→ 说清缺什么，并给出可直接照抄的完整地址', () => {
    const msg = emailProblem('myuser')
    expect(msg).toContain('myuser@qq.com') // 建议必须补全，不能只说"格式不正确"
    expect(msg).toContain('@')
  })

  it('@ 后有域名但没有点 → 仍然不放行', () => {
    expect(emailProblem('a@b')).not.toBeNull()
    expect(emailProblem('a@b.com')).toBeNull()
  })

  it('把「输入前后带空格」当合法（用户从别处粘贴很常见）', () => {
    expect(emailProblem('  example@qq.com  ')).toBeNull()
    expect(emailLooksValid('  example@qq.com  ')).toBe(true)
  })

  it('合法邮箱一律放行 —— 前端不比服务端更严，不挡掉任何合法写法', () => {
    for (const v of [
      'example@qq.com',
      'a_b-1@sub.example.com.cn',
      'x@y.io',
      'first.last+tag@gmail.com',
    ]) {
      expect(emailProblem(v), v).toBeNull()
      expect(emailLooksValid(v), v).toBe(true)
    }
  })
})

describe('humanizeCloudError', () => {
  it('服务端的正则原文 → 人话（这条断言用的就是线上真实抓到的字符串）', () => {
    const out = humanizeCloudError(SERVER_ECHO)
    expect(out).toContain('邮箱格式')
    expect(out).not.toContain('regex') // 正则绝不能出现在给用户看的文案里
    expect(out).not.toContain('SendVerificationCodeRequest')
  })

  it('同类原文按字段分流到不同提示', () => {
    expect(humanizeCloudError('invalid X.Code: value does not match regex pattern "\\d{6}"')).toContain('验证码')
    expect(humanizeCloudError('invalid X.Password: value does not match regex pattern ".{6,}"')).toContain('密码')
    expect(humanizeCloudError('invalid X.Foo: value does not match regex pattern "abc"')).toContain('格式不符合要求')
  })

  it('认不出的错误原样透出 —— 宁可显示英文，也不编一个可能不对的原因', () => {
    expect(humanizeCloudError('network timeout')).toBe('network timeout')
    expect(humanizeCloudError('')).toBe('请求失败，请重试')
  })
})
