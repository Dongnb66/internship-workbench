import { useCallback, useEffect, useState } from 'react'
import { cloud, errText } from '../cloud'
import { listRows } from './api'
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

export function useTable(table: string, opts: { order?: string; ascending?: boolean } = {}) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await listRows(table, opts))
    } catch (error) {
      notifyErr(errText(error))
    } finally {
      setLoading(false)
    }
  }, [table, opts.order, opts.ascending])

  useEffect(() => {
    void reload()
  }, [reload])

  return { rows, loading, reload, setRows }
}
