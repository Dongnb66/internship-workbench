/**
 * Scrapling（patchright 内核）引擎的 Node 侧胶水。
 *
 * 只有 `--engine scrapling` 才会走到这里。默认那条 Node/Playwright 路径**不 import 本文件的任何探测**
 * （run.mjs 里是惰性 import），所以没装 Python 的人照旧能爬其余 26 个站点 —— 这是硬要求，
 * 加 Python 引擎是真实的架构代价，不许把它转嫁给不用它的人。
 *
 * 分工：Python 只吐裸 jobs，**产出格式由 run.mjs 的 makePayload 拼**。
 * 安全停止判据也留在 lib/stopRules.mjs：这里只把页面文本传回来，命中哪条由那边说。
 */

import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CRAWLER_DIR } from './browser.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const ENGINE_NAMES = ['scrapling']
export const SCRAPLING_SCRIPT = path.join(CRAWLER_DIR, 'engines', 'scrapling_boss.py')
/** 与 Playwright 那套档案分开：两个内核的 profile 互不兼容，混用会互相打不开 */
export const SCRAPLING_PROFILE_DIR = path.join(CRAWLER_DIR, '.profile-scrapling')
const VENV_PYTHON = path.join(CRAWLER_DIR, 'engines', '.venv', 'Scripts', 'python.exe')
/**
 * 仓库**外**的默认安装位置：与仓库盘根同级的 iwb-engines-venv。
 * 路径从仓库位置推出来（crawler → 项目 → Downloads → 盘根），不写死任何用户目录，
 * 所以换机器、换盘符、换 clone 位置都成立。
 * 为什么不直接放仓库内：放仓库内的防护只有一行 .gitignore，
 * 一次 `git add -A` 失手就是几百 MB 进 git 历史（历史里删不掉）。放外面是**结构上不可能**。
 */
const OUTSIDE_VENV_PYTHON = path.resolve(CRAWLER_DIR, '..', '..', '..', 'iwb-engines-venv', 'Scripts', 'python.exe')

/** 判停提示的唯一来源是 installHint() —— 这里不再放第二份文案，两份必然漂移。 */

function probe(python) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(python, ['-c', 'import scrapling, patchright'], { windowsHide: true })
    } catch {
      resolve(false)
      return
    }
    const timer = setTimeout(() => {
      child.kill()
      resolve(false)
    }, 60000)
    child.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
}

async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

/** 候选顺序：显式环境变量 → 仓库外 venv → 仓库内 venv → PATH 上的 python（且真能 import scrapling） */
export async function resolvePython(env = process.env) {
  const fromEnv = String(env.IWB_SCRAPLING_PYTHON ?? '').trim()
  if (fromEnv) {
    if (!(await exists(fromEnv))) {
      return { ok: false, missing: 'python', reason: `IWB_SCRAPLING_PYTHON 指向的文件不存在：${fromEnv}` }
    }
    return (await probe(fromEnv))
      ? { ok: true, python: fromEnv, via: 'IWB_SCRAPLING_PYTHON' }
      : { ok: false, missing: 'scrapling', reason: `IWB_SCRAPLING_PYTHON 指向的解释器里没装 scrapling：${fromEnv}` }
  }

  // 存在但没装 scrapling 时**继续往下找**，别在这儿就断言失败：
  // PATH 上可能正好有一个装了 scrapling 的解释器（本项目实测就是这种机器）
  for (const [file, via] of [
    [OUTSIDE_VENV_PYTHON, '仓库外的 iwb-engines-venv'],
    [VENV_PYTHON, 'crawler/engines/.venv'],
  ]) {
    if ((await exists(file)) && (await probe(file))) return { ok: true, python: file, via }
  }

  for (const candidate of ['python', 'py']) {
    if (await probe(candidate)) return { ok: true, python: candidate, via: `PATH:${candidate}` }
  }
  // 走到这里：一个能用 scrapling 的解释器都没找到。但要分清是哪种缺失 ——
  // 缺 Python 和缺 scrapling 的补救命令完全不同，给错了就等于没给。
  const anyInterpreter = await anyPython(env)
  return {
    ok: false,
    missing: anyInterpreter ? 'scrapling' : 'python',
    reason: anyInterpreter
      ? '找到 Python 了，但它没有一个装了 scrapling（装法见下面的命令，可直接粘贴）'
      : '这台机器上没有可用的 Python（引擎需要 3.10+）',
  }
}

/** 只判断"有没有解释器"，不判断它装了什么 —— 用来区分上面两种缺失 */
export async function anyPython(env = process.env) {
  const candidates = [OUTSIDE_VENV_PYTHON, VENV_PYTHON].filter((f) => f)
  for (const file of candidates) if (await exists(file)) return file
  const fromEnv = String(env.IWB_SCRAPLING_PYTHON ?? '').trim()
  if (fromEnv && (await exists(fromEnv))) return fromEnv
  for (const c of ['python', 'py']) {
    if (await canRun(c)) return c
  }
  return ''
}

