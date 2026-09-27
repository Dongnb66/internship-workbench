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
})
