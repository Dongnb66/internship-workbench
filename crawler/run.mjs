#!/usr/bin/env node
/**
 * 本地岗位抓取器。
 *
 * 它做的事，一句话：**在你自己的电脑上开一个浏览器，按站点列表逐个打开招聘页，
 * 把页面上已经渲染出来的岗位卡片读出来，翻页，再把岗位链接逐个打开补全 JD，
 * 最后产出一份可以直接导入实习工作台的 JSON。**
 *
 * 和从云端爬的区别（这是它敢存在的前提）：
 * - 跑在你自己的机器上，用的是你自己的网络出口和你自己的登录态；
 * - 只读「你在浏览器里能看见的那个 DOM」，不调接口、不解密参数、不绕验证码；
 * - 严格串行 + 每次请求之间强制等待，默认不并发，不扫全站；
 * - 需要登录的站点（如 BOSS）由你手动登录一次，抓取器只复用那个会话，不碰账号密码。
 *
 * 提取算法不在这个文件里 —— 它和浏览器扩展共用 extension/collector.js，
 * 所以「扩展手动点一次」和「抓取器自动跑一遍」读出来的字段完全一致。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { MORE_TEXTS, NEXT_TEXTS, SITES, STRATEGIES, companyFor, detectSiteByUrl, findSite } from './sites.mjs'
import { COLLECTOR, CRAWLER_DIR, OUT_DIR, PROFILE_DIR, launchBrowser, msgOf, politeDelay } from './lib/browser.mjs'
import { dailyReportMd, detectStopWall } from './lib/stopRules.mjs'
import { DEFAULT_ENGINE, computeExitCode, routeTargets, summarizeRun } from './lib/routing.mjs'
import { ENGINE_NAMES, SCRAPLING_PROFILE_DIR, installHint, resolvePython, runScrapling } from './lib/engineScrapling.mjs'
import {
  adoptDetail,
  dedupeKey,
  expandTemplate,
  hydrateReport,
  makePayload,
  mergeDetail,
  mergeJobs,
  parseArgs,
  safeFileName,
  screenJobs,
  stamp,
} from './lib/normalize.mjs'

function makeLog(quiet) {
  return (...args) => {
    if (!quiet) console.log(...args)
  }
}

// ---------------------------------------------------------------- 参数 → 任务

export function buildTargets(opts) {
  const targets = []
  const keywords = opts.keywords.length ? opts.keywords : ['']

  for (const id of opts.sites) {
    const site = findSite(id)
    if (!site) {
      targets.push({ error: `未知站点 id：${id}（用 --list-sites 看可用列表）` })
      continue
    }
    for (const kw of keywords) targets.push({ kind: 'site', site, kw, urls: [] })
  }

  for (const url of opts.urls) {
    const site = detectSiteByUrl(url) ?? findSite('generic')
    targets.push({ kind: 'url', site, kw: '', urls: [url] })
  }

  return targets
}

function targetLabel(target) {
  if (target.error) return target.error
  const suffix = target.kw ? ` · ${target.kw}` : ''
  return `${target.site.name}${suffix}`
}

function targetKey(target) {
  return `${target.site.id}__${target.kw || 'all'}`
}

function urlForPage(target, opts, index) {
  if (target.kind === 'url') return target.urls[index - 1] ?? ''
  if (!target.site.listUrl) return ''
  return expandTemplate(target.site.listUrl, { kw: target.kw, page: index })
}

// ---------------------------------------------------------------- 页面操作

async function injectCollector(page) {
  const source = await readFile(COLLECTOR, 'utf8')
  await page.addScriptTag({ content: source })
}

/** 采集一页。失败不抛出，交给调用方决定是跳过还是中止 */
async function collectPage(page, options) {
  try {
    await injectCollector(page)
    const result = await page.evaluate(
      (opts) => (typeof window.__iwbCollectJobs === 'function' ? window.__iwbCollectJobs(opts) : null),
      options,
    )
    return result
  } catch (error) {
    return { error: msgOf(error), jobs: [] }
  }
}

/** 等页面「看起来稳了」：先等固定时长，再等 DOM 规模不再变化，最多再等 6 秒 */
async function settle(page, baseWait) {
  await page.waitForTimeout(baseWait)
  try {
    await page.waitForLoadState('networkidle', { timeout: 6000 })
  } catch {
    /* SPA 长轮询站点永远不会 idle，超时是正常的 */
  }
  try {
    await page.waitForFunction(
      () => {
        const key = `${document.querySelectorAll('*').length}|${document.body.scrollHeight}`
        const w = window
        if (w.__iwbStableKey === key) return true
        w.__iwbStableKey = key
        return false
      },
      { timeout: 6000, polling: 700 },
    )
  } catch {
    /* 一直变也认了，总比卡死好 */
  }
}

