#!/usr/bin/env node
/**
 * 抓取器自检：用真浏览器（本机 Edge）跑本地夹具页，断言字段全部读对。
 *
 * 为什么用夹具而不是真实站点：
 * - 招聘站点改版、封 IP、要求登录，任何一条都能让「对着真站点跑」的测试变成随机红；
 * - 夹具能钉住**契约**（列表页读法、详情页读法、字段落点），这才是回归测试该管的东西。
 * 真实站点上的表现只能靠真跑一次 —— 见 README 的「第一次跑怎么确认」。
 *
 * 跑法：cd crawler && npm run selftest
 * 注意：夹具里的 <script src="../collector.js"> 是 file:// 跨文件加载，需要放开文件访问权限。
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { COLLECTOR, launchBrowser, msgOf } from './lib/browser.mjs'

const FIXTURES = path.join(import.meta.dirname, '..', 'extension', '__fixtures__')

const LIST_EXPECTED = [
  { title: 'AI Agent 应用开发实习生', salary: '200-300元/天', city: '广州', company: '示例·星野智能科技', url: 'https://example.com/job_detail/1000.html' },
  { title: 'Python 后端开发实习生', salary: '180-250元/天', city: '深圳', company: '示例·云图数据有限公司', url: 'https://example.com/job_detail/1001.html' },
  { title: '数据工程实习生', salary: '150-200元/天', city: '远程', company: '示例·拓维教育科技', url: 'https://example.com/job_detail/1002.html' },
  { title: '算法实习生（LLM 方向）', salary: '250-400元/天', city: '北京', company: '示例·智源研究院', url: 'https://example.com/job_detail/1003.html' },
  { title: '前端开发实习生', salary: '150-220元/天', city: '广州', company: '示例·矩石网络科技', url: 'https://example.com/job_detail/1004.html' },
  { title: '测试开发实习生', salary: '面议', city: '杭州', company: '示例·明渡信息技术', url: 'https://example.com/job_detail/1005.html' },
]

const DETAIL_EXPECTED = {
  title: 'AI Agent 应用开发实习生',
  company: '示例·星野智能科技',
  city: '广州',
  salary: '200-300元/天',
}

let failures = 0
const results = []

function check(name, actual, expected) {
  const ok = actual === expected
  if (!ok) failures += 1
  results.push(`${ok ? '✓' : '✗'} ${name}：${ok ? JSON.stringify(actual) : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`}`)
}

async function collect(page, options) {
  await page.addScriptTag({ content: await readFile(COLLECTOR, 'utf8') })
  // 夹具会把自己的采集结果打印成 <pre id="iwb-out"> 挂在 body 末尾。
  // 量之前得先把这把尺子拿掉：否则「退到整页」那条分支读到的会是
  // 一份包含了 JD 的 JSON，断言看着过了，其实测的是自己上一次的输出。
  await page.evaluate(() => document.getElementById('iwb-out')?.remove())
  return await page.evaluate(
    (opts) => (typeof window.__iwbCollectJobs === 'function' ? window.__iwbCollectJobs(opts) : null),
    options,
  )
}

async function main() {
  const profileDir = await mkdtemp(path.join(tmpdir(), 'iwb-selftest-'))
  const { context, label } = await launchBrowser({
    headless: true,
    profileDir,
    args: ['--allow-file-access-from-files'],
  })
  console.log(`浏览器：${label}\n`)

  try {
    const page = await context.newPage()

    // ① 列表页：6 张重复卡片，字段必须逐条对上
    const listUrl = pathToFileURL(path.join(FIXTURES, 'mock-job-list.html')).href
    await page.goto(listUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(300)
    const list = await collect(page, { mode: 'list' })
    check('列表页条数', list?.count, 6)
    const jobs = list?.jobs ?? []
    LIST_EXPECTED.forEach((want, i) => {
      const got = jobs[i] ?? {}
      for (const key of ['title', 'salary', 'city', 'company', 'url']) {
        check(`列表第 ${i + 1} 条 ${key}`, got[key], want[key])
      }
      if (!String(got.raw ?? '').length) {
        failures += 1
        results.push(`✗ 列表第 ${i + 1} 条 raw：为空，JD 正文没读到`)
      }
    })

    // ② 详情页：强制 detail 模式（详情页底部常挂推荐位，自动模式会误判成列表）
    const detailUrl = pathToFileURL(path.join(FIXTURES, 'mock-job-detail.html')).href
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(300)
    const detail = await collect(page, { mode: 'detail' })
    check('详情页条数', detail?.count, 1)
    const one = detail?.jobs?.[0] ?? {}
    for (const [key, want] of Object.entries(DETAIL_EXPECTED)) check(`详情页 ${key}`, one[key], want)
    check('详情页 raw 收进了正文', String(one.raw ?? '').includes('LangGraph'), true)
    check('详情页 raw 没把导航收进来', String(one.raw ?? '').includes('相关推荐'), false)

    // ③ 详情页在自动模式下也应该退化成 1 条（兜底分支不能坏）
    const auto = await collect(page, {})
    check('详情页自动模式条数', auto?.count, 1)

    // ④ 陷阱页：合规容器（main）只有 19 个字，正文挂在不认识的 class 上。
    //    真实症状是「补全 0 条 JD」且不报错 —— 所以这里必须断言拿到了正文。
    const trapUrl = pathToFileURL(path.join(FIXTURES, 'mock-job-detail-trap.html')).href
    await page.goto(trapUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(300)
    const trap = await collect(page, { mode: 'detail' })
    const trapOne = trap?.jobs?.[0] ?? {}
    const trapRaw = String(trapOne.raw ?? '')
    check('陷阱页条数', trap?.count, 1)
    check('陷阱页 raw 收进了正文', trapRaw.includes('LangGraph'), true)
    check('陷阱页 raw 没停在面包屑', trapRaw.length > 200, true)
    check('陷阱页 city', trapOne.city, '北京')
    check('陷阱页 salary', trapOne.salary, '300-400元/天')

    // ⑤ 多容器页：合规容器有两个，排前面的是短占位块。
    //    「取最长」才对：命中即停会读到 SHORTBLOCK，退到整页会读到推荐位。
    const multiUrl = pathToFileURL(path.join(FIXTURES, 'mock-job-detail-multi.html')).href
    await page.goto(multiUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(300)
    const multi = await collect(page, { mode: 'detail' })
    const multiOne = multi?.jobs?.[0] ?? {}
    const multiRaw = String(multiOne.raw ?? '')
    check('多容器页条数', multi?.count, 1)
    check('多容器页 raw 取的是最长容器（含正文）', multiRaw.includes('LangGraph'), true)
    check('多容器页 raw 没停在第一个容器', multiRaw.includes('SHORTBLOCK'), false)
    check('多容器页 raw 没退到整页（无推荐位）', multiRaw.includes('相关推荐'), false)
    check('多容器页 city', multiOne.city, '上海')
    check('多容器页 salary', multiOne.salary, '250-350元/天')
  } finally {
    await context.close()
    await rm(profileDir, { recursive: true, force: true }).catch(() => {})
  }

  console.log(results.join('\n'))
  console.log(`\n${failures ? `✗ ${failures} 项不通过` : '✓ 全部通过'}`)
  return failures ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`自检异常退出：${msgOf(error)}`)
    process.exit(2)
  })
