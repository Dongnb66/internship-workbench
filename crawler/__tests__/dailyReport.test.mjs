import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { writeOutput } from '../run.mjs'

/**
 * 写产出与岗位日报。
 *
 * 这个文件存在的前提是 `run.mjs` **能被 import 而不执行 CLI**：之前它底部是无条件
 * `main()`，一 import 就打印帮助并 `process.exit(0)`，测试进程当场被干掉
 * （表现是"测试全过但退出码 1"，非常像测试在骗人）。所以这里的断言顺便就是那条入口守卫的回归。
 *
 * 钉住的真实缺陷（2026-09-27 第一次真跑翻出来的）：`writeOutput` 里用了没传给它的 `log`
 * → 岗位抓到、JSON 写完，最后一步 ReferenceError，**日报不写**，
 * 症状是"跑了却没日报"，很容易被当成"今天什么都没抓到"。
 */

function fakeJobs(n) {
  return Array.from({ length: n }, (_, i) => ({
    company: `公司${i}`,
    title: `大模型应用实习${i}`,
    city: '北京',
    salary: '',
    url: `https://example.com/intern/${i}`,
    deadline: '',
    raw: '原文',
  }))
}

function result(n) {
  return [
    {
      siteId: 'shixiseng',
      label: '实习僧',
      channel: '实习僧',
      kw: 'Agent',
      pageUrl: 'https://www.shixiseng.com/interns?keyword=Agent',
      pageTitle: '实习僧',
      jobs: fakeJobs(n),
    },
  ]
}

describe('写产出与岗位日报', () => {
  it('import 这个模块不会把 CLI 跑一遍（没 exit、没打印帮助）', async () => {
    // 断言的形式：能走到这里、且模块导出的是函数，就说明入口守卫生效了
    expect(typeof writeOutput).toBe('function')
  })

  it('有岗位时不抛错，并把日报写出来、报告路径与条数', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wb-crawl-'))
    try {
      const lines = []
      const written = await writeOutput(result(3), { out: dir }, (msg) => lines.push(String(msg)))
      expect(written.length).toBe(1)
      expect(written[0].count).toBe(3)

      const files = await readdir(dir)
      const daily = files.filter((f) => f.startsWith('daily-') && f.endsWith('.md'))
      expect(daily.length, `目录里没有日报：${files.join('、')}`).toBe(1)
      const text = await readFile(path.join(dir, daily[0]), 'utf8')
      expect(text).toMatch(/大模型应用实习/)
      expect(text).toMatch(/新增 3 条/)

      // 崩溃的那一行：修之前这里是 `log is not defined`
      expect(lines.join('\n')).toMatch(/岗位日报已写/)
      expect(lines.join('\n')).toMatch(/3 条/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('一条岗位都没有时也不抛错，日报仍然落盘（被风控停掉的轮次要能收尾）', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wb-crawl-'))
    try {
      const written = await writeOutput(
        [{ siteId: 'boss', label: 'BOSS直聘', channel: 'BOSS直聘', jobs: [], stoppedLabel: '验证码墙' }],
        { out: dir },
        () => {},
      )
      expect(written).toEqual([])
      const files = await readdir(dir)
      expect(files.some((f) => /^daily-.*\.md$/.test(f)), `没有日报：${files.join('、')}`).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('不传 log 也不炸（安静模式是可选参数，不是必填）', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wb-crawl-'))
    try {
      await expect(writeOutput(result(1), { out: dir })).resolves.length(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
