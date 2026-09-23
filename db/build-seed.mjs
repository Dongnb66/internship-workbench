#!/usr/bin/env node
/**
 * 生成岗位广场的种子数据 SQL。
 *
 * 为什么是「生成 SQL」而不是「直接写库」：云上只有数据库，没有跑迁移的后端进程，
 * 灌数据要么走工作台的 exec_sql，要么由人手工在数据库面板里执行。两条路都需要
 * 一份可复读、可评审的 SQL —— 所以源数据放在 db/seed/*.json（可提交、可 diff），
 * 由本脚本转成语句。
 *
 * 用法：
 *   node db/build-seed.mjs                 # 打印到 stdout
 *   node db/build-seed.mjs > db/seed.sql   # 存成文件
 *
 * JSON 里的字段来自 crawler/output/*.json（真实抓取产出），但**导入前必须清洗**：
 * 抓取器早期版本会把「市场 ｜ 应届毕业生 ｜CDG」这种标签行当成公司名，
 * 直接用会往公共库灌脏数据。本脚本会拒绝明显像标签行的公司名。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const seedDir = join(here, 'seed')

/** 字符串 → SQL 字面量（单引号转义），null / undefined → NULL */
function lit(value) {
  if (value === null || value === undefined || value === '') return 'NULL'
  return `'${String(value).replace(/'/g, "''")}'`
}

/** 文本数组 → Postgres 数组字面量 */
function arr(values) {
  const list = (values ?? []).map((v) => String(v).trim()).filter(Boolean)
  if (!list.length) return 'NULL'
  return `ARRAY[${list.map(lit).join(', ')}]`
}

/**
 * 公司名挡板：带竖线的行是「岗位方向 ｜ 招聘对象 ｜ 事业群」三段式标签，
 * 不是公司名。宁可拒绝导入，也不把脏数据写进公共库（公共库脏了影响所有人）。
 */
function assertClean(job, file) {
  const company = String(job.company ?? '')
  const title = String(job.title ?? '')
  if (!company.trim()) throw new Error(`${file}: 有一条岗位缺公司名（title=${title}）`)
  if (!title.trim()) throw new Error(`${file}: 有一条岗位缺岗位名（company=${company}）`)
  if (/[｜|]/.test(company)) {
    throw new Error(`${file}: 公司名像标签行而不是公司：「${company}」。请先清洗抓取产出再导入。`)
  }
  if (company.length > 60) throw new Error(`${file}: 公司名过长（${company.length} 字）：「${company}」`)
  return true
}

function loadSeed() {
  let files = []
  try {
    files = readdirSync(seedDir).filter((f) => f.endsWith('.json')).sort()
  } catch {
    throw new Error(`找不到种子目录：${seedDir}`)
  }
  const rows = []
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(seedDir, file), 'utf8'))
    const list = Array.isArray(raw) ? raw : (raw.jobs ?? [])
    for (const job of list) {
      assertClean(job, file)
      rows.push(job)
    }
  }
  return rows
}

function toSql(rows) {
  if (!rows.length) return '-- 没有种子数据\n'
  const cols = [
    'company', 'title', 'city', 'job_type', 'industry', 'education',
    'salary', 'source', 'url', 'jd_text', 'tags', 'deadline', 'posted_at',
  ]
  const values = rows.map((j) => {
    const cells = [
      lit(j.company),
      lit(j.title),
      lit(j.city),
      lit(j.job_type) === 'NULL' ? "'实习'" : lit(j.job_type),
      lit(j.industry) === 'NULL' ? "'互联网'" : lit(j.industry),
      lit(j.education),
      lit(j.salary),
      lit(j.source),
      lit(j.url),
      lit(j.jd_text),
      arr(j.tags),
      lit(j.deadline),
      lit(j.posted_at ?? new Date().toISOString()),
    ]
    return `  (${cells.join(', ')})`
  })

  return [
    '-- 岗位广场种子数据（由 db/build-seed.mjs 生成，请勿手工编辑）',
    `-- 共 ${rows.length} 条 · 源数据在 db/seed/*.json`,
    '-- 先清空再灌：广场是公共只读库，重复执行不应产生重复行',
    'DELETE FROM jobs_public;',
    '',
    `INSERT INTO jobs_public (${cols.join(', ')}) VALUES`,
    values.join(',\n') + ';',
    '',
  ].join('\n')
}

const sql = toSql(loadSeed())
process.stdout.write(sql)
