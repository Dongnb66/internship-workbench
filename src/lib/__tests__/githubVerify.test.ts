import { describe, expect, it } from 'vitest'

/**
 * 「回工作台做验收」的断言（AGENT_PLAN 第四步的另一半）。
 *
 * 用户把任务包派给智能体、代码推到自己 GitHub 之后，回来对着验收标准核对：
 * README 有没有、写没写怎么跑、测试在不在。
 *
 * 三条边界必须钉住（都来自 AGENTS.md 的硬约束）：
 * - **只读公开仓库**：只 GET api.github.com 的仓库与 README，不带任何凭据、不写任何东西。
 * - **拿不到就说拿不到**：404/403/限流一律如实标「无法确认」，绝不把「查不到」当成「没有」，
 *   更绝不编一个通过出来。
 * - 验收结论只说事实与缺口，不替用户断言个人短板。
 */
import { checkPackAcceptance, fetchRepoFacts } from '../githubVerify'
import { buildTaskPack } from '../mentor'

import type { Profile } from "../../types"

const PROFILE: Profile = { full_name: '杨同学', grade: '2028届', skills: ['Python'] }

function fakeFetch(handler: (url: string, init?: any) => { status: number; body: any }) {
  const calls: { url: string; init: any }[] = []
  const impl = async (url: string, init?: any) => {
    calls.push({ url, init })
    const r = handler(url, init)
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    }
  }
  return { impl, calls }
}

/** GitHub 的 README 接口给的是 base64(UTF-8)。app 的 tsconfig 只给 DOM 类型，所以不用 Buffer */
function encodeReadme(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

describe('只读边界', () => {
  it('只打公开仓库 API，且一律 GET', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 200, body: {} }))
    await fetchRepoFacts('Dongnb66', 'demo', { fetchImpl: impl })
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) {
      expect(c.url).toMatch(/^https:\/\/api\.github\.com\/repos\/Dongnb66\/demo/)
      expect(String(c.init?.method ?? 'GET').toUpperCase()).toBe('GET')
    }
  })

  it('不发任何凭据：不带 Authorization，也不接受外部塞进来的 header', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 200, body: {} }))
    await fetchRepoFacts('a', 'b', { fetchImpl: impl, headers: { Authorization: 'Bearer 偷来的token' } } as any)
    for (const c of calls) {
      const keys = Object.keys(c.init?.headers ?? {})
      expect(keys.map((k) => k.toLowerCase())).not.toContain('authorization')
    }
  })

  it('仓库名不合法就拒绝发请求（别把 URL 拼成别人的地址）', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 200, body: {} }))
    const r = await fetchRepoFacts('a/../evil', 'x?y=1', { fetchImpl: impl })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/不合法/)
    expect(calls).toHaveLength(0)
  })
})

describe('事实抓取', () => {
  it('README 存在时把正文取回来（base64 解码）', async () => {
    const { impl } = fakeFetch((url) =>
      url.includes('/readme')
        ? { status: 200, body: { content: encodeReadme('# 我的项目\n\n## 运行\nnpm install && npm test'), encoding: 'base64' } }
        : { status: 200, body: { full_name: 'a/b', default_branch: 'main', description: 'x' } },
    )
    const r = await fetchRepoFacts('a', 'b', { fetchImpl: impl })
    expect(r.ok).toBe(true)
    expect(r.hasReadme).toBe(true)
    expect(r.readmeText).toContain('npm test')
  })

  it('没有 README → 如实说没有，而不是崩或编一个', async () => {
    const { impl } = fakeFetch((url) =>
      url.includes('/readme')
        ? { status: 404, body: { message: 'Not Found' } }
        : { status: 200, body: { full_name: 'a/b', default_branch: 'main' } },
    )
    const r = await fetchRepoFacts('a', 'b', { fetchImpl: impl })
    expect(r.ok).toBe(true)
    expect(r.hasReadme).toBe(false)
  })

  it('403 / 限流要说成「无法确认」，不能变成「这仓库没测试」', async () => {
    const { impl } = fakeFetch(() => ({ status: 403, body: { message: 'rate limited' } }))
    const r = await fetchRepoFacts('a', 'b', { fetchImpl: impl })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/限流|403|无法确认/)
    expect(r.readmeText ?? '').toBe('')
  })

  it('仓库不存在要说清是找不到，而不是用户做得不好', async () => {
    const { impl } = fakeFetch(() => ({ status: 404, body: { message: 'Not Found' } }))
    const r = await fetchRepoFacts('a', 'ghost', { fetchImpl: impl })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/找不到|不存在|私有/)
  })
})

describe('对着任务包验收', () => {
  const pack = buildTaskPack({ direction: 'RAG', level: '入门' }, PROFILE)

  it('README 没写怎么跑起来 → 明确指出缺口', () => {
    const r = checkPackAcceptance(pack, { hasReadme: true, readmeText: '# 项目\n\n随便写点什么，没有命令' })
    expect(r.verdict).toBe('gaps')
    expect(r.gaps.map((g: any) => g.field).join('、')).toMatch(/运行/)
  })

  it('只读接口看不到测试条数 → 归入「要你本地核对」，不许假装判过', () => {
    const r = checkPackAcceptance(pack, {
      hasReadme: true,
      readmeText: '# 项目\n\n## 安装\npip install -r requirements.txt\n\n## 运行\npytest\n\n## 为什么这样设计\n因为要可复现',
    })
    expect(JSON.stringify(r.manual)).toMatch(/测试条数/)
    expect(r.manual.some((m: any) => /跑一次|本地/.test(m.detail))).toBe(true)
    // manual 不是 gap：不能因为 API 看不到就判用户没做
    expect(r.gaps.map((g: any) => g.field)).not.toContain('测试条数')
  })

  it('README 齐了、也有测试命令 → 通过项要列出来，不能只报缺', () => {
    const r = checkPackAcceptance(pack, {
      hasReadme: true,
      readmeText: '# 项目\n\n## 安装\npip install -r requirements.txt\n\n## 运行\npytest\n\n## 为什么这样设计\n因为要可复现',
    })
    expect(r.passed.length).toBeGreaterThan(0)
    expect(r.gaps.filter((g: any) => g.field === '运行说明')).toHaveLength(0)
  })

  it('完全查不到东西时不判「不合格」，判「无法确认」', () => {
    const r = checkPackAcceptance(pack, { hasReadme: false, readmeText: '', unreachable: true })
    expect(r.verdict).toBe('unknown')
    expect(r.gaps.length).toBeGreaterThan(0)
    expect(JSON.stringify(r)).toMatch(/无法确认/)
  })

  it('验收结论里不出现替用户断言个人短板的话', () => {
    const r = checkPackAcceptance(pack, { hasReadme: false, readmeText: '' })
    const text = JSON.stringify(r)
    for (const banned of ['不会', '没学过', '太弱', '基础差']) {
      expect(text, `验收结论出现了自我设限表述：${banned}`).not.toContain(banned)
    }
  })
})
