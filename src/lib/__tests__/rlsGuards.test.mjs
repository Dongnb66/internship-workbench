import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 三条防线的守卫——简历与 README 的安全声明在这里对账，缺一条就红：
 *
 *   1. 归属绑定在数据库：私有表 RLS 策略 USING / WITH CHECK 双写
 *      （db/migrations/004_private_tables_rls.sql 是线上已应用策略的权威存档，
 *       没有这份文件，「WITH CHECK 双写」就只是一句口头声明）
 *   2. 前端不传 owner_id：产品代码（src 非测试）0 处出现 owner_id——
 *      归属列由数据库 DEFAULT auth.uid() 兜底，客户端传了也不该存在这个口子
 *   3. 写操作空返回即报错：RLS 拒写在 PostgREST 上的表现是「成功返回空数组」，
 *      不把它翻译成报错，用户就会以为保存成功了——insert/update/delete 三个
 *      写路径的空返回必须抛错
 *
 * 为什么是 .mjs：本仓产品 tsconfig 不含 node 类型，tsc -b 会把 import node:fs
 * 的 .ts 测试直接打红（TS2591）；源码扫描类测试一律放 .mjs（同 settingsModelPicker）。
 *
 * 变异验证约定：删掉任一防线（SQL 文件的 WITH CHECK 行 / src 里出现 owner_id /
 * api.ts 的空返回抛错），对应的断言必须变红；否则说明断言是装饰。
 */

// ---------- 防线 3 的 mock：链式 query 桩，await 时吐出当前 state ----------

const h = vi.hoisted(() => {
  const state = { data: [], error: null }
  const q = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit']) {
    q[m] = () => q
  }
  q.then = (onOk) => Promise.resolve({ data: state.data, error: state.error }).then(onOk)
  return { state, q }
})

vi.mock('../../cloud', () => ({
  cloud: { database: { from: () => h.q } },
  errText: (e) => `db-error:${String(e)}`,
}))

const { deleteRow, insertRow, updateRow } = await import('../api')

beforeEach(() => {
  h.state.data = []
  h.state.error = null
})

// ---------- 防线 3：写操作空返回即报错 ----------

describe('写操作空返回即报错（RLS 拒写不能伪装成成功）', () => {
  it('insert 空返回 → 抛「写入被拒绝」', async () => {
    h.state.data = []
    await expect(insertRow('jobs', { company: 'x' })).rejects.toThrow('写入被拒绝')
  })

  it('insert 有数据 → 正常返回首行（对照：不是「一律报错」，只有空才报错）', async () => {
    h.state.data = [{ id: 1, company: 'x' }]
    const row = await insertRow('jobs', { company: 'x' })
    expect(row).toEqual({ id: 1, company: 'x' })
  })

  it('update 空返回 → 抛「没有改动任何数据」', async () => {
    h.state.data = []
    await expect(updateRow('jobs', 1, { status: '已投' })).rejects.toThrow('没有改动任何数据')
  })

  it('delete 空返回 → 抛「删除失败」', async () => {
    h.state.data = []
    await expect(deleteRow('jobs', 1)).rejects.toThrow('删除失败')
  })

  it('db 返回 error 时原样抛出（不走空返回分支）', async () => {
    h.state.error = 'row-level security violation'
    await expect(insertRow('jobs', { company: 'x' })).rejects.toThrow('db-error:row-level security violation')
  })
})

// ---------- 防线 1 & 2：源码/迁移扫描 ----------

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

function scanSrcFiles(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== '__tests__') out.push(...scanSrcFiles(p))
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

describe('防线 1：私有表 RLS USING / WITH CHECK 双写有权威存档', () => {
  const sql = readFileSync(join(repoRoot, 'db', 'migrations', '004_private_tables_rls.sql'), 'utf-8')

  it('十张私有表各有 <table>_own 策略', () => {
    const tables = [
      'jobs', 'applications', 'interviews', 'offers', 'resumes',
      'tasks', 'ai_reports', 'messages', 'knowledge', 'profile',
    ]
    for (const t of tables) {
      expect(sql, `缺少策略 ${t}_own`).toContain(`CREATE POLICY ${t}_own ON public.${t}`)
    }
  })

  it('每条策略都是 USING + WITH CHECK 双写，缺一不可', () => {
    const policies = sql.split('CREATE POLICY').slice(1)
    expect(policies.length).toBeGreaterThanOrEqual(10)
    for (const p of policies) {
      expect(p, '策略缺 USING').toContain('USING (owner_id = auth.uid())')
      expect(p, '策略缺 WITH CHECK——没有它，UPDATE 可把行改成别人的 owner_id，等于越权后门').toContain(
        'WITH CHECK (owner_id = auth.uid())',
      )
    }
  })

  it('每张表都显式 ENABLE ROW LEVEL SECURITY', () => {
    const enabled = sql.match(/ENABLE ROW LEVEL SECURITY/g) ?? []
    expect(enabled.length).toBeGreaterThanOrEqual(10)
  })

  it('公共岗位库不在这份文件里（只读例外走 001 的另一套，SELECT-only）', () => {
    expect(sql).not.toContain('jobs_public')
    const sql001 = readFileSync(join(repoRoot, 'db', 'migrations', '001_jobs_public.sql'), 'utf-8')
    expect(sql001).toContain('FOR SELECT')
    expect(sql001).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/)
  })
})

describe('防线 2：前端不传 owner_id（归属列由数据库 DEFAULT auth.uid() 兜底）', () => {
  it('src 产品代码（非测试）0 处出现 owner_id', () => {
    const offenders = []
    for (const f of scanSrcFiles(join(repoRoot, 'src'))) {
      if (/owner_id/.test(readFileSync(f, 'utf-8'))) offenders.push(f)
    }
    expect(offenders, `产品代码出现 owner_id 的文件：${offenders.join(', ')}`).toEqual([])
  })
})
