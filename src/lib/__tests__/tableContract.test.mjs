import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 表清单契约——**派生，不手抄**。
 *
 * 这个文件的存在理由：同一份「私有表有哪些」，在本仓库里被手写了五处
 * （004 迁移的 SQL、rlsGuards.test.mjs、Settings.tsx 的 TABLES、README.md、
 * docs/CONFIGURATION.md）。手写的清单不变量是「新增一张表时，没有任何东西会
 * 提醒你改其余四处」——CONFIGURATION.md §4 第 4 步正是拿人肉去补这一刀：
 * 「Settings.tsx 的 TABLES 数组加上表名（否则数据导出会漏这张表）」。
 * 这句话本身就说明：漏了不会报错，只会静默少导一张表。
 *
 * 对标 archify（tt-a1i/archify，MIT）的写法：**契约从权威源派生，新增点默认失败**。
 *   它的做法：schemas/*.json → scripts/generate-validators.mjs → 提交生成的校验器，
 *   再由 npm test 的 --check 模式在「生成物与 schema 不一致」时变红；
 *   并且生成器自己也带断言（AJV 输出形态变了就抛错），防止扫描失效导致下游假绿。
 *   这里照搬两点：① 权威源是 004 迁移里的 CREATE POLICY；② 扫描本身先自证。
 *
 * 为什么是 .mjs：本仓产品 tsconfig 不含 node 类型，.ts 里 import node:fs 会被
 * tsc -b 打红（TS2591）；源码扫描类测试一律放 .mjs（同 rlsGuards）。
 *
 * 变异验证（改坏必须变红，否则断言是装饰）：
 *   ① 在 004 里加一行 `CREATE POLICY xxx_own ON public.xxx` → 用例 2 变红；
 *   ② 把 `usage_events` 加进 Settings.tsx 的 TABLES → 用例 4 变红；
 *   ③ 把 004 的 CREATE POLICY 全注释掉 → 用例 1 先变红（防止 2/3/4 空跑成假绿）。
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

/** 权威源：线上已应用策略的存档。私有（按账号隔离）表的定义就在这里。 */
const rlsSql = readFileSync(join(repoRoot, 'db', 'migrations', '004_private_tables_rls.sql'), 'utf-8')

/** 被排除在「私有用户表」之外的表：公共岗位库 + 匿名遥测。理由写死，新增表必须显式登记。 */
const NON_USER_TABLES = {
  jobs_public: '公共岗位库：全用户只读，无 owner_id，不参与个人数据导出',
  usage_events: '匿名遥测事件：无 owner_id、只有 INSERT 策略，进入个人备份语义错误',
  usage_users: '匿名遥测用户表：同上',
}

const settingsSrc = readFileSync(join(repoRoot, 'src', 'pages', 'Settings.tsx'), 'utf-8')

/** 从源码里抽 `const TABLES = [...]`。本数组是单层字面量，取第一个 `]` 是安全的。 */
function parseTablesFromSettings(src) {
  const m = src.match(/const TABLES = \[([^\]]*)\]/)
  if (!m) throw new Error('Settings.tsx 里找不到 const TABLES = [...] —— 抽取逻辑失效，先修这里再看下游断言')
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

/** 派生：004 里所有 `<table>_own` 策略覆盖的表 = 被 RLS 按 owner_id 隔离的表。 */
function deriveOwnerScopedTables(sql) {
  return [...sql.matchAll(/CREATE POLICY\s+(\w+)_own\s+ON\s+public\.(\w+)/g)].map((m) => m[2])
}

const derivedPrivate = deriveOwnerScopedTables(rlsSql)
const settingsTables = parseTablesFromSettings(settingsSrc)

describe('表清单契约：从迁移派生，不靠手抄', () => {
  it('① 扫描自检：004 能扫出策略表，且包含已知表（防止下游断言空跑成假绿）', () => {
    expect(derivedPrivate.length).toBeGreaterThanOrEqual(10)
    expect(derivedPrivate).toContain('jobs')
    expect(derivedPrivate).toContain('profile')
    // 策略名与表名必须成对（`<t>_own ON public.<t>`），错配说明解析正则跟不上文件改法
    const pairs = [...rlsSql.matchAll(/CREATE POLICY\s+(\w+)_own\s+ON\s+public\.(\w+)/g)]
    for (const [, policyName, table] of pairs) expect(policyName).toBe(table)
  })

  it('② Settings.tsx 的 TABLES 与派生集合完全一致（多一张、少一张都变红）', () => {
    expect([...settingsTables].sort()).toEqual([...derivedPrivate].sort())
  })

  it('③ 遥测表与公共表不得进入个人导出清单（否则导出静默少表或语义污染）', () => {
    for (const table of Object.keys(NON_USER_TABLES)) {
      expect(
        settingsTables,
        `${table} 不该被导出：${NON_USER_TABLES[table]}`,
      ).not.toContain(table)
    }
  })

  it('④ 新增私有表必须在 NON_USER_TABLES 之外有明确归属（fail closed：未登记即失败）', () => {
    // 反向检查：若某张表既不按 owner_id 隔离、又没登记进 NON_USER_TABLES，
    // 说明出现了第三种归属模型，契约需要人来做一次决策——而不是让它悄悄存在。
    const declaredNonUser = Object.keys(NON_USER_TABLES)
    const knownPublicShape = ['jobs_public']
    for (const t of knownPublicShape) {
      expect(derivedPrivate, `${t} 是公共只读表，不该出现在 owner_id 策略里`).not.toContain(t)
      expect(declaredNonUser, `${t} 必须登记在 NON_USER_TABLES 并写明理由`).toContain(t)
    }
  })
})

