import { describe, expect, it } from 'vitest'

/**
 * 项目教练（任务包生成器）的断言（AGENT_PLAN 第四步）。
 *
 * 定位是**教练不是代做**：它产出「可直接粘给任意智能体的完整指令 + 验收标准」，
 * 代码由用户派活给智能体、自己 review、自己跑通、自己讲清。
 * 所以断言盯的不是「计划写得漂亮」，而是几条会让这件事在面试里穿帮的硬要求：
 * 每步都必须带可核对的验收、都必须要求用户能独立讲清、都不能出现代做口吻。
 *
 * 纪律：本文件先红在 `../mentor` 不存在。
 */
import { buildTaskPack, renderTaskPack, WEEKS_DEFAULT } from '../mentor'

import type { Profile } from "../../types"

const PROFILE: Profile = {
  full_name: '杨同学',
  grade: '2028届',
  major: '计算机',
  skills: ['TypeScript', 'React', 'Node'],
  resume_summary: '做过 5 个项目，写过 508 条测试',
}

describe('任务包结构', () => {
  it('默认四周，每周至少一步，步骤连续编号', () => {
    const pack = buildTaskPack({ direction: 'RAG', level: '入门' }, PROFILE)
    expect(pack.weeks).toBe(WEEKS_DEFAULT)
    expect(pack.steps.length).toBeGreaterThanOrEqual(WEEKS_DEFAULT)
    // 每一周都得有事做，否则「四周计划」是空的
    const weeks = new Set(pack.steps.map((s: { week: number }) => s.week))
    expect([...weeks].sort()).toEqual(Array.from({ length: WEEKS_DEFAULT }, (_, i) => i + 1))
    const nums = pack.steps.map((s: { index: number }) => s.index)
    expect(nums).toEqual(nums.map((n: number, i: number) => i + 1))
  })

  it('每一步都带三样东西：可粘贴指令、可核对验收、必须能讲清的点', () => {
    const pack = buildTaskPack({ direction: 'Agent', level: '进阶' }, PROFILE)
    const missing = pack.steps
      .filter(
        (s: any) =>
          !s.instruction || String(s.instruction).length < 60 ||
          !s.acceptance?.minTests || !s.acceptance?.readmeRequired ||
          !Array.isArray(s.acceptance?.mustExplain) || !s.acceptance.mustExplain.length,
      )
      .map((s: any) => s.index)
    expect(missing, `这些步骤缺指令或验收标准：${missing.join('、')}`).toEqual([])
  })

  it('验收里的测试下限至少 1 条且逐步变严（第一步和最后一步不该同标准）', () => {
    const pack = buildTaskPack({ direction: 'RAG', level: '入门' }, PROFILE)
    const floors = pack.steps.map((s: any) => s.acceptance.minTests)
    expect(floors[0]).toBeGreaterThanOrEqual(1)
    expect(floors[floors.length - 1]).toBeGreaterThan(floors[0])
  })

  it('README 验收写清「怎么跑起来」与「为什么这样设计」——面试官只会问这两件', () => {
    const pack = buildTaskPack({ direction: 'RAG', level: '入门' }, PROFILE)
    for (const s of pack.steps as any[]) {
      const text = JSON.stringify(s.acceptance.readmeRequired)
      expect(text).toMatch(/运行|安装|启动/)
      expect(text).toMatch(/为什么|取舍|设计/)
    }
  })
})

describe('教练口吻：不替用户做作业', () => {
  it('每步指令都要求用户自己跑通并讲清，而不是「复制即可交差」', () => {
    const pack = buildTaskPack({ direction: 'Agent', level: '入门' }, PROFILE)
    const bad = (pack.steps as any[]).filter((s) => !/你必须|必须由你|自己跑通|逐条讲清|亲自/.test(s.instruction)).map((s) => s.index)
    expect(bad, `这些步骤没有把「用户必须参与」写进指令：${bad.join('、')}`).toEqual([])
  })

  it('绝不出现代做口吻（直接帮你写完 / 无需理解 / 原样提交）', () => {
    const pack = buildTaskPack({ direction: 'RAG', level: '入门' }, PROFILE)
    const text = JSON.stringify(pack)
    for (const banned of ['帮你写完', '无需理解', '原样提交', '不用看懂', '直接交差']) {
      expect(text, `任务包里出现了代做口吻：${banned}`).not.toContain(banned)
    }
  })

  it('指令是给外部智能体看的：包含目标、约束、验收，缺一不可', () => {
    const pack = buildTaskPack({ direction: 'RAG', level: '入门' }, PROFILE)
    for (const s of pack.steps as any[]) {
      expect(s.instruction).toContain('目标')
      expect(s.instruction).toContain('约束')
      expect(s.instruction).toContain('验收')
    }
  })
})

