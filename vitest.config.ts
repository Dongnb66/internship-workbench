import { defineConfig } from 'vitest/config'

/**
 * 单测覆盖两处纯函数：
 * - src/lib            前端逻辑，跑在 node 环境，不需要 jsdom
 * - crawler            本地抓取器的纯逻辑（.mjs，故意不引浏览器 API）
 * 两者都刻意与运行环境解耦，所以能脱离浏览器直接断言。
 *
 * 需要真浏览器的那部分不进 vitest（CI 上不一定有 Edge）：见 crawler/selftest.mjs。
 * crawler/__tests__/contract.test.mjs 是抓取器与前端的接口契约，必须一直绿。
 */
export default defineConfig({
  test: {
    environment: 'node',
    // 默认 5 秒对本仓库偏紧：有 7 处断言会**走整棵源树**做源码推导
    // （profileTemplate / byoHygiene / rlsGuards / aiPromptCoverage / aiQuotaCoverage / agentTools / channelCapability），
    // 并行负载下它们会越过 5s，出现「看着像真失败」的假红 —— 2026-10-03/04 实测过一次。
    // 给 20s 留 4 倍余量；真正卡死的用例仍会失败，只是晚一点。
    testTimeout: 20_000,
    include: [
      'src/**/*.test.ts',
      // 需要在 node 里读文件/做源码推导的检查写成 .mjs：app 的 tsconfig 只给 DOM 类型，
      // 用 node:fs 会编译失败；而 tsc 不检查 .mjs，正好两不相扰
      'src/**/*.test.mjs',
      // 构建期脚本（往产物里注版本标记这类）也要能单测：它的坏法是"静默不生效"，
      // 只能靠断言抓，靠肉眼看 dist 迟早漏
      'scripts/**/*.test.mjs',
      'crawler/**/*.test.mjs',
      'gateway/**/*.test.mjs',
      'extension/**/*.test.mjs',
      // 小程序端的纯逻辑（计费门这类）也跑在 node 里：不依赖 wx 运行时的那部分才能被断言到。
      // 之前这一条不在清单里，等于小程序的测试根本不会被执行——写它的人以为它在跑。
      'miniprogram/**/*.test.mjs',
    ],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts'],
    },
  },
})