/** 在页面里按文案找一个可点的元素并点掉 */
async function clickByText(page, texts) {
  const handle = await page.evaluateHandle((candidates) => {
    const norm = (s) => String(s || '').replace(/\s+/g, '')
    const clickable = (el) => {
      if (!el || el.disabled) return false
      if (el.getAttribute?.('aria-disabled') === 'true') return false
      const cls = String(el.className || '')
      if (/disabled|forbid|ban/i.test(cls)) return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], li, span, div'))
    for (const candidate of candidates) {
      const want = norm(candidate)
      if (!want) continue
      const exact = nodes.find((el) => norm(el.textContent) === want && clickable(el))
      if (exact) return exact
      const loose = nodes.find(
        (el) => norm(el.textContent).includes(want) && norm(el.textContent).length <= want.length + 4 && clickable(el),
      )
      if (loose) return loose
    }
    return null
  }, texts)

  const element = handle.asElement()
  if (!element) {
    await handle.dispose()
    return false
  }
  try {
    await element.scrollIntoViewIfNeeded({ timeout: 4000 })
    await element.click({ timeout: 5000 })
    return true
  } catch {
    return false
  } finally {
    await element.dispose().catch(() => {})
  }
}

async function scrollOnce(page) {
  return await page.evaluate(async () => {
    const before = document.body.scrollHeight
    window.scrollTo(0, document.body.scrollHeight)
    await new Promise((r) => setTimeout(r, 1200))
    return document.body.scrollHeight !== before
  })
}

/**
 * 尝试翻到下一页。返回 true 表示「页面确实前进了」。
 * auto = 下一页按钮 → 加载更多 → 滚到底，三种都试过才算失败。
 */
async function advance(page, target) {
  const strategy = STRATEGIES.includes(target.site.strategy) ? target.site.strategy : 'auto'
  const before = await page.evaluate(() => `${location.href}|${document.querySelectorAll('a[href]').length}`)

  const moved = async () => {
    const after = await page.evaluate(() => `${location.href}|${document.querySelectorAll('a[href]').length}`)
    return after !== before
  }

  if (strategy === 'none') return false

  if (strategy === 'auto' || strategy === 'next') {
    if (await clickByText(page, NEXT_TEXTS)) {
      await settle(page, 1400)
      if (await moved()) return true
    }
  }
  if (strategy === 'auto' || strategy === 'more') {
    if (await clickByText(page, MORE_TEXTS)) {
      await settle(page, 1400)
      if (await moved()) return true
    }
  }
  if (strategy === 'auto' || strategy === 'scroll') {
    for (let i = 0; i < 3; i += 1) {
      const grew = await scrollOnce(page)
      if (!grew) break
    }
    await settle(page, 1000)
    if (await moved()) return true
  }
  return false
}

// ---------------------------------------------------------------- 断点

async function readCheckpoint(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    return { keys: Array.isArray(parsed?.keys) ? parsed.keys : [], page: Number(parsed?.page) || 1 }
  } catch {
    return { keys: [], page: 1 }
  }
}

async function writeCheckpoint(file, data) {
  // 只留最近 5000 个键，文件不至于无限长；超出部分靠工作台自身的去重兜底
  const keys = (data.keys ?? []).slice(-5000)
  await writeFile(file, JSON.stringify({ ...data, keys }, null, 0), 'utf8')
}

// ---------------------------------------------------------------- 单站点主流程

