/**
 * 发布后核验（一条命令）。
 *
 * 为什么需要它：2026-10-03 实测到的陷阱 —— public/downloads/ 里的文件没带上时，那个 URL
 * **不会 404**，而是返回 200 + text/html 的 SPA 回退页：链接形状依然合法、界面也不报错。
 * 所以核验不能只看状态码，必须看 Content-Type。
 *
 * 现在要核验两个下载物（都要放进发布源树的 public/downloads/）：
 *   1) InternshipWorkbench-Agent-Setup.exe  安装器（单文件、双击即装）—— 不能是 HTML
 *   2) internship-workbench-agent.zip       手动安装包 —— 必须是 application/zip
 *
 * 用法：
 *   node scripts/verifyPublish.mjs
 *   node scripts/verifyPublish.mjs --sha256 af849743…   # 额外全量下载比对 zip（51MB，慢）
 *   node scripts/verifyPublish.mjs --setup <url> --zip <url> --bytes 53568529 --site <url>
 *
 * 退出码：0 = 全过；1 = 有失败；2 = 脚本自身出错。
 */
const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const SITE = opt('site', 'https://internship-workbench-47024.app.workbuddy.host').replace(/\/$/, '')
const SETUP = opt('setup', SITE + '/downloads/InternshipWorkbench-Agent-Setup.exe')
const ZIP = opt('zip', SITE + '/downloads/internship-workbench-agent.zip')
const EXPECT_SHA = opt('sha256', '')
const EXPECT_BYTES = Number(opt('bytes', '0'))

const fails = []
const ok = (m) => console.log('  ✅ ' + m)
const bad = (m, detail) => { fails.push(m); console.log('  ❌ ' + m + (detail ? '  —— ' + detail : '')) }

async function checkDownload(label, url, mustBe, hint) {
  const h = await fetch(url, { method: 'HEAD' })
  const type = String(h.headers.get('content-type') || '').toLowerCase()
  const len = Number(h.headers.get('content-length') || '0')
  if (h.status !== 200) { bad(label + ' 状态码 ' + h.status, url); return }
  if (mustBe) {
    if (!type.includes(mustBe)) { bad(label + ' 返回的不是 ' + mustBe + '（' + type + '）', hint); return }
  } else if (type.includes('text/html')) {
    bad(label + ' 返回的是 HTML 回退页', hint)
    return
  }
  const sizeNote = EXPECT_BYTES && len && len !== EXPECT_BYTES ? ' ⚠️ 期望 ' + EXPECT_BYTES + ' 字节' : ''
  ok(label + ' ' + (type || '(无 content-type)') + ' · ' + len + ' 字节' + sizeNote)
}

async function main() {
  console.log('站点 ' + SITE)
  console.log('安装包 ' + SETUP)
  console.log('手动包 ' + ZIP)
  console.log('')

  // 1) 应用本身
  const html = await (await fetch(SITE + '/', { cache: 'no-store' })).text()
  const version = (html.match(/app-version" content="([^"]+)"/) || [])[1]
  const bundle = (html.match(/src="([^"]+\.js)"/) || [])[1]
  if (version) ok('app-version = ' + version)
  else bad('读不到 app-version（首页被顶掉过？）')
  if (bundle) {
    const r = await fetch(SITE + bundle, { method: 'HEAD' })
    if (r.ok) ok('主 bundle ' + bundle + ' -> ' + r.status)
    else bad('主 bundle 取不到', String(r.status))
  } else bad('首页里找不到主 bundle')

  // 2) 两个下载物：关键都是 Content-Type，不是状态码
  await checkDownload('安装器 Setup.exe', SETUP, null, '这次发布没把 public/downloads/ 里的安装包带上，链接被静默换成了回退页')
  await checkDownload('手动安装 zip', ZIP, 'application/zip', '这次发布没把 public/downloads/ 里的 zip 带上')

  // 3) 可选：全量 sha256（默认不跑，包 51MB）
  if (EXPECT_SHA) {
    const { createHash } = await import('node:crypto')
    const buf = Buffer.from(await (await fetch(ZIP)).arrayBuffer())
    const got = createHash('sha256').update(buf).digest('hex')
    if (got === EXPECT_SHA) ok('手动包全量 sha256 = ' + got)
    else bad('sha256 不一致', got + ' ≠ ' + EXPECT_SHA)
  }

  console.log('')
  if (fails.length) { console.log('❌ 核验没过：' + fails.length + ' 项'); process.exit(1) }
  console.log('✅ 核验通过')
}

main().catch((e) => { console.error('核验脚本自身出错：' + (e && e.message)); process.exit(2) })
