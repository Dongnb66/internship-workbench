#!/usr/bin/env node
/**
 * 打「本地助手安装器」（单文件 Setup.exe，内嵌整包 zip）。
 *
 * 为什么：用户原来的路径是「解压 zip → 右键属性解除锁定 → 找到 start-hidden.vbs 双击」，
 * 三道认知坎。安装器把它们并成一次双击，并顺手写开机自启（用户不会再忘了开助手）。
 *
 * 用系统自带的 csc.exe 编译（.NET Framework 4.0 目录下就有），**不需要装任何东西**；
 * C# 只能是 C# 5 语法（别用字符串插值 / ?. / nameof）。
 *
 * 用法：
 *   node scripts/build-agent-installer.mjs --zip "D:\Downloads\internship-workbench-agent-2026-10-03.zip" \
 *        --out "D:\Downloads\InternshipWorkbench-Agent-Setup.exe"
 *   node scripts/build-agent-installer.mjs --check           # 只做环境检查（csc / C# / zip 在不在）
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.join(HERE, '..')
const CS = path.join(HERE, 'installer', 'Installer.cs')

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const has = (k) => process.argv.includes('--' + k)

const CSC_CANDIDATES = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
]

function findCsc() {
  for (const c of CSC_CANDIDATES) if (existsSync(c)) return c
  throw new Error('找不到 csc.exe（.NET Framework 4.0 目录）。这台机器编不了安装器 —— 但包本身不受影响。')
}

const csc = findCsc()
console.log('· csc        →', csc)
console.log('· Installer.cs →', existsSync(CS) ? CS : '(缺失！)')

if (has('check')) {
  if (!existsSync(CS)) process.exit(1)
  console.log('✅ 环境够用（csc + Installer.cs 都在）')
  process.exit(0)
}

const zip = arg('zip', path.join('D:\\Downloads', 'internship-workbench-agent-2026-10-03.zip'))
const out = arg('out', path.join('D:\\Downloads', 'InternshipWorkbench-Agent-Setup.exe'))
if (!existsSync(zip)) throw new Error('找不到要内嵌的 zip：' + zip)
if (!existsSync(CS)) throw new Error('找不到 Installer.cs：' + CS)

mkdirSync(path.dirname(out), { recursive: true })
console.log('· zip        →', zip, '(' + statSync(zip).size + ' 字节)')
console.log('· 输出       →', out)

execFileSync(
  csc,
  [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    '/platform:anycpu',
    '/out:' + out,
    '/resource:' + zip + ',agent.zip',
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    '/r:System.IO.Compression.dll',
    '/r:System.IO.Compression.FileSystem.dll',
    '/r:System.Management.dll',
    CS,
  ],
  { stdio: 'inherit' },
)

const buf = readFileSync(out)
const sha = createHash('sha256').update(buf).digest('hex')
console.log('')
console.log('✅ 安装器已生成')
console.log('   路径   :', out)
console.log('   字节   :', buf.length)
console.log('   sha256 :', sha)
console.log('')
console.log('用户侧动作：双击 → 自动释放到 %LOCALAPPDATA%\\InternshipWorkbench → 启动助手 + 写开机自启 → 提示刷新网页')