async function crawlTarget({ context, target, opts, log }) {
  const label = targetLabel(target)
  const checkpointFile = path.join(OUT_DIR, `.seen-${safeFileName(targetKey(target))}.json`)
  const checkpoint = opts.purge ? { keys: [], page: 1 } : await readCheckpoint(checkpointFile)
  const seen = checkpoint.keys
  const startPage = opts.resume ? Math.max(1, checkpoint.page) : 1

  log(`\n▶ ${label}`)
  log(`  入口：${urlForPage(target, opts, 1) || '（无，请用 --url 指定）'}`)

  if (!urlForPage(target, opts, 1)) {
    return { label, ok: false, reason: '没有入口地址', jobs: [], errors: ['该站点需要 --url 指定具体地址'] }
  }
  if (target.site.needsLogin) {
    const loggedIn = await hasLoginCookie(context, target.site)
    if (!loggedIn) {
      log(`  ⚠ 这个站点需要登录态。先跑：node login.mjs --site ${target.site.id}`)
    } else {
      log('  ✓ 检测到已保存的登录态')
    }
  }

  const page = await context.newPage()
  const raw = []
  const errors = []
  let stoppedLabel = null
  let lastPage = startPage

  try {
  // --url 模式的页数语义是「第 N 个 URL」，上限必须取 URL 个数而不是 --pages
  //（默认 2）：否则 `--url a --url b --url c` 会静默跳过第 3 个
  const maxIndex = target.kind === 'url' ? target.urls.length : opts.pages
  for (let index = startPage; index <= maxIndex; index += 1) {
    const url = urlForPage(target, opts, index)
    if (target.kind === 'url' && index > target.urls.length) break

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
      } catch (error) {
        errors.push(`第 ${index} 页打开失败：${msgOf(error)}`)
        break
      }

      const wait = opts.wait || target.site.wait || 3000
      await settle(page, wait)

      // 安全停止清单（显式规则版）：验证码 / 登录墙 / 风控拦截，命中即停当前站点。
      // 这是「遇到就停，不尝试绕过」的代码约束版——规则本体在 lib/stopRules.mjs，契约测试钉着。
      const wallText = `${await page.title()} ${(await page.locator('body').textContent().catch(() => '')) ?? ''}`.slice(0, 6000)
      const wall = detectStopWall(wallText)
      if (wall.hit) {
        const reason = `第 ${index} 页命中安全停止清单（${wall.label}），按「遇到就停」纪律停止本站点——不重试、不绕过`
        errors.push(reason)
        stoppedLabel = wall.label
        log(`  ⛔ ${wall.label}：停止本站点。换个时间/登录态再跑，或换别的站点。`)
        break
      }

      // 抓不到东西时最有用的一步：把渲染后的 HTML 存下来，直接看页面到底长什么样
      if (opts.dump) {
        const dumpDir = path.join(OUT_DIR, 'dump')
        await mkdir(dumpDir, { recursive: true })
        const file = path.join(dumpDir, `${safeFileName(targetKey(target))}-p${index}.html`)
        await writeFile(file, await page.content(), 'utf8')
        log(`  已存渲染快照：${path.relative(process.cwd(), file)}`)
      }

      const result = await collectPage(page, { mode: 'list' })

      if (result?.error) {
        errors.push(`第 ${index} 页采集失败：${result.error}`)
      } else {
        const jobs = (result?.jobs ?? []).filter((j) => j && j.title)
        log(`  第 ${index} 页：读到 ${jobs.length} 条`)
        if (!jobs.length && index > startPage) break
        raw.push(...jobs)
      }

      lastPage = index
      await writeCheckpoint(checkpointFile, { site: targetKey(target), page: index + 1, keys: seen, updated_at: new Date().toISOString() })

      if (index >= opts.pages) break
      const advanced = await advance(page, target)
      if (!advanced) {
        log('  没有更多可翻的页了，停止')
        break
      }
      await politeDelay(opts.delay)
    }
  } finally {
    await page.close()
  }

  // 标题筛选必须在补 JD 之前 —— 补 JD 是最贵的一步
  const screened = screenJobs(raw, { mode: opts.mode, include: opts.include, exclude: opts.exclude })
  if (screened.filtered) {
    log(`  标题筛选挡掉 ${screened.filtered} 条（${screened.reasons.map(([r, n]) => `${r}×${n}`).join('、')}）`)
  }

  // 单一公司招聘板的页面里没有「公司」字段，用站点表补。
  // 必须在去重之前做：去重键含公司名，补晚了会算出一批假的「不重复」。
  //
  // ⚠️ 这里是「覆盖」而不是「填空」。原因：卡片的公司名启发式在单公司板上必然误判 ——
  // 页面上根本没有真正的公司名，它就只能在卡片里挑一个「像公司名」的短行，实测美团
  // 挑出的是「更新于2026/08/17」「核心本地商业-基础研发平台」。既然站点表已经确定知道
  // 这家招聘板属于哪家公司（BOARD_COMPANY，或用户 --company 显式指定），那就是**事实**，
  // 不该被一个猜测覆盖。多公司平台（BOSS / 实习僧 / Moka 托管页…）没有映射，
  // isBoardOverride 为假，仍走「页面读到就尊重页面」的原逻辑。
  const boardCompany = companyFor(target.site, opts.company)
  if (boardCompany) {
    const overridden = screened.kept.filter((j) => j.company && j.company !== boardCompany).length
    const missing = screened.kept.filter((j) => !j.company).length
    if (missing || overridden) {
      log(
        `  按站点表统一公司名为「${boardCompany}」（补空 ${missing} 条` +
          (overridden ? `、修正启发式误判 ${overridden} 条` : '') +
          '）',
      )
    }
    screened.kept = screened.kept.map((j) => ({ ...j, company: boardCompany }))
  }

  const deduped = mergeJobs(seen, screened.kept)
  if (deduped.dup) log(`  与历史产出重复 ${deduped.dup} 条，跳补 JD`)

  let jobs = deduped.fresh.slice(0, opts.limit)
  if (deduped.fresh.length > jobs.length) log(`  本次上限 ${opts.limit} 条，其余留到下次`)

  if (opts.detail > 0 && jobs.length) {
    const plan = Math.min(opts.detail, jobs.length)
    log(`  补 JD：逐个打开 ${plan} 个岗位详情页（约 ${Math.round((plan * (opts.delay * 0.6 + 2500)) / 1000)} 秒）`)
    jobs = await hydrate({ context, jobs, plan, opts, log })
  } else if (!opts.detail) {
    log('  跳过补 JD（--detail 0）：岗位会缺少 JD 正文，匹配分不准')
  }

  // ⚠️ checkpoint 只能写入**本次真正产出**的岗位键。被 --limit 切掉的那部分
  // 绝不能提前记进去——日志说「其余留到下次」，如果把全部 fresh 键都写进去，
  // 下一轮它们会被判为已见而永久跳过，用户根本无感知。
  const checkpointKeys = new Set(seen)
  for (const job of jobs) {
    const key = dedupeKey(job?.company, job?.title)
    if (key !== '||') checkpointKeys.add(key)
  }

  await writeCheckpoint(checkpointFile, {
    site: targetKey(target),
    page: lastPage + 1,
    keys: Array.from(checkpointKeys),
    updated_at: new Date().toISOString(),
  })

  return { label, ok: true, jobs, errors, filtered: screened.filtered, dup: deduped.dup, read: screened.kept.length, stoppedLabel }
}

