/**
 * 智能体工具注册表的断言（AGENT_PLAN 第二步 §3.2）。
 *
 * description 质量 = agent 成败的一半：模型全靠它选工具，所以「有名字没说明」
 * 这种注册表在这里必须直接红。写成 .mjs 是因为要用 node:fs 验证
 * 「每个工具指向的源文件真的存在」——这类检查只要文件被改名/删除，
 * 注册表就会安静地指向空气。
 *
 * 纪律：先红后实现。当前 ../agentTools 还不存在，本文件应当整体红在「模块找不到」。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const LIB = path.resolve(here, '..')

const { AGENT_TOOLS, emptyContext } = await import('../agentTools')

/** 巡检至少要能回答这几件事；少一个就是智能体看不见那一块数据 */
const REQUIRED = [
  'followupDue',
  'staleApplications',
  'funnelStats',
  'calibration',
  'todayPicks',
  'paceStatus',
  'keywordCoverage',
  'interviewFactGate',
  // 第三步「投递决策」要的两件事：本地硬门槛 + 同一家公司的历史对照
  'prefilterJob',
  'companyHistory',
]

describe('注册表结构', () => {
  it('工具名与条数构成双射（重名会让模型选到错的那个）', () => {
    const names = AGENT_TOOLS.map((t) => t.name)
    expect(new Set(names).size, `工具名有重复：${names.join('、')}`).toBe(names.length)
    expect(names.length).toBeGreaterThanOrEqual(REQUIRED.length)
  })

  it('REQUIRED 里列的巡检维度一个都不能少', () => {
    const names = new Set(AGENT_TOOLS.map((t) => t.name))
    const missing = REQUIRED.filter((n) => !names.has(n))
    expect(missing, `这些维度没有对应工具，智能体看不见：${missing.join('、')}`).toEqual([])
  })

  it('每个工具都带模型看得懂的说明与参数描述', () => {
    const bad = AGENT_TOOLS.filter(
      (t) =>
        typeof t.fn !== 'function' ||
        typeof t.name !== 'string' ||
        !t.description ||
        // 「查跟进」这种 4 个字的选择器说明，模型无从判断何时该用它
        String(t.description).length < 15 ||
        typeof t.schema !== 'string' ||
        !t.schema.trim(),
    ).map((t) => t.name)
    expect(bad, `这些工具缺说明/参数描述/不是函数：${bad.join('、')}`).toEqual([])
  })

  it('每个工具都指向 src/lib 下真实存在的模块（防止注册表指向空气）', () => {
    const libFiles = readdirSync(LIB).filter((f) => f.endsWith('.ts'))
    const broken = AGENT_TOOLS.filter((t) => !libFiles.includes(`${t.implementedIn}.ts`)).map((t) => t.name)
    expect(broken, `这些工具声称的源模块不存在：${broken.join('、')}`).toEqual([])
  })

  it('implementedIn 指向的模块里真的有同名导出（说明不是编的）', () => {
    const missing = AGENT_TOOLS.filter((t) => {
      const source = readFileSync(path.join(LIB, `${t.implementedIn}.ts`), 'utf8')
      return !new RegExp(`export (async )?function ${t.name}\\b`).test(source)
    }).map((t) => `${t.name} -> ${t.implementedIn}.ts`)
    expect(missing, `这些工具声称的实现函数在源文件里找不到：${missing.join('、')}`).toEqual([])
  })
})

