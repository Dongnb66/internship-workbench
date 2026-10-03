/**
 * 发布后核验（一条命令）。
 *
 * 为什么需要它：2026-10-03 实测到的陷阱 —— 下载用的 zip 不在 public/downloads/ 里时，
 * 那个 URL **不会 404**，而是返回 200 + text/html 的 SPA 回退页。也就是说「这次发布没带上
 * 那个文件」会把下载链接**静默**变成一个网页，状态码还是 200。所以核验不能只看状态码，
 * 必须看 Content-Type；这条脚本就是把这个判据固定下来。
 *
 * 用法：
 *   node scripts/verifyPublish.mjs
 *   node scripts/verifyPublish.mjs --zip https://.../downloads/internship-workbench-agent-2026-10-10.zip
 *   node scripts/verifyPublish.mjs --sha256 af849743...（额外全量下载比对，51MB，慢）
 *   node scripts/verifyPublish.mjs --bytes 53568529
 *
 * 退出码：0 = 全过；1 = 有失败（逐条打印）；2 = 脚本自身出错。
 */
const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const SITE = opt('site', 'https://internship-workbench-47024.app.workbuddy.host').replace(/\/$/, '')
const ZIP = opt('zip', SITE + '/downloads/internship-workbench-agent.zip')
const EXPECT_SHA = opt('sha256', '')
const EXPECT_BYTES = Number(opt('bytes', '0'))

const fails = []
const ok = (m) => console.log('  ✅ ' + m)
const bad = (m, detail) => { fails.push(m); console.log('  ❌ ' + m + (detail ? '  —— ' + detail : '')) }

async function main() {
  console.log('站点 ' + SITE)
  console.log('下载 ' + ZIP)
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

  // 2) 下载包：关键是 Content-Type（回退页也回 200，所以状态码单独看不出来）
  const h = await fetch(ZIP, { method: 'HEAD' })
  const type = String(h.headers.get('content-type') || '').toLowerCase()
  const len = Number(h.headers.get('content-length') || '0')
  if (h.status !== 200) bad('下载链接状态码 ' + h.status)
  else if (!type.includes('application/zip')) {
    bad('下载链接返回的不是 zip（' + type + '）', '这次发布没把 public/downloads/ 带上，链接被静默换成了回退页')
  } else ok('下载链接 Content-Type = application/zip')
  if (len) {
    if (EXPECT_BYTES && len !== EXPECT_BYTES) bad('Content-Length ' + len + ' ≠ 期望 ' + EXPECT_BYTES)
    else ok('Content-Length = ' + len)
  }

  // 3) 可选：全量 sha256（默认不跑，包 51MB）
  if (EXPECT_SHA) {
    const { createHash } = await import('node:crypto')
    const buf = Buffer.from(await (await fetch(ZIP)).arrayBuffer())
    const got = createHash('sha256').update(buf).digest('hex')
    if (got === EXPECT_SHA) ok('全量 sha256 = ' + got)
    else bad('sha256 不一致', got + ' ≠ ' + EXPECT_SHA)
  }

  console.log('')
  if (fails.length) { console.log('❌ 核验没过：' + fails.length + ' 项'); process.exit(1) }
  console.log('✅ 核验通过')
}

main().catch((e) => { console.error('核验脚本自身出错：' + (e && e.message)); process.exit(2) })