/** 逐个打开岗位详情页，把列表页那点摘要换成完整 JD */
async function hydrate({ context, jobs, plan, opts, log }) {
  const page = await context.newPage()
  const filled = [...jobs]
  const refusals = []
  let adopted = 0
  try {
    for (let i = 0; i < plan; i += 1) {
      const job = filled[i]
      if (!job?.url || !/^https?:/i.test(job.url)) continue
      let first = null
      let failed = false
      try {
        await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 40000 })
        await settle(page, 1200)
        const detail = await collectPage(page, { mode: 'detail', maxJd: 12000 })
        first = (detail?.jobs ?? [])[0] ?? null
      } catch (error) {
        // 失败要照常走后面的进度与节流：出错的那一次同样访问了站点，
        // 跳过 politeDelay 等于把「连续两次点击」的间隔省掉了。
        failed = true
        log(`    ${i + 1}/${plan} 补 JD 失败：${msgOf(error)}`)
      }
      if (!failed) {
        // 判定与汇报都在 normalize 里（adoptDetail / hydrateReport），这里只管跑页面。
        // 以前是 here 一句 `detail.raw.length > job.raw.length` 的静默比较：
        // 详情页读砸了就用列表摘要，日志只说「补全 0 条 JD」，看不出来是站点没正文还是选择器坏了。
        const verdict = adoptDetail(job, first)
        if (verdict.adopt) {
          filled[i] = mergeDetail(job, first)
          adopted += 1
        } else {
          refusals.push({ at: i + 1, reason: verdict.reason })
        }
      }
      if ((i + 1) % 5 === 0 || i + 1 === plan) log(`    进度 ${i + 1}/${plan}`)
      await politeDelay(opts.delay * 0.6)
    }
  } finally {
    await page.close()
  }
  for (const line of hydrateReport({ plan, adopted, refusals })) log(line)
  return filled
}

/** 只看有没有该站点的会话 cookie —— 不读取、不打印、不上传任何 cookie 内容 */
async function hasLoginCookie(context, site) {
  try {
    const host = new URL(site.listUrl).hostname
    const cookies = await context.cookies(`https://${host}`)
    return cookies.some((c) => /token|sid|session|login|ticket|auth/i.test(c.name))
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- 输出

export async function writeOutput(results, opts, log = () => {}) {
  await mkdir(OUT_DIR, { recursive: true })
  const now = new Date()
  const stampText = stamp(now)
  const written = []

  for (const result of results) {
    if (!result.jobs?.length) continue
    const payload = makePayload({
      siteId: result.siteId,
      siteName: result.label,
      channel: result.channel,
      pageUrl: result.pageUrl,
      pageTitle: result.pageTitle,
      jobs: result.jobs,
      now,
    })
    const base = opts.out
      ? opts.out.endsWith('.json')
        ? opts.out.slice(0, -5)
        : path.join(opts.out, `${safeFileName(result.kw ? `${result.siteId}__${result.kw}` : result.siteId)}-${stampText}`)
      : path.join(OUT_DIR, `${safeFileName(result.kw ? `${result.siteId}__${result.kw}` : result.siteId)}-${stampText}`)
    await mkdir(path.dirname(base), { recursive: true })
    await writeFile(`${base}.json`, JSON.stringify(payload, null, 2), 'utf8')
    await writeFile(`${base}.txt`, payload.text, 'utf8')
    written.push({ base, count: payload.count })
  }

  // 岗位日报：本轮新增的汇总（campus-radar 思路——「今天新出了什么」比全量列表重要）
  const dateLabel = now.toISOString().slice(0, 10)
  const sitesForReport = results
    .filter((r) => r.jobs?.length || r.stoppedLabel)
    .map((r) => ({
      label: r.label,
      channel: r.channel,
      count: r.jobs?.length ?? 0,
      titles: (r.jobs ?? []).slice(0, 5).map((j) => `${j.title}${j.city ? `（${j.city}）` : ''}`),
      stopped: r.stoppedLabel,
    }))
  const reportTotal = sitesForReport.reduce((sum, s) => sum + s.count, 0)
  const dailyPath = path.join(opts.out && !opts.out.endsWith('.json') ? opts.out : OUT_DIR, `daily-${dateLabel}.md`)
  await writeFile(dailyPath, dailyReportMd({ dateLabel, sites: sitesForReport, total: reportTotal }), 'utf8')
  if (reportTotal) log(`  岗位日报已写：${path.relative(process.cwd(), dailyPath)}（${reportTotal} 条）`)
  return written
}

function printSites() {
  console.log('可用站点（--site 取值）：\n')
  const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length))
  console.log(`${pad('id', 12)}${pad('名称', 18)}${pad('渠道', 12)}${pad('需登录', 8)}${pad('验证', 10)}说明`)
  for (const s of SITES) {
    console.log(
      `${pad(s.id, 12)}${pad(s.name, 18)}${pad(s.channel, 12)}${pad(s.needsLogin ? '是' : '否', 8)}${pad(s.verified ?? '未验证', 10)}${s.notes}`,
    )
  }
  console.log('\n也可以完全不用这个表：--url <任意招聘页地址> 走同一套结构检测。')
}