describe('工具执行结果的形状', () => {
  it('空库也要能跑：每个工具在空上下文下返回可序列化结果，不抛错', () => {
    const ctx = emptyContext()
    const failed = []
    for (const t of AGENT_TOOLS) {
      try {
        const out = t.fn(ctx, {})
        // observation 要拼进 prompt，不可 JSON 序列化（Map/循环引用）会让循环崩在下一圈
        JSON.stringify(out)
      } catch (e) {
        failed.push(`${t.name}: ${String(e).slice(0, 60)}`)
      }
    }
    expect(failed, `这些工具在空数据上炸了：${failed.join('　')}`).toEqual([])
  })

  it('缺参数时返回错误文本而不是抛异常（错误要能被模型看见并改路）', () => {
    const ctx = emptyContext()
    const kw = AGENT_TOOLS.find((t) => t.name === 'keywordCoverage')
    const out = kw.fn(ctx, {})
    expect(out).toMatchObject({ error: expect.any(String) })
  })

  it('大结果必须被裁剪：observation 直接进 prompt，不裁就是每圈多烧几千 token', () => {
    const ctx = emptyContext()
    // 造 400 条投递 + 400 条沟通，看工具会不会把整坨倒给模型
    ctx.applications = Array.from({ length: 400 }, (_, i) => ({
      id: i + 1,
      stage: 'applied',
      company: `厂${i}`,
      title: '后端实习',
      applied_at: '2026-09-01',
    }))
    ctx.messages = Array.from({ length: 400 }, (_, i) => ({
      id: i + 1,
      application_id: i + 1,
      direction: 'out',
      reply_status: 'sent',
      sent_at: '2026-09-01T10:00:00',
    }))
    ctx.today = '2026-09-26'

    for (const t of AGENT_TOOLS) {
      const out = JSON.stringify(t.fn(ctx, {})) ?? ''
      expect(
        out.length,
        `${t.name} 一次吐了 ${out.length} 字：observation 要拼进 prompt，必须有裁剪上限`,
      ).toBeLessThan(4000)
    }
  })

  it('裁剪时如实标出还有多少没显示（不能让用户以为那就是全部）', () => {
    const ctx = emptyContext()
    ctx.applications = Array.from({ length: 400 }, (_, i) => ({
      id: i + 1,
      stage: 'applied',
      company: `厂${i}`,
      applied_at: '2026-09-01',
    }))
    ctx.messages = []
    ctx.today = '2026-09-26'
    const out = AGENT_TOOLS.find((t) => t.name === 'followupDue').fn(ctx, {})
    expect(out).toMatchObject({ truncated: true })
    expect(Number(out.hidden)).toBeGreaterThan(0)
  })

  it('口径体检把「数字与简历对不上」的项透传给模型，通过项不占 prompt', () => {
    const ctx = emptyContext()
    // 一条数字与画像口径一致（应被过滤掉），一条对不上（必须出现）
    ctx.profile = { resume_summary: '项目里写了 120 条测试', self_intro: '' }
    ctx.interviews = [
      { id: 1, questions: '我讲了 120 条测试', reflection: '' },
      { id: 2, questions: '我讲了 999 条测试', reflection: '' },
    ]
    const out = AGENT_TOOLS.find((t) => t.name === 'interviewFactGate').fn(ctx, {})
    expect(out.items.every((i) => String(i.quote).includes('999')), `通过项也混进来了：${JSON.stringify(out.items)}`).toBe(true)
    expect(out.items.length).toBeGreaterThan(0)
  })
})

describe('focus：正在被评估的那个岗位是上下文，不是模型的记忆任务', () => {
  it('args 没给 jd 时回落到 ctx.focus（模型手抄一遍 JD 必然抄错、抄漏）', () => {
    const ctx = emptyContext({
      // 硬门槛是**相对画像**判的：没有 grad_year 就判不出「仅限 2027 届」挡人
      profile: { full_name: '杨同学', grade: '2028届', grad_year: '2028', major: '计算机', resume_summary: '做过 React + TypeScript 前端与 Node 服务端，写过 Vitest 单测' },
      focus: { jd: '岗位职责：后端开发。硬性要求：仅限 2027 届毕业生', title: '后端实习', company: '某厂' },
    })
    const pf = AGENT_TOOLS.find((t) => t.name === 'prefilterJob')
    const out = pf.fn(ctx, {})
    expect(out.error, 'prefilterJob 没能用上 ctx.focus.jd').toBeUndefined()
    // 命中硬门槛必须挡下来，这正是省额度那一道的价值
    expect(out.pass).toBe(false)
    expect(out.hard.total).toBeGreaterThan(0)

    const kw = AGENT_TOOLS.find((t) => t.name === 'keywordCoverage')
    const kwOut = kw.fn(ctx, {})
    expect(kwOut.error, 'keywordCoverage 没能用上 ctx.focus.jd').toBeUndefined()
    expect(kwOut.total).toBeGreaterThan(0)

    const ch = AGENT_TOOLS.find((t) => t.name === 'companyHistory')
    const chOut = ch.fn(ctx, {})
    expect(chOut.company).toBe('某厂')
  })

  it('args 显式给了就用 args（同一轮里比多个岗位时不能被 focus 绑死）', () => {
    const ctx = emptyContext({ focus: { jd: ' focus 里的 JD', company: 'A厂' } })
    const ch = AGENT_TOOLS.find((t) => t.name === 'companyHistory')
    expect(ch.fn(ctx, { company: 'B厂' }).company).toBe('B厂')
  })

  it('没有 focus 也没 args：照旧返回错误文本而不是崩', () => {
    const pf = AGENT_TOOLS.find((t) => t.name === 'prefilterJob')
    expect(pf.fn(emptyContext(), {})).toMatchObject({ error: expect.any(String) })
  })
})

describe('description 是给模型看的选择器', () => {
  it('说明里带上「什么时候该用我」，否则模型只会挑第一个', () => {
    const vague = AGENT_TOOLS.filter((t) => !/(当|需要|想|问|看)/.test(t.description)).map((t) => t.name)
    expect(vague, `这些工具的说明没写何时使用：${vague.join('、')}`).toEqual([])
  })

  it('注册表能拼成一段完整的工具说明文本（含参数 schema）', async () => {
    const { renderToolCatalog } = await import('../agentTools')
    const text = renderToolCatalog(AGENT_TOOLS)
    for (const t of AGENT_TOOLS) {
      expect(text).toContain(t.name)
      expect(text).toContain(t.description)
    }
    expect(existsSync(path.join(LIB, 'agentTools.ts'))).toBe(true)
  })
})