/** 解释器在不在（不问它装了什么） */
function canRun(cmd) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, ['--version'], { windowsHide: true })
    } catch {
      resolve(false)
      return
    }
    const timer = setTimeout(() => {
      child.kill()
      resolve(false)
    }, 15000)
    child.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
}

/**
 * 判停提示：**原样复制粘贴就能解决**，路径用实际推导出来的，不留 <占位符>。
 * 两种缺失分开写 —— 「请安装 Scrapling」那种没有命令的说法不算可照做。
 */
export function installHint({ missing = 'python', env = process.env } = {}) {
  const venv = OUTSIDE_VENV_PYTHON.replace(/[\\/][Ss]cripts[\\/][Pp]ython(\.exe)?$/, '')
  const py = env.IWB_SCRAPLING_PYTHON || 'python'
  if (missing === 'python') {
    return [
      '这台机器上没有可用的 Python，而 scrapling 引擎需要它（3.10+）。装一个：',
      '',
      '  winget install -e --id Python.Python.3.12',
      '     或到 https://www.python.org/downloads/ 下载安装包（勾选 Add to PATH）',
      '',
      '装完**重开一个终端**（PATH 要重新读），然后跑：',
      `  ${py} -m venv ${venv}`,
      `  ${venv}\\Scripts\\python.exe -m pip install -i https://mirrors.aliyun.com/pypi/simple/ "scrapling[all]"`,
      '',
      '浏览器内核不用下载：patchright 用的 chromium 与 Playwright 共用 %LOCALAPPDATA%\\ms-playwright 缓存。',
      '',
      '不想装 Python：BOSS 改用浏览器扩展采集（extension/），其余 26 个站点用默认路径，完全不碰 Python。',
    ].join(String.fromCharCode(10))
  }
  return [
    'Python 有了，但它没有一个装了 scrapling。复制下面两条就能装好（走阿里云镜像，约 1 分钟）：',
    '',
    `  ${py} -m venv ${venv}`,
    `  ${venv}\\Scripts\\python.exe -m pip install -i https://mirrors.aliyun.com/pypi/simple/ "scrapling[all]"`,
    '',
    '或者指一个已装 scrapling 的解释器给引擎：',
    `  set IWB_SCRAPLING_PYTHON=<那个环境>\\Scripts\\python.exe`,
    '',
    '浏览器内核不用下载：patchright 用的 chromium 与 Playwright 共用 %LOCALAPPDATA%\\ms-playwright 缓存。',
    '',
    '不想装 Python：BOSS 改用浏览器扩展采集（extension/），其余 26 个站点用默认路径，完全不碰 Python。',
  ].join(String.fromCharCode(10))
}

/** 跑一次 Python 引擎。进度走 stderr（直接透传给用户），结果走 stdout 的 JSON。 */
export function runScrapling({ python, login = false, keyword = '', pages = 1, limit = 60, city = '100010000', profileDir = SCRAPLING_PROFILE_DIR, decodeSalary = false, checkSalaryFont = false, timeoutMs = 1800000 }) {
  const args = [SCRAPLING_SCRIPT, '--profile', profileDir]
  if (login) args.push('--login')
  else {
    args.push('--keyword', keyword, '--pages', String(pages), '--limit', String(limit), '--city', city)
    // 薪资的字体混淆默认不解（政策线见 crawler/README.md）；只有显式开了才传这个旗标
    if (decodeSalary) args.push('--decode-salary')
    if (checkSalaryFont) args.push('--check-salary-font')
  }

  return new Promise((resolve, reject) => {
    // 参数以数组传递、不经 shell 展开，关键词里的空格与引号不会被拼成命令。
    // PYTHONIOENCODING 是第二道防线：引擎自己保证输出纯 ASCII（ensure_ascii），
    // 但「调用方保证环境」和「被调用方保证输出」是两道独立的防护 ——
    // 只靠一道，下次谁改了一处就复发。
    const child = spawn(python, args, {
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: false,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    let out = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error(`Python 引擎超时（${Math.round(timeoutMs / 60000)} 分钟），已终止`))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      let parsed = null
      try {
        parsed = JSON.parse(out)
      } catch {
        parsed = null
      }
      if (!parsed) {
        reject(new Error(`Python 引擎没吐出可解析的 JSON（退出码 ${code}），stderr 里应有原因`))
        return
      }
      resolve({ ...parsed, python_exit_code: code ?? parsed.exit_code ?? 0 })
    })
  })
}