function printHelp() {
  console.log(`实习工作台 · 本地岗位抓取器

用法
  node run.mjs --site tencent --keyword 前端          抓腾讯招聘的「前端」岗
  node run.mjs --site boss --keyword "AI Agent"          BOSS：站点表声明了引擎，自动走 scrapling
  node run.mjs --url https://xxx.jobs.feishu.cn/index  任意招聘页
  node run.mjs --list-sites                            看内置站点表

参数
  --site <id>        站点 id，可重复
  --url <url>        任意招聘页地址，可重复
  --keyword <kw>     岗位关键词，填进站点的查询参数，可重复
  --pages <n>        最多翻几页（默认 2）
  --limit <n>        单站点最多产出多少条（默认 60）
  --detail <n>       给前 n 条补全 JD 详情（默认 20；0 = 不补）
  --delay <ms>       每次请求之间的等待（默认 2600，会自动加随机抖动）
  --wait <ms>        页面渲染等待，覆盖站点自带的建议值（SPA 慢的时候用）
  --mode <m>         all | intern | campus（按标题筛，默认 all）
  --company <名字>   页面里读不到公司名时用它补（用 --url 抓某家公司自己的站时很有用）
  --include <词>     标题必须包含，可重复
  --exclude <词>     标题不能包含，可重复
  --out <路径>       产出目录或 .json 路径（默认 crawler/output/）
  --engine <名字>    覆盖开关：强制用指定内核。**不填时由站点表决定**（sites.mjs 的 engine 字段）
                     值不认识 ⇒ 直接报错退出，绝不悄悄回落默认内核
  --login            给「声明了引擎」的站点登录一次（要本人扫码）。
                     默认内核的站点仍用 node login.mjs --site <id>
  --decode-salary    配引擎用：显式解开薪资的字体混淆。**默认不开**，
                     不开时带混淆的薪资一律丢弃为空（政策线见 crawler/README.md）
  --check-salary-font 配 --engine scrapling 用：诊断模式，现场量一遍薪资字体映射并输出
                     每个码位的海明距离。**默认不跑**（实测每轮会误拒 6/9 个码位，刷屏即失效）
                     不开时带混淆的薪资一律丢弃为空（政策线见 crawler/README.md）
  --resume           从上次中断的页继续
  --purge            清掉去重历史，强制全量重出
  --headed           显示浏览器窗口（调试用）
  --quiet            只打印结果

产出
  crawler/output/<站点>-<时间>.json   直接拖进工作台「批量导入」→「选择抓取结果文件」
  crawler/output/<站点>-<时间>.txt    纯文本形态，也能直接粘进导入框
`)
}

// ---------------------------------------------------------------- 可选引擎（按站点表路由）

/**
 * 跑一组「声明了引擎」的目标。**只返回 results，不返回退出码** ——
 * 汇总与退出码统一由 main() 算，否则「部分成功」会在两处分头汇报，读的人看不出哪一半没成。
 *
 * 失败边界（DSH 第十轮那张表）：环境缺失只判停这一组，其余站点照跑，整轮退出码非零。
 */
