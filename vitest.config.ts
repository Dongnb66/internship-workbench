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
    include: ['src/**/*.test.ts', 'crawler/**/*.test.mjs', 'gateway/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts'],
    },
  },
})
