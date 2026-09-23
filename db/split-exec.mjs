#!/usr/bin/env node
/**
 * 生成「一次一条」的可执行语句包（db/exec/）。
 *
 * 为什么需要它：执行通道（PostgREST / MCP exec_sql）**只接受单语句**，
 * 多语句会报 `cannot insert multiple commands into a prepared statement`。
 * 所以建表这件事不能靠「复制一大段 SQL 粘进去」，必须拆成一条一个请求。
 *
 * 本脚本把 migrations + seed（build-seed.mjs 的产出）拆成编号文件，
 * 每个文件恰好一条语句，可直接逐条执行，也可被脚本按序读取。
 *
 * 用法：
 *   node db/split-exec.mjs           # 生成 db/exec/*.sql + manifest.json
 *   node db/split-exec.mjs --check   # 只校验切分，不写文件
 *
 * ⚠️ 关于「语法校验」的已知坑：
 *   用纯 JS 解析器（如 pgsql-ast-parser）校验这些语句时会报 4 条「语法错误」——
 *   那**不是** SQL 写错了，是解析器没实现这几条 PG 专有 DDL：
 *     ALTER TABLE … ENABLE ROW LEVEL SECURITY / GRANT / DROP POLICY / CREATE POLICY
 *   对照组（ALTER TABLE ADD COLUMN、DROP TABLE、CREATE TABLE）都能正常解析。
 *   别因为解析器报错就去「修」这几条语句 —— 它们是对的。
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const execDir = join(here, 'exec')
const checkOnly = process.argv.includes('--check')

/** 按分号切语句，但尊重字符串字面量与 $$ 引号块（避免把 'a;b' 切断） */
function splitStatements(sql) {
  const out = []
  let buf = ''
  let inSingle = false
  let dollarTag = null
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]
    const rest = sql.slice(i)

    // $$ 或 $tag$ 引号块
    if (!inSingle) {
      const m = /^\$([A-Za-z_]*)\$/.exec(rest)
      if (m) {
        const tag = m[0]
        if (dollarTag === null) dollarTag = tag
        else if (dollarTag === tag) dollarTag = null
        buf += tag
        i += tag.length - 1
        continue
      }
    }
    if (dollarTag !== null) {
      buf += ch
      continue
    }

    if (ch === "'") {
      // 处理 '' 转义
      if (inSingle && sql[i + 1] === "'") {
        buf += "''"
        i += 1
        continue
      }
      inSingle = !inSingle
      buf += ch
      continue
    }
    if (ch === '-' && !inSingle && rest.startsWith('--')) {
      // 行注释：整行丢弃
      const nl = sql.indexOf('\n', i)
      i = nl === -1 ? sql.length : nl - 1
      continue
    }
    if (ch === ';' && !inSingle) {
      if (buf.trim()) out.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

const sources = [
  { file: join(here, 'migrations', '001_jobs_public.sql'), phase: 'schema' },
  { file: join(here, 'seed.sql'), phase: 'seed' },
]

const entries = []
for (const { file, phase } of sources) {
  if (!existsSync(file)) {
    console.error(`✗ 缺少文件：${file}`)
    process.exit(1)
  }
  const stmts = splitStatements(readFileSync(file, 'utf8'))
  for (const sql of stmts) entries.push({ phase, sql, from: file.replace(here + '\\', '').replace(here + '/', '') })
}

if (!entries.length) {
  console.error('✗ 没解析出任何语句 —— 检查源文件是否为空')
  process.exit(1)
}

// 自检：拆出来的语句不能再含分号结尾以外的裸分号（说明切分有误）
for (const [i, e] of entries.entries()) {
  if (e.sql.includes(';\n') || /;\s*.+/.test(e.sql)) {
    console.error(`✗ 第 ${i + 1} 条疑似没切干净：\n${e.sql.slice(0, 200)}`)
    process.exit(1)
  }
}

if (checkOnly) {
  console.log(`✓ 解析出 ${entries.length} 条语句，切分自检通过`)
  process.exit(0)
}

rmSync(execDir, { recursive: true, force: true })
mkdirSync(execDir, { recursive: true })

const manifest = []
entries.forEach((e, i) => {
  const n = String(i + 1).padStart(3, '0')
  const name = `${n}_${e.phase}.sql`
  const header = `-- ${name} · ${e.phase} · 来源 ${e.from}\n-- 执行方式：单条语句，一次一个请求（不要多条拼接）\n\n`
  writeFileSync(join(execDir, name), header + e.sql + '\n')
  manifest.push({ order: i + 1, file: name, phase: e.phase, sql: e.sql })
})

writeFileSync(join(execDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

const byPhase = entries.reduce((a, e) => ((a[e.phase] = (a[e.phase] ?? 0) + 1), a), {})
console.log(`✓ 生成 ${entries.length} 条语句 → db/exec/`)
for (const [k, v] of Object.entries(byPhase)) console.log(`  ${k}: ${v} 条`)
console.log('  另有 manifest.json（含每条原始 SQL，供按序执行）')