async function runEngineTargets({ opts, log, targets, engineName, unsupportedIds = [] }) {
  const profileDir = opts.profile ? path.resolve(opts.profile) : SCRAPLING_PROFILE_DIR
  await mkdir(profileDir, { recursive: true })

  const results = []

  for (const target of targets) {
    const base = {
      label: targetLabel(target),
      siteId: target.site.id,
      channel: target.site.channel,
      kw: target.kw,
      engine: engineName,
      pageUrl: urlForPage(target, opts, 1),
      pageTitle: target.site.name,
    }

    if (unsupportedIds.includes(target.site.id)) {
      log(`✗ ${base.label}：${engineName} 引擎没有实现这个站点的解析（是你显式 --engine 覆盖上来的），判停这一站`)
      results.push({ ...base, ok: false, jobs: [], stopped: true, stoppedReason: `${engineName} 不支持站点 ${target.site.id}` })
      continue
    }

    const resolved = await resolvePython()
    if (!resolved.ok) {
      log(`✗ ${base.label}：${engineName} 引擎环境不可用（${resolved.reason}），判停这一站，其余站点照常跑`)
      log('')
      console.error(installHint({ missing: resolved.missing ?? 'python', foundButLacking: resolved.foundButLacking ?? [] }))
      results.push({ ...base, ok: false, jobs: [], stopped: true, stoppedReason: `环境缺失：${resolved.reason}` })
      continue
    }

    log(`引擎：${engineName} · Python ${resolved.python}（探测方式：${resolved.via}）`)
    log(`档案目录：${path.relative(CRAWLER_DIR, profileDir) || profileDir}（与默认内核的 .profile 分开 —— 两个内核的 profile 互不兼容）`)
    if (opts.detail) log('  （此引擎只读列表页、不补详情页：岗位缺 JD 正文，匹配分明显低于其他站点）')
    if (opts.delay !== 2600) log('  （此引擎用内置的串行延迟与页间等待，--delay 无效）')
    if (opts.pages > 3) {
      log(`  你给了 ${opts.pages} 页。BOSS 风控较紧，建议单轮 ≤3 页；本轮约 ${opts.pages * 17} 秒起（页间 12 秒 + 请求前 5 秒），遇验证码会立刻停本站。`)
    }

    log(`▶ ${base.label}`)
    // 自动选择对用户是不可见的决策 —— 不写出来，出错时没人知道这条路是怎么被选上的
    const why = opts.engine
      ? `你显式 --engine ${opts.engine} 覆盖（站点表声明的是 ${target.site.engine || '默认内核'}）`
      : `站点表声明 engine=${engineName}，自动选用（没声明的站点一律走默认内核）`
    log(`    引擎：${engineName} —— ${why}`)
    log('    该引擎固定 headed + 串行，遇验证码即停不绕过')

    let out
    try {
      out = await runScrapling({
        python: resolved.python,
        keyword: target.kw,
        pages: opts.pages,
        limit: opts.limit,
        profileDir,
        decodeSalary: Boolean(opts.decodeSalary),
        checkSalaryFont: Boolean(opts.checkSalaryFont),
      })
    } catch (error) {
      const reason = `引擎调用失败：${msgOf(error)}`
      log(`✗ ${base.label} ${reason}`)
      results.push({ ...base, ok: false, jobs: [], stopped: true, stoppedReason: reason })
      continue
    }

    if (out.engine_error) {
      log(`✗ ${base.label} 引擎内部错误（不是站点没数据，也不是风控）：`)
      for (const line of String(out.engine_error).split(String.fromCharCode(10)).slice(-12)) log(`    ${line}`)
      log('  这是引擎自身代码的异常。不要按「抓到 0 条」去排查登录态或风控 —— 那条路会白白等一次冷却。')
      results.push({ ...base, ok: false, jobs: [], stopped: true, stoppedReason: '引擎内部错误（见上面的 traceback）' })
      continue
    }

    // 引擎中途异常要**结构化**地成为判停理由：只塞进 warnings 的话，
    // 「引擎挂了」和「这站今天真的 0 条」在退出码上会长得一模一样。
    const fetchErrors = (out.fetch_errors ?? []).map((e) => `引擎抓取异常：${e}`)
    const wall = detectStopWall(out.wall_text ?? '')
    const errors = (out.warnings ?? []).map((w) => `引擎提示：${w}`)
    errors.push(...fetchErrors)
    const jobs = out.jobs ?? []
    if (wall.hit) {
      errors.push(`命中安全停止清单（${wall.label}）：按「遇到就停」纪律停止本站点，不重试、不绕过`)
    }
    if (out.logged_in === false) {
      errors.push('这个档案里没有登录态（BOSS 列表页要登录才给数据）。登录是需要本人做的一个动作：')
      errors.push(`    node run.mjs --site ${target.site.id} --login     ← 会弹窗口，你扫码，最长等 15 分钟`)
    }
    const undecoded = out.salary_undecoded ?? { count: 0, items: [] }
    if (out.salary_dropped) {
      log(`  ${out.salary_dropped} 条薪资因字体混淆被丢弃（这是默认行为，不是抓到空值）。要薪资加 --decode-salary`)
    }
    if (undecoded.count) {
      log(`  ⚠ ${undecoded.count} 条薪资未能解码，那几条的薪资字段是空的 —— 不是数据源没给，是字体映射对不上：`)
      for (const item of (undecoded.items ?? []).slice(0, 5)) log(`     第 ${item.index} 条「${item.title}」认不出的码位 ${item.codepoints.join(' / ')}`)
    }
    log(`  抓到 ${jobs.length} 条（薪资模式：${out.salary_mode === 'decoded' ? '已按 --decode-salary 解码' : '默认守线，混淆值已丢弃'}）`)

    const noLogin = out.logged_in === false
    results.push({
      ...base,
      ok: jobs.length > 0 && !wall.hit && !noLogin && !fetchErrors.length,
      jobs,
      errors,
      read: jobs.length,
      stopped: noLogin || wall.hit || fetchErrors.length > 0,
      stoppedReason: noLogin ? '档案里没有登录态' : wall.hit ? `安全停止清单：${wall.label}` : '',
    })
  }

  return { results }
}

