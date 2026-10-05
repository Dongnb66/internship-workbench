/**
 * CI 配置不能指向一个不存在的分支。
 *
 * 为什么单独立这一条（2026-09-27 实抓到）：`.github/workflows/ci.yml` 的触发器写的是
 * `branches: [main]`，而这个仓库远端只有 `master`（`git ls-remote --heads origin` 只有一条
 * `refs/heads/master`，`origin/HEAD → origin/master`）。后果是**四道门一次都没在 CI 上跑过**，
 * 而症状是完全静默：Actions 页面不会变红，只会一直空着，谁都以为"有 CI 兜底"。
 * 本地跑是绿的，所以这个洞只有把"分支名"当成一条断言来查才会响。
 *
 * 修法是把两个分支名都列进触发器（这一族仓库里 main / master 都有人用），
 * 而不是改名 —— 改名会牵动发布源与已分享的链接，收益不抵代价。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
// here = <仓库根>/src/lib/__tests__ → 往上三级才是仓库根
const ciPath = path.join(here, '..', '..', '..', '.github', 'workflows', 'ci.yml')
const ci = readFileSync(ciPath, 'utf8')

/** 抓某个触发器下面的 `branches:` 列表；YAML 注释行必须先剔掉（第一版没剔，
 *  结果我自己加的那段解释性注释把解析器挡死了，报出"没解析出分支列表"——
 *  这正是上面那条 length 自检存在的理由：宁可红，不要静默零结果。 */
function branchList(label) {
  const block = new RegExp(`^  ${label}:\\s*$([\\s\\S]*?)^  \\S`, 'm').exec(ci)
  if (!block) return []
  const body = block[1]
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n')
  const inline = /branches:\s*\[([^\]]*)\]/.exec(body)
  if (inline) return inline[1].split(',').map((s) => s.trim()).filter(Boolean)
  return [...body.matchAll(/branches:\s*\n((?:\s*-\s+\S+\n?)+)/g)].flatMap((m) => [...m[1].matchAll(/-\s+(\S+)/g)].map((x) => x[1]))
}

describe('CI 触发器', () => {
  it('文件确实读到了（读空会让下面几条假绿）', () => {
    expect(ci).toContain('name: CI')
    expect(ci).toContain('on:')
  })

  it('push 与 pull_request 的分支列表都同时覆盖 main 和 master', () => {
    for (const label of ['push', 'pull_request']) {
      const list = branchList(label)
      expect(list.length, `${label} 没解析出分支列表`).toBeGreaterThan(0)
      expect(list, `${label} 必须包含 master（本仓库远端只有 master）`).toContain('master')
      expect(list, `${label} 必须包含 main（同族其他仓库用 main）`).toContain('main')
    }
  })

  it('四道门都在 CI 里跑，且构建产物缺失要报错而不是静默通过', () => {
    for (const step of ['npm run lint', 'npm run typecheck', 'npm run test', 'npm run build']) {
      expect(ci, `CI 缺了 ${step}`).toContain(step)
    }
    expect(ci).toContain('if-no-files-found: error')
  })

  it('日期口径的断言必须在非 UTC 时区再跑一遍（UTC+8 会把两端偏差抵消成假绿）', () => {
    // 2026-09-28 实抓到：契约测试「Web ↔ 小程序 daysLeft 两端同结果」在 CI（UTC）红，
    // 而本机（UTC+8）绿 —— 8 小时偏移正好让两侧各错半天、四舍五入后相等。
    // 所以「本地全绿」对这类断言没有证明力，必须换时区复跑；反过来，
    // 「纯日期串被当成 UTC 解释」那一类只在西半球出错，所以两个方向都要覆盖。
    expect(ci, 'CI 少了负偏移时区的复跑（西半球才会暴露 UTC 解释问题）').toMatch(/TZ=America\/New_York/)
    expect(ci, 'CI 少了 UTC+8 的复跑（本机默认时区，假绿就发生在这里）').toMatch(/TZ=Asia\/Shanghai/)
  })

  it('package-lock 与 package.json 同步 —— 否则 npm ci 第一步就把整条流水线打红', () => {
    // 真实踩到（2026-09-27）：升版本只改了 package.json，锁里还停在旧版本号，
    // CI 的 `npm ci` 在校验一致性时就退出，lint/typecheck/test/build 一步没跑到，
    // 而失败信息只在 Actions 日志里 —— 本地四道门全绿，谁都看不见。
    const pkg = JSON.parse(readFileSync(path.join(here, '..', '..', '..', 'package.json'), 'utf8'))
    const lock = JSON.parse(readFileSync(path.join(here, '..', '..', '..', 'package-lock.json'), 'utf8'))
    expect(lock.version, '锁的顶层 version 与 package.json 不一致').toBe(pkg.version)
    expect(lock.packages?.['']?.version, '锁的 packages[""] version 与 package.json 不一致').toBe(pkg.version)
    expect(lock.name).toBe(pkg.name)
  })

  it('tests 徽章的新鲜度门必须在 CI 里跑，且引用的脚本真实存在', () => {
    // 2026-10-05 实抓到：README 徽章写 `779 passed`，实际跑出 900 条，差 121 条。
    // 它是对外声称（简历/作品集都会抄这个数），却是一个纯手写字面量 —— 没有任何断言盯着它。
    // 这类"文档里的数字"坏起来全静默，所以必须像版本号一样进 CI 门。
    //
    // 这一条同时防两种删法：① 把 CI 步骤删了；② 把脚本从 package.json 里删了，
    // 只留 CI 里那一句 —— 后者会让 CI 报 "Missing script"，靠人去日志里翻。
    const pkg = JSON.parse(readFileSync(path.join(here, '..', '..', '..', 'package.json'), 'utf8'))
    expect(pkg.scripts?.['test:badge'], 'package.json 缺 test:badge（写徽章用）').toBeTruthy()
    expect(pkg.scripts?.['test:badge:check'], 'package.json 缺 test:badge:check（CI 校验用）').toBeTruthy()
    expect(ci, 'CI 缺了徽章新鲜度门（删掉它，徽章就会像 779 那样悄悄过期）').toContain('npm run test:badge:check')
  })
})
