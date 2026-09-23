#!/usr/bin/env node
/**
 * 手动登录一次，把登录态存进 crawler/.profile，之后 run.mjs 直接复用。
 *
 * 为什么是这个形态：需要登录的站点（BOSS 直聘这类）如果在脚本里代填账号密码，
 * 就等于把密码交给一段自动化代码，还得自己实现验证码识别。所以这里只做一件事 ——
 * **开一个真正的浏览器窗口，你自己登录，脚本在一边等着。**
 * 脚本全程不读取、不打印、不上传任何 cookie 内容。
 *
 * 用法
 *   node login.mjs                  打开 BOSS 直聘
 *   node login.mjs --site tencent   打开腾讯招聘
 *   node login.mjs --url <地址>      打开任意地址
 * 登录完成后回到终端按回车，档案就被保存下来了。
 */

import { createInterface } from 'node:readline/promises'

import { PROFILE_DIR, launchBrowser, msgOf } from './lib/browser.mjs'
import { findSite } from './sites.mjs'

const args = process.argv.slice(2)
const readFlag = (name) => {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (i < 0) return ''
  const token = args[i]
  const eq = token.indexOf('=')
  return eq >= 0 ? token.slice(eq + 1) : String(args[i + 1] ?? '')
}

const siteId = readFlag('site') || 'boss'
const explicitUrl = readFlag('url')
const site = findSite(siteId)
const target = explicitUrl || site?.listUrl || site?.listUrl || 'https://www.zhipin.com/web/geek/job'

console.log(`档案目录：${PROFILE_DIR}`)
console.log(`即将打开：${target}`)
console.log('\n请在弹出的浏览器窗口里完成登录（含扫码 / 短信验证）。')
console.log('登录完成、能看到岗位列表之后，回到这个终端按回车。\n')

let context
try {
  const launched = await launchBrowser({ headless: false })
  context = launched.context
  console.log(`已启动：${launched.label}\n`)
} catch (error) {
  console.error(msgOf(error))
  process.exit(2)
}

const page = await context.newPage()
try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 })
} catch (error) {
  console.error(`打开页面失败：${msgOf(error)}（窗口已开着，可以自己输地址）`)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
await rl.question('登录完成后按回车保存并退出… ')
rl.close()

await context.close()
console.log('\n已保存。下次直接跑：node run.mjs --site ' + (site?.id ?? 'generic'))