/** 登录：需要本人扫码的一步，无法代做。 */
async function runEngineLogin({ opts, log, target }) {
  const profileDir = opts.profile ? path.resolve(opts.profile) : SCRAPLING_PROFILE_DIR
  await mkdir(profileDir, { recursive: true })

  const resolved = await resolvePython()
  if (!resolved.ok) {
    log(`✗ ${resolved.reason}`)
    log('')
    console.error(installHint({ missing: resolved.missing ?? 'python', foundButLacking: resolved.foundButLacking ?? [] }))
    return 2
  }

  log(`接下来会**弹出一个浏览器窗口**（这一步必须你本人做，程序不代填账号密码，也不会自动登录）：`)
  log(`  登录目标：${targetLabel(target)} —— 档案按引擎分开存，别和默认内核的 .profile 混用`)
  log('  1) 在窗口里扫码或用密码/短信登录 BOSS')
  log('  2) 登成功后**不用管终端** —— 它每 5 秒检查一次，看到登录态就自己存盘退出')
  log('  3) 最长等 15 分钟。**窗口开着、终端没动静不是卡住**，是在等你扫码')
  log(`  登录态存进：${path.relative(CRAWLER_DIR, profileDir)}（这个目录不入库）`)

  const out = await runScrapling({ python: resolved.python, login: true, profileDir })
  if (out.engine_error) {
    log('✗ 引擎内部错误（不是登录失败）：')
    for (const line of String(out.engine_error).split(String.fromCharCode(10)).slice(-10)) log(`    ${line}`)
    return 5
  }
  const wall = detectStopWall(out.wall_text ?? '')
  if (wall.hit) log(`⛔ 命中安全停止清单（${wall.label}）：不尝试绕过，换个时间或网络再登录。`)
  if (out.ok) {
    log('')
    log(`✅ 登录态已存进 ${path.relative(CRAWLER_DIR, profileDir)}，现在可以：`)
    log(`   node run.mjs --site ${target.site.id} --keyword "AI Agent"`)
    return 0
  }
  log('')
  log('❌ 没检测到登录。窗口里没登成功，或者超时了。')
  return 3
}

