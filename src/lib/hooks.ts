import { useCallback, useEffect, useState } from 'react'
import { cloud, errText } from '../cloud'
import { listRows } from './api'
import type { ListOptions } from './api'
import { notifyErr } from './toast'
import type { Row } from '../types'

export interface Session {
  user?: { id?: string; email?: string } | null
}

/** 会话状态：登录后 database/storage 请求会自动携带身份 */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const res = await cloud.auth.getSession()
      if (!alive) return
      setSession(res.error ? null : (res.data as Session | null))
      setReady(true)
    })()
    const off = cloud.auth.onAuthStateChange((_event: string, s: Session | null) => {
      if (!alive) return
      setSession(s ?? null)
      setReady(true)
    })
    return () => {
      alive = false
      if (typeof off === 'function') off()
    }
  }, [])

  return { session, ready, signedIn: Boolean(session) }
}

/**
 * 通用表读取 hook。
 *
 * ⚠️ 目前全仓没有调用方（页面都直接用 `listRows` + 自己的 loading/错误处理）。
 * 保留它是因为签名与 `listRows` 对齐后可以就地复用；但 opts 的类型**必须**是
 * `ListOptions` 而不是手写的 `{order, ascending}` —— 手写的窄类型会让调用方传
 * `limit` / `filters` 时被 TS 静默丢弃（对象字面量的多余属性检查只在直接传字面量时生效，
 * 传变量就完全不报错），结果是「以为加了 limit，实际全表拉取」。
 */
export function useTable(table: string, opts: ListOptions = {}) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const { order, ascending, limit, filters } = opts
  // 依赖逐项列出：直接把 opts 对象放进依赖数组会每次渲染都触发重载。
  const filterKey = JSON.stringify(filters ?? [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await listRows(table, { order, ascending, limit, filters }))
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, order, ascending, limit, filterKey])

  useEffect(() => {
    void reload()
  }, [reload])

  return { rows, loading, reload, setRows }
}
