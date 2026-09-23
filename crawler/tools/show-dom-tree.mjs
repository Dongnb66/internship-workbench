/**
 * 一次性调试脚本：把候选组的 DOM 父子关系直接打出来，不再靠推断。
 * 用法：node dbg-tree.mjs <dump.html>
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const abs = path.resolve(process.argv[2])
const html = fs.readFileSync(abs, 'utf8')
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage()
await page.setContent(html, { waitUntil: 'domcontentloaded' })

const out = await page.evaluate(() => {
  const TITLE_WORDS =
    /(实习|工程师|开发|算法|产品|运营|设计|分析|研究|架构|测试|前端|后端|全栈|数据|研发|校招|招聘|专员|助理|经理|顾问|编辑|策划|讲师|医师|教师|销售|客服|法务|财务|人事|科学家|专家|Intern|intern)/
  const txt = (el) => String(el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim()
  const path = (el) => {
    const parts = []
    let p = el
    let d = 0
    while (p && p !== document.body && d < 6) {
      const cls = Array.from(p.classList || []).slice(0, 3).join('.')
      parts.unshift(`${p.tagName.toLowerCase()}${cls ? '.' + cls : ''}`)
      p = p.parentElement
      d++
    }
    return parts.join(' > ')
  }

  const groups = new Map()
  for (const el of document.querySelectorAll('li, article, section, tr, div')) {
    const t = txt(el)
    if (t.length < 12 || t.length > 1500) continue
    if (el.querySelectorAll('input, textarea, select').length > 3) continue
    if (!TITLE_WORDS.test(t)) continue
    const cls = Array.from(el.classList || [])
      .filter((c) => c.length > 0 && c.length < 40 && !/^(active|selected|on|hover|open|is-|js-|has-)/i.test(c))
      .sort()
      .join('.')
    const sig = `${el.tagName.toLowerCase()}|${cls}`
    if (!groups.has(sig)) groups.set(sig, [])
    groups.get(sig).push(el)
  }

  const res = []
  for (const [sig, list] of groups) {
    if (list.length < 4) continue
    const inner = list.filter((el) => !list.some((o) => o !== el && el.contains(o)))
    if (inner.length < 4) continue
    const parentEls = [...new Set(inner.map((el) => el.parentElement).filter(Boolean))]
    res.push({
      sig: sig.slice(0, 60),
      n: inner.length,
      parents: parentEls.length,
      // 父容器的文本长度（若父容器只是薄薄的 wrapper，长度≈卡片文本长度）
      parentTextLen: parentEls.map((p) => txt(p).length),
      parentPath: parentEls.slice(0, 2).map((p) => path(p)),
      sampleLen: txt(inner[0]).length,
    })
  }
  return res
})

for (const r of out.sort((a, b) => b.n - a.n)) {
  console.log(`\n=== ${r.sig}  n=${r.n} parents=${r.parents}`)
  console.log(` 卡片文本长度=${r.sampleLen}`)
  console.log(` 父容器文本长度=${JSON.stringify(r.parentTextLen.slice(0, 5))}`)
  r.parentPath.forEach((p) => console.log(` 父路径：${p}`))
}
await browser.close()
