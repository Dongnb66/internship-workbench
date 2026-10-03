/**
 * 打出「本地助手」的安装目录（自包含），最后跑一遍自检决定成败。
 *
 * 为什么要有它：2026-10-03 用用户视角实测，桌面包把 crawler/ 打了进去，
 * 却既没带 extension/collector.js（crawler/lib/browser.mjs 硬指向这个相对路径），
 * 也没装 playwright-core —— 用户点一次「开始抓取」就是 0 条，界面还写着
 * 「常见的是站点改版或需要登录」。缺的东西用户自己补不了，所以把「打包」
 * 变成一条命令 + 一道自检闸门：缺件直接非零退出，别发出去。
 *
 * 用法：
 *   node scripts/build-agent-folder.mjs --out <目录>            # 复制仓库已装好的依赖 + 当前 Node 运行时
 *   node scripts/build-agent-folder.mjs --out <目录> --npm      # 强制在产物里 npm install
 *   node scripts/build-agent-folder.mjs --out <目录> --no-node  # 不复制 Node 运行时
 *   node scripts/build-agent-folder.mjs --check <已有目录>      # 只跑自检（发布前最后一道闸门）
 *
 * 退出码：0 = 自检通过；1 = 缺件（逐条打印怎么补）；2 = 参数不对
 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkInstall, formatProblems } from '../crawler/agent/selfcheck.mjs'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name) => argv.includes('--' + name)
const opt = (name) => {
  const i = argv.indexOf('--' + name)
  if (i < 0) return ''
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : ''
}

// 只检查模式：发布前拿它当最后一道闸门（也可以拿来查用户机器上那份）
const checkOnly = opt('check')
if (checkOnly) {
  const dir = path.resolve(checkOnly)
  const install = checkInstall({ crawlerDir: path.join(dir, 'crawler') })
  console.log('检查 ' + dir)
  if (install.ready) {
    console.log('✅ 三样都在：采集脚本 / 依赖 / 系统浏览器（' + (install.browser ? install.browser.label : '?') + '）')
    process.exit(0)
  }
  console.error('❌ 缺件：')
  console.error(formatProblems(install.problems))
  process.exit(1)
}

const out = opt('out')
if (!out) {
  console.error('用法：node scripts/build-agent-folder.mjs --out <目录> [--npm] [--no-node] [--node <Node 安装目录>]')
  console.error('  或：node scripts/build-agent-folder.mjs --check <已有安装目录>')
  process.exit(2)
}
const OUT = path.resolve(out)
const CRAWLER_OUT = path.join(OUT, 'crawler')
const SKIP_TOP = new Set(['node_modules', 'output', '.profile', '.git'])

mkdirSync(OUT, { recursive: true })
console.log('· crawler/ → ' + CRAWLER_OUT)
cpSync(path.join(REPO, 'crawler'), CRAWLER_OUT, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(path.join(REPO, 'crawler'), src)
    return !rel || !SKIP_TOP.has(rel.split(path.sep)[0])
  },
})

console.log('· extension/ → ' + path.join(OUT, 'extension'))
cpSync(path.join(REPO, 'extension'), path.join(OUT, 'extension'), { recursive: true })

if (!flag('no-node')) {
  const src = path.resolve(opt('node') || path.dirname(process.execPath))
  if (existsSync(path.join(src, process.platform === 'win32' ? 'node.exe' : 'bin/node'))) {
    console.log('· node 运行时 → ' + path.join(OUT, 'node'))
    cpSync(src, path.join(OUT, 'node'), { recursive: true })
  } else {
    console.log('· ⚠️ 没找到 Node 运行时（' + src + '）：产物将依赖目标机器自带的 node')
  }
}

const localModules = path.join(REPO, 'crawler', 'node_modules')
const outModules = path.join(CRAWLER_OUT, 'node_modules')
if (!flag('npm') && existsSync(path.join(localModules, 'playwright-core'))) {
  console.log('· 依赖 → 复制仓库已装好的 crawler/node_modules（离线，版本由 package-lock 决定）')
  cpSync(localModules, outModules, { recursive: true })
} else {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  console.log('· 依赖 → 在产物里 npm install --omit=dev（需要网络）')
  const r = spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: CRAWLER_OUT, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) {
    console.error('❌ npm install 失败（status=' + r.status + '）')
    process.exit(1)
  }
}

writeLaunchers()

const install = checkInstall({ crawlerDir: CRAWLER_OUT })
console.log('')
console.log('产物：' + OUT)
if (!install.ready) {
  console.error('❌ 自检没过 —— 这个包发出去，用户点「开始抓取」一定失败：')
  console.error(formatProblems(install.problems))
  process.exit(1)
}
console.log('✅ 自检通过：采集脚本在、依赖在、浏览器在（' + (install.browser ? install.browser.label : '?') + '）')

/** 启动/停止/卸载脚本 + 说明：产物直接双击就能用，不依赖外部安装器 */
function writeLaunchers() {
  const nl = String.fromCharCode(13, 10)
  const bs = String.fromCharCode(92)
  const sq = String.fromCharCode(39)
  const vbs = [
    sq + ' 隐藏窗口启动本地助手（自定位：不写死安装路径）',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'root = fso.GetParentFolderName(WScript.ScriptFullName)',
    'Set sh = CreateObject("WScript.Shell")',
    'sh.CurrentDirectory = root',
    'sh.Run """" & root & "' + bs + 'node' + bs + 'node.exe"" """ & root & "' + bs + 'crawler' + bs + 'agent' + bs + 'server.mjs""", 0, False',
    '',
  ].join(nl)
  writeFileSync(path.join(OUT, 'start-hidden.vbs'), vbs, 'utf8')

  const psFilter = bs + '"Name=' + sq + 'node.exe' + sq + bs + '"'
  const stopPs = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter ' + psFilter + ' | Where-Object { $_.CommandLine -like ' + sq + '*agent*server.mjs*' + sq + ' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"'
  writeFileSync(path.join(OUT, '停止助手.cmd'), ['@echo off', 'cd /d "%~dp0"', 'echo Stopping the local agent...', stopPs, 'echo Done.', 'pause > nul', ''].join(nl), 'utf8')

  const uninstallReg = 'reg delete "HKCU' + bs + 'Software' + bs + 'Microsoft' + bs + 'Windows' + bs + 'CurrentVersion' + bs + 'Run" /v InternshipWorkbenchAgent /f'
  writeFileSync(path.join(OUT, '卸载.cmd'), ['@echo off', 'cd /d "%~dp0"', 'echo Removing startup entry...', uninstallReg + ' >nul 2>&1', 'echo Stopping agent...', stopPs, 'echo Done. You can now delete this folder.', 'pause > nul', ''].join(nl), 'utf8')

  writeFileSync(
    path.join(OUT, '安装说明.txt'),
    [
      '实习工作台 · 本地抓取助手',
      '',
      '启动：双击 start-hidden.vbs（无窗口）。开机自启：把它的快捷方式放进 shell:startup。',
      '停止：双击 停止助手.cmd',
      '卸载：双击 卸载.cmd，然后删掉整个目录。',
      '',
      '这个目录必须包含三样，缺一样网页上点「开始抓取」都会失败：',
      '  crawler/                             抓取器本体',
      '  extension/collector.js               采集脚本（crawler 会去 ../extension/collector.js 找它）',
      '  crawler/node_modules/playwright-core 依赖',
      '',
      '自检：node crawler/agent/selfcheck.mjs    （退出码 0 = 三样都在）',
      '',
    ].join(nl),
    'utf8',
  )
}