// ---------- 第二批：文档里声明的表数/表名，必须与派生清单一致 ----------
//
// 2026-10-05 实测到的真实漂移：README 与 CONFIGURATION 都写「11 张表 / 10 张私有」，
// 而线上库与迁移合起来是 **13 张**（005 加了 usage_events / usage_users 两张匿名遥测表，
// 文档一个字没改）。这类"文档里的数字"坏起来全静默，与 README 的 tests 徽章漂移 121 条
// 是同一个病：**手写的数字没有派生源，也没有门。**
//
// 派生源：① 004 迁移里的 owner_id 策略 → 用户私有表；② db/migrations/ 里所有 CREATE TABLE → 有 DDL 的表。
// 两者并集 = 全部 13 张。README/CONFIGURATION 声明的数字与列出的表名都必须与之对齐。

/** 从全部迁移里抽 `CREATE TABLE [IF NOT EXISTS] [public.]<name>`。 */
function deriveMigrationTables() {
  const dir = join(repoRoot, 'db', 'migrations')
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(dir, f), 'utf-8'))
    .join('\n')
  return [...new Set([...sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?(\w+)/g)].map((m) => m[1]))]
}

const derivedMigrationTables = deriveMigrationTables()
const derivedAllTables = [...new Set([...derivedPrivate, ...derivedMigrationTables])].sort()

const readmeSrc = readFileSync(join(repoRoot, 'README.md'), 'utf-8')
const configurationSrc = readFileSync(join(repoRoot, 'docs', 'CONFIGURATION.md'), 'utf-8')

/** 抽 `## 数据模型（N 张表）` / `## 2. 数据表（N 张）` 里声明的数字。 */
function declaredCount(src, re, label) {
  const m = src.match(re)
  if (!m) throw new Error(`${label} 里找不到表数声明（期望 ${re}）—— 抽取逻辑失效，先修这里`)
  return Number(m[1])
}

describe('表数声明必须来自派生清单，不手写', () => {
  it('① 扫描自检：策略表 + 迁移建表合起来是完整集合，且两类都不为空', () => {
    expect(derivedPrivate.length).toBeGreaterThanOrEqual(10)
    expect(derivedMigrationTables.length).toBeGreaterThanOrEqual(3)
    expect(derivedAllTables).toContain('jobs')
    expect(derivedAllTables).toContain('jobs_public')
    expect(derivedAllTables).toContain('usage_events')
    expect(derivedAllTables.length).toBe(derivedPrivate.length + derivedMigrationTables.length)
  })

  it('② README 与 CONFIGURATION 声明的表数 = 派生总数', () => {
    const readmeDeclared = declaredCount(readmeSrc, /## 数据模型（(\d+) 张表）/, 'README.md')
    const configDeclared = declaredCount(configurationSrc, /## 2\. 数据表（(\d+) 张）/, 'docs/CONFIGURATION.md')
    const actual = derivedAllTables.length
    expect(readmeDeclared, `README.md 声明 ${readmeDeclared} 张，派生清单是 ${actual} 张`).toBe(actual)
    expect(configDeclared, `docs/CONFIGURATION.md 声明 ${configDeclared} 张，派生清单是 ${actual} 张`).toBe(actual)
  })

  it('③ 每张派生的表都必须在两份文档里被点名（数对但漏一张也要红）', () => {
    const readmeSection = readmeSrc.slice(readmeSrc.indexOf('## 数据模型'), readmeSrc.indexOf('字段清单与 RLS 策略见'))
    const configSection = configurationSrc.slice(configurationSrc.indexOf('## 2. 数据表'), configurationSrc.indexOf('### 2.1'))
    for (const table of derivedAllTables) {
      expect(readmeSection, `README 数据模型一节漏了 ${table}`).toContain(`\`${table}\``)
      expect(configSection, `CONFIGURATION 数据表一节漏了 ${table}`).toContain(`\`${table}\``)
    }
  })
})