describe('输入决定产出', () => {
  it('方向决定技术词：RAG 出现检索/评测，Agent 出现工具调用/循环', () => {
    const rag = JSON.stringify(buildTaskPack({ direction: 'RAG', level: '入门' }, PROFILE))
    const agent = JSON.stringify(buildTaskPack({ direction: '智能体', level: '入门' }, PROFILE))
    expect(rag).toMatch(/检索|召回|向量/)
    expect(rag).toMatch(/评测|指标/)
    expect(agent).toMatch(/工具|函数调用/)
    expect(agent).toMatch(/循环|步数/)
  })

  it('零基础的第一步是「跑通环境 + 讲清一件最小事实」，而不是直接上架构', () => {
    const pack = buildTaskPack({ direction: 'RAG', level: '零基础' }, PROFILE)
    const first = (pack.steps as any[])[0]
    expect(first.instruction).toMatch(/跑通|装|最小/)
    expect(first.title).not.toMatch(/架构|分布式/)
  })

  it('进阶的第一步要有设计取舍，不再从装环境开始', () => {
    const pack = buildTaskPack({ direction: 'RAG', level: '进阶' }, PROFILE)
    const first = (pack.steps as any[])[0]
    expect(first.instruction).toMatch(/取舍|对比|为什么/)
  })

  it('每步的「技术抓手」用的是这个方向的套路，不是通用套话', () => {
    const grip = (pack: any) => pack.steps.map((s: any) => /【技术抓手】(.+)/.exec(s.instruction)?.[1] ?? '').join('　')
    const rag = grip(buildTaskPack({ direction: 'RAG', level: '入门' }, PROFILE))
    expect(rag, `RAG 方向的技术抓手退化成通用套话：${rag}`).toMatch(/向量化|检索召回|重排/)
    const general = grip(buildTaskPack({ direction: '考古学', level: '入门' }, PROFILE))
    expect(general).not.toMatch(/向量化|重排/)
  })

  it('认不出的方向不硬编：按通用工程走，并在产出里说清这是通用档', () => {
    const pack = buildTaskPack({ direction: '考古学', level: '入门' }, PROFILE)
    expect(pack.fallback).toBe(true)
    expect(pack.note).toMatch(/通用/)
    // 但仍然给出可执行的技术抓手，不给空话
    expect(JSON.stringify(pack)).toMatch(/测试|README/)
  })

  it('画像里的技能会被引用，不会凭空冒出用户没写过的技术栈', () => {
    const pack = buildTaskPack({ direction: 'RAG', level: '入门' }, { ...PROFILE, skills: ['Python'] })
    const text = JSON.stringify(pack)
    expect(text).toContain('Python')
    expect(text).not.toContain('Java Spring')
  })
})

describe('隐私与口径红线（AGENTS §2.2）', () => {
  it('不出现学校名称，也不替用户断言个人短板', () => {
    const pack = buildTaskPack({ direction: 'RAG', level: '入门' }, { ...PROFILE, school: '某大学' })
    const text = JSON.stringify(pack)
    expect(text).not.toContain('某大学')
    for (const banned of ['没学过', '不会', '基础差', '短板是', '学历不']) {
      expect(text, `任务包里出现了自我设限表述：${banned}`).not.toContain(banned)
    }
  })

  it('引用简历口径时带着「数字必须与简历一致」的提醒', () => {
    const pack = buildTaskPack({ direction: 'Agent', level: '入门' }, PROFILE)
    expect(JSON.stringify(pack)).toMatch(/与简历.*一致|口径/)
  })
})

describe('可交付形态', () => {
  it('任务包能整体序列化成 JSON（要存进个人知识库，零迁移）', () => {
    const pack = buildTaskPack({ direction: 'RAG', level: '入门' }, PROFILE)
    const round = JSON.parse(JSON.stringify(pack))
    expect(round.steps.length).toBe((pack.steps as any[]).length)
  })

  it('renderTaskPack 产出一段可直接粘贴的 Markdown，含每步编号与验收清单', () => {
    const pack = buildTaskPack({ direction: 'RAG', level: '入门' }, PROFILE)
    const md = renderTaskPack(pack)
    expect(md).toContain('# 项目任务包')
    for (const s of pack.steps as any[]) {
      expect(md).toContain(`第 ${s.index} 步`)
      expect(md).toContain('- [ ]')
    }
    // 复制出去就能用：末尾必须提醒「派活前把技能与口径改成自己的」
    expect(md).toMatch(/改成你自己|按你的实际/)
  })
})