// ---------------------------------------------------------------- 入口

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const log = makeLog(opts.quiet)

  if (opts.help || (!opts.sites.length && !opts.urls.length && !opts.listSites)) {
    printHelp()
    return 0
  }
  if (opts.listSites) {
    printSites()
    return 0
  }
  if (opts.unknown.length) log(`（忽略未知参数：${opts.unknown.join(' ')}）`)

  await mkdir(OUT_DIR, { recursive: true })
  if (opts.purge) log('已清空去重历史，本次为全量重出')

  const targets = buildTargets(opts)
  const bad = targets.filter((t) => t.error)
  for (const b of bad) log(`✗ ${b.error}`)
  let runnable = targets.filter((t) => !t.error)

  if (!runnable.length) {
    log('\n没有可执行的任务。用 --list-sites 看站点 id，或 --url 直接给地址。')
    return 1
  }

  // 路由：站点表里声明了 engine 的自动走该引擎，没声明的一律走默认内核；
  // --engine 只是**显式覆盖**。不允许多一种"我记得这站要用引擎"的隐式判断 ——
  // 那条判据由 lib/routing.mjs 实现，并被 __tests__/engineRouting.test.mjs 钉住。
  const plan = routeTargets({ targets: runnable, requestedEngine: opts.engine, engineNames: ENGINE_NAMES })
  if (plan.unknownEngine) {
    log(`✗ 不认识的引擎：--engine ${opts.engine}。可选：${ENGINE_NAMES.join(' / ')}（不带 --engine 时由站点表决定用哪个）`)
    return 2
  }

  const defaultTargets = plan.groups.find((g) => g.engine === DEFAULT_ENGINE)?.targets ?? []
  const engineGroups = plan.groups.filter((g) => g.engine !== DEFAULT_ENGINE)
  const unsupportedIds = plan.unsupported.map((t) => t.site.id)

  if (opts.login) {
    const engineTargets = engineGroups.flatMap((g) => g.targets)
    if (engineTargets.length !== 1 || defaultTargets.length) {
      log('✗ --login 需要正好一个「走引擎」的站点（例如 --site boss）。默认内核的登录请走 node login.mjs --site <id>')
      return 2
    }
    return runEngineLogin({ opts, log, target: engineTargets[0] })
  }


  const results = []

  // 默认内核批：装没装 Python 都该跑成，所以它排在引擎批之前，且不引用任何 Python 相关依赖。
  if (defaultTargets.length) {
    const profileDir = opts.profile ? path.resolve(opts.profile) : PROFILE_DIR
    log(`浏览器：优先使用系统已装的 Edge / Chrome；档案目录 ${path.relative(CRAWLER_DIR, profileDir) || profileDir}（登录态保存在这里）`)
    const { context, label: browserLabel } = await launchBrowser({ headless: !opts.headed, profileDir })
    log(`已启动：${browserLabel}`)
    try {
      for (const target of defaultTargets) {
        try {
          const result = await crawlTarget({ context, target, opts, log })
          results.push({
            ...result,
            engine: DEFAULT_ENGINE,
            siteId: target.site.id,
            channel: target.site.channel,
            // kw 进文件名：同一站点多关键词时输出文件名若只含 siteId+时间戳（精确到分钟），
            // 后一个关键词会把前一个的产出覆盖掉（0.7.6 实际踩中：腾讯后端 10 条被前端 10 条盖没）
            kw: target.kw,
            pageUrl: urlForPage(target, opts, 1),
            pageTitle: target.site.name,
          })
        } catch (error) {
          log(`✗ ${targetLabel(target)} 出错：${msgOf(error)}`)
          results.push({ label: targetLabel(target), engine: DEFAULT_ENGINE, siteId: target.site.id, ok: false, jobs: [], errors: [msgOf(error)] })
        }
      }
    } finally {
      await context.close()
    }
  }

  // 引擎批：一组一组跑。某一组环境缺失只判停那一组，不拖垮整轮，也不会静默跳过。
  for (const group of engineGroups) {
    const groupOut = await runEngineTargets({ opts, log, targets: group.targets, engineName: group.engine, unsupportedIds })
    results.push(...groupOut.results)
  }

  const written = await writeOutput(results, opts, log)

  // 汇总统一在这里算 —— 只有一处出口，「部分成功」就不会被哪一半自己汇报成成功。
  log('')
  log('──────── 汇总 ────────')
  const summary = summarizeRun({ results, engineLabels: Object.fromEntries(ENGINE_NAMES.map((n) => [n, n])) })
  for (const line of summary.lines) log(line)
  log(`合计 ${summary.total} 条 · 成功 ${summary.okCount} 个目标 · 失败 ${summary.failedCount} 个`)
  for (const file of written) log(`已写出：${path.relative(process.cwd(), file.base)}.json（${file.count} 条）`)

  if (summary.stoppedCount) {
    log('')
    log(`整轮退出码非零：有 ${summary.stoppedCount} 个目标判停（上面列了站名和原因），其余目标的结果已照常写出。`)
  } else if (!summary.total && results.some((r) => r.ok && (r.read ?? 0) > 0)) {
    // 「读到了岗位但全部与去重历史重复」是正常结果（例如一天内第二次跑同一站点），不是失败。
    log('')
    log('本次没有新增岗位：读到的岗位都与去重历史重复。想强制重出可以删掉 output/.seen-*.json 或加 --purge。')
  } else if (!summary.total) {
    log('')
    log('一条都没抓到。常见原因：')
    log('  1) 站点是 SPA，渲染慢 —— 加长等待：--delay 4000，或先 --headed 看一眼页面到底长什么样')
    log('  2) 列表用的不是静态 DOM，而是虚拟列表 —— 试 --pages 1 配合 --headed 手动滚动确认')
    log('  3) 需要登录 —— 默认内核走 node login.mjs --site <id>；声明了引擎的站点走 node run.mjs --site <id> --login')
  } else {
    log('')
    log('下一步：打开工作台 →「岗位池」→「批量导入」→「选择抓取结果文件」，选上面那个 .json。')
  }

  // 退出码只在这一处决定，且它是被 __tests__/engineRouting.test.mjs 钉住的那个纯函数。
  // 散在各个分支里的 return 0/1 迟早会和它不一致 —— 而"部分成功读成全成功"就是这么来的。
  return computeExitCode({ total: summary.total, results })
}

/**
 * 入口守卫。
 *
 * 这里原本是无条件 `main()` —— 于是**任何 import 这个文件的人都会把 CLI 真跑一遍**
 * （没参数就打印帮助再 `process.exit(0)`）。后果不是难看，是**抓取器整个没法写单测**：
 * 2026-09-27 我第一次给它加测试时，测试进程直接被这个 exit 干掉，全绿也拿不到退出码。
 * 判断方式跟 `sources/offerbiu.mjs` 里那条一致（同一个仓库里两把尺子，早晚有一处不对）。
 */
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`\n抓取器异常退出：${msgOf(error)}`)
      if (String(error?.message ?? '').includes('Cannot find package')) {
        console.error('依赖没装。先执行：cd crawler && npm install')
      }
      process.exit(2)
    })
}
