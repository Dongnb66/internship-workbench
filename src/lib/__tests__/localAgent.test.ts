import { afterEach, describe, expect, it, vi } from 'vitest'
import { guessFromBlock, splitJobBlocks } from '../import'
import {
  AGENT_BASE,
  AGENT_DOWNLOAD_URL,
  AGENT_PORTABLE_URL,
  bridgeUrl,
  isBridgeMessage,
  AgentTimeoutError,
  freshOutputs,
  getSchedule,
  getTask,
  jobsToImportText,
  saveSchedule,
  scheduleDirty,
  listOutputs,
  listSites,
  lnaHelpFor,
  lnaPermissionState,
  PROBE_TIMEOUT_MS,
  probe,
  startCrawl,
  type AgentJob,
  type CrawlTask,
} from '../localAgent'

/**
 * 网页端 ↔ 本地助手的**接口契约**测试。
 *
 * 助手是跑在用户本机的独立进程（crawler/agent/server.mjs），这里既不真起服务、
 * 更不真跑爬虫（CI 里没有浏览器）—— 用桩 fetch 按契约文档里的**示例响应**回放，
 * 断言网页端一侧：
 * 1) 打的 URL / 方法 / 请求体与契约一致；
 * 2) 契约示例能原样解析成类型化返回值（字段名、类型、state 取值）；
 * 3) 400/409 的 error 文案要抛给人看（并发冲突必须提示，不许静默）；
 * 4) jobs → 导入文本的拼接，用既有的 splitJobBlocks + guessFromBlock 能无损读回
 *    —— 这就是「拼成现有导入格式、走既有批量导入」的机器证明。
 */

/** 契约文档 GET /health 的示例响应 */
const HEALTH = {
  ok: true,
  service: '实习工作台 · 本地抓取助手',
  crawler: 'D:\\...\\crawler',
  busy: null,
  outputs: ['hikvision__实习-2026-10-02_1050.json'],
}

/** 契约文档 GET /sites 的示例响应 */
const SITES_BODY = {
  sites: [{ id: 'hikvision', name: '海康威视招聘', needsLogin: false, verified: 'live', kwSearch: false }],
}

/** 契约文档 GET /crawl/:id 的 done 示例（state=running 时 result 必须是 null，一并在类型里钉住） */
const DONE_TASK: CrawlTask = {
  id: 'a1b2c3d4',
  args: '--site hikvision --keyword 实习 --pages 1 --limit 20 --mode all --detail 0',
  state: 'done',
  startedAt: 1759300000000,
  endedAt: 1759300018000,
  log: ['▶ 海康威视招聘 · 实习', '第 1 页：读到 5 条', '✅ 完成'],
  error: null,
  result: {
    outputs: [
      {
        file: 'hikvision__实习-2026-10-02_1050.json',
        site: 'hikvision',
        count: 5,
        jobs: [{ company: '海康威视', title: '音频算法工程师', city: '杭州', salary: '', url: 'https://campushr.hikvision.com/JobDetails.html?id=abc' }],
      },
    ],
  },
}

interface StubResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

type Handler = (url: string, init?: RequestInit) => Promise<StubResponse>

function stubFetch(handler: Handler): ReturnType<typeof vi.fn> {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init))
  vi.stubGlobal('fetch', mock as unknown as typeof fetch)
  return mock
}

function jsonRes(status: number, body: unknown): StubResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /health 探测', () => {
  it('打的是 /health，响应按契约解析（busy 为 null 表示空闲）', async () => {
    const mock = stubFetch(async (url) => {
      expect(url).toBe(`${AGENT_BASE}/health`)
      return jsonRes(200, HEALTH)
    })
    const health = await probe()
    expect(mock).toHaveBeenCalledTimes(1)
    expect(health.ok).toBe(true)
    expect(typeof health.service).toBe('string')
    expect(typeof health.crawler).toBe('string')
    expect(health.busy).toBeNull()
    expect(Array.isArray(health.outputs)).toBe(true)
  })

  it('下载入口常量只能是「空」或 https 的文件直链 —— 不允许占位符上线', () => {
    // 空 = 不显示下载入口。平台托管后填直链；这里挡的是 TODO / 相对路径 / HTML 中间页这类值。
    // 主入口是**安装包 .exe**（双击即装）；手动那条路仍是 .zip。
    // 先落到 string 再比：常量是字面量类型，直接与 '' 比会被 TS 判成「不可能的比较」（TS2367）。
    const setup: string = AGENT_DOWNLOAD_URL
    expect(setup === '' || /^https:\/\/\S+\.(exe|zip)$/.test(setup)).toBe(true)
    const portable: string = AGENT_PORTABLE_URL
    expect(portable === '' || /^https:\/\/\S+\.zip$/.test(portable)).toBe(true)
  })

  it('自检字段（ready / problems）按契约透传；老版本助手不回这两个字段也不能炸', async () => {
    stubFetch(async () =>
      jsonRes(200, {
        ...HEALTH,
        ready: false,
        problems: [{ code: 'missing-deps', message: '缺依赖 playwright-core', fix: '在 …\\crawler 里 npm install' }],
      }),
    )
    const bad = await probe()
    expect(bad.ready).toBe(false)
    expect(bad.problems?.[0]?.code).toBe('missing-deps')
    expect(typeof bad.problems?.[0]?.fix).toBe('string')

    stubFetch(async () => jsonRes(200, HEALTH))
    const old = await probe()
    expect(old.ready).toBeUndefined()
    expect(old.problems).toBeUndefined()
  })

  it('助手没启动（fetch 直接拒绝）：报错文案里带可执行的启动命令', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(probe()).rejects.toThrow('npm run agent')
  })
})

describe('GET /sites 站点表', () => {
  it('站点字段按契约：id/name/needsLogin/verified/kwSearch', async () => {
    const mock = stubFetch(async (url) => {
      expect(url).toBe(`${AGENT_BASE}/sites`)
      return jsonRes(200, SITES_BODY)
    })
    const sites = await listSites()
    expect(mock).toHaveBeenCalledTimes(1)
    expect(sites).toHaveLength(1)
    const [s] = sites
    expect(s.id).toBe('hikvision')
    expect(typeof s.name).toBe('string')
    expect(typeof s.needsLogin).toBe('boolean')
    expect(['live', 'offline', '']).toContain(s.verified)
    expect(typeof s.kwSearch).toBe('boolean')
  })
})

describe('POST /crawl 发起抓取', () => {
  it('请求体与契约字段一一对应；回传 taskId + command（command 必须在，界面要展示）', async () => {
    const mock = stubFetch(async (url, init) => {
      expect(url).toBe(`${AGENT_BASE}/crawl`)
      expect(init?.method).toBe('POST')
      return jsonRes(202, { taskId: 'a1b2c3d4', command: 'node run.mjs --site hikvision --keyword 实习 --pages 1 --limit 20 --mode all --detail 0' })
    })
    const res = await startCrawl({ sites: ['hikvision'], keyword: '实习', pages: 1, limit: 20, mode: 'all' })
    const body = JSON.parse(String(mock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body).toEqual({ sites: ['hikvision'], keyword: '实习', pages: 1, limit: 20, mode: 'all', detail: 0 })
    expect(res.taskId).toBe('a1b2c3d4')
    expect(typeof res.command).toBe('string')
    expect(res.command.startsWith('node ')).toBe(true)
  })

  it('400：契约的 error 文案原样抛出', async () => {
    stubFetch(async () => jsonRes(400, { error: 'sites 不能为空' }))
    await expect(startCrawl({ sites: [] })).rejects.toThrow('sites 不能为空')
  })

  it('409 并发冲突：提示而不是静默失败', async () => {
    stubFetch(async () => jsonRes(409, { error: '已经有一个抓取在跑（a1b2c3d4）' }))
    await expect(startCrawl({ sites: ['hikvision'] })).rejects.toThrow('已经有一个抓取在跑')
  })

  it('错误响应没有 JSON body 时，退回到 HTTP 状态码文案而不是 undefined', async () => {
    stubFetch(async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json') } }))
    await expect(probe()).rejects.toThrow('HTTP 502')
  })
})

describe('GET /crawl/:id 任务结构', () => {
  it('字段名、类型与 state 取值按契约钉死；done 时 result.outputs[].jobs 五字段齐全', async () => {
    const mock = stubFetch(async (url) => {
      expect(url).toBe(`${AGENT_BASE}/crawl/a1b2c3d4`)
      return jsonRes(200, DONE_TASK)
    })
    const task = await getTask('a1b2c3d4')
    expect(mock).toHaveBeenCalledTimes(1)
    expect(['running', 'done', 'failed']).toContain(task.state)
    expect(typeof task.id).toBe('string')
    expect(typeof task.args).toBe('string')
    expect(typeof task.startedAt).toBe('number')
    expect(task.endedAt).toBeTypeOf('number')
    expect(Array.isArray(task.log)).toBe(true)
    expect(task.error).toBeNull()
    expect(task.result).not.toBeNull()
    for (const out of task.result?.outputs ?? []) {
      expect(typeof out.file).toBe('string')
      expect(typeof out.site).toBe('string')
      expect(typeof out.count).toBe('number')
      for (const job of out.jobs) {
        for (const key of ['company', 'title', 'city', 'salary', 'url'] as const) {
          expect(typeof job[key], `job.${key} 必须是字符串`).toBe('string')
        }
      }
    }
  })

  it('running 时 result 为 null（契约：result 只在 done 时非 null）', async () => {
    stubFetch(async () =>
      jsonRes(200, { ...DONE_TASK, state: 'running', endedAt: null, result: null, error: null }),
    )
    const task = await getTask('a1b2c3d4')
    expect(task.state).toBe('running')
    expect(task.result).toBeNull()
  })
})

describe('jobs → 现有导入文本格式', () => {
  const jobs: AgentJob[] = [
    {
      company: '某某科技',
      title: '后端开发实习生',
      city: '深圳',
      salary: '180-250/天',
      url: 'https://example.com/job/123',
      raw: '岗位职责\n1. 负责后端服务开发',
    },
    { company: '另一家', title: '前端实习生', city: '杭州', salary: '', url: '', deadline: '2026-10-15' },
  ]

  it('拼出的文本用既有 splitJobBlocks + guessFromBlock 能无损读回（复用批量导入的前提）', () => {
    const text = jobsToImportText(jobs)
    const blocks = splitJobBlocks(text)
    expect(blocks.length).toBe(2)

    const [a, b] = blocks.map(guessFromBlock)
    expect(a.company).toBe('某某科技')
    expect(a.title).toBe('后端开发实习生')
    expect(a.city).toBe('深圳')
    expect(a.salary).toBe('180-250/天')
    expect(a.url).toBe('https://example.com/job/123')
    expect(a.jd_text).toContain('负责后端服务开发')

    expect(b.company).toBe('另一家')
    expect(b.title).toBe('前端实习生')
    expect(b.city).toBe('杭州')
    expect(b.salary).toBe('')
    expect(b.deadline).toBe('2026-10-15')
  })

  it('契约示例的最小五字段（不带 deadline/raw）也不丢信息', () => {
    const text = jobsToImportText([{ company: '某某科技', title: '后端开发实习生', city: '深圳', salary: '180-250/天', url: 'https://example.com/job/123' }])
    expect(text).toContain('公司：某某科技')
    expect(text).toContain('岗位：后端开发实习生')
    expect(text).toContain('工作地点：深圳')
    expect(text).toContain('薪资：180-250/天')
    expect(text).toContain('https://example.com/job/123')
  })

  it('空数组 / 全空字段不产生垃圾块', () => {
    expect(jobsToImportText([])).toBe('')
    expect(jobsToImportText([{ company: '', title: '', city: '', salary: '', url: '' }])).toBe('')
  })
})

describe('请求被浏览器权限闸门挂住时，探测不能永远不返回', () => {
  it('fetch 既不 resolve 也不 reject（LNA：127.0.0.1 的本地网络权限没给）：到 deadline 必须抛错，界面才落得到 off', async () => {
    vi.useFakeTimers()
    try {
      stubFetch(
        (_url, init) =>
          new Promise<StubResponse>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })),
            )
          }),
      )
      const pending = probe()
      const assertion = expect(pending).rejects.toThrow('没有响应')
      // 界面的下一步指引靠**类型**分岔（超时 → 去浏览器放行本地网络权限；连不上 → 去启动助手），
      // 所以类型也要钉住，别只钉文案。
      const typed = expect(pending).rejects.toBeInstanceOf(AgentTimeoutError)
      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + 1)
      await assertion
      await typed
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('只导本次产出（抓取前后的 output/ 快照）', () => {
  it('文件名不在快照里 → 本次新建，保留', () => {
    const all = [{ file: 'new.json' }, { file: 'old.json' }]
    const before = new Map([['old.json', 100]])
    expect(freshOutputs(all, before, new Map([['new.json', 200], ['old.json', 100]]))).toEqual([{ file: 'new.json' }])
  })

  it('同名但 mtime 变新 → 本次重写，保留', () => {
    const all = [{ file: 'same.json' }]
    expect(freshOutputs(all, new Map([['same.json', 100]]), new Map([['same.json', 300]]))).toEqual([{ file: 'same.json' }])
  })

  it('实测场景：本次 0 条新增（爬虫去重跳过、不写文件）→ 必须返回空，不许拿旧文件冒充新结果', () => {
    // 2026-10-03 真机：第二次抓同一站点+关键词，日志「与历史产出重复 5 条 / 0 条」，output/ 的 mtime 一个都没变
    const all = [{ file: 'hikvision__前端-2026-10-03_2304.json' }, { file: 'hikvision-2026-10-03_2029.json' }]
    const before = new Map([['hikvision__前端-2026-10-03_2304.json', 15_04_06], ['hikvision-2026-10-03_2029.json', 12_29_39]])
    expect(freshOutputs(all, before, before)).toEqual([])
  })

  it('快照没取到（null）→ 原样返回，退化成旧行为，绝不把结果吞掉', () => {
    const all = [{ file: 'a.json' }, { file: 'b.json' }]
    expect(freshOutputs(all, null)).toEqual(all)
  })

  it('空产出不炸', () => {
    expect(freshOutputs([], new Map([['x.json', 1]]))).toEqual([])
  })
})

describe('定时抓取（/schedule）', () => {
  const SCHEDULE = {
    enabled: true,
    at: '09:00',
    sites: ['hikvision'],
    keyword: '前端',
    pages: 1,
    limit: 20,
    mode: 'all',
    lastRun: { day: '2026-10-04', at: '2026-10-04T01:00:00.000Z', ok: true, newJobs: 5, files: ['a.json'], taskId: 'abc123' },
  }

  it('GET /schedule 按契约解析（含 summary 与 lastRun.taskId）', async () => {
    const mock = stubFetch(async (url) => {
      expect(url).toBe(`${AGENT_BASE}/schedule`)
      return jsonRes(200, { schedule: SCHEDULE, summary: { enabled: true, text: '每天 09:00 抓 1 个站点' } })
    })
    const r = await getSchedule()
    expect(mock).toHaveBeenCalledTimes(1)
    expect(r.schedule.at).toBe('09:00')
    expect(r.schedule.lastRun?.newJobs).toBe(5)
    expect(r.schedule.lastRun?.taskId).toBe('abc123')
    expect(r.summary.text).toContain('09:00')
  })

  it('POST /schedule 原样把配置交给助手（校验在服务端，前端不重复一套）', async () => {
    let sent: any = null
    const mock = stubFetch(async (url, init) => {
      expect(url).toBe(`${AGENT_BASE}/schedule`)
      expect(init?.method).toBe('POST')
      sent = JSON.parse(String(init?.body))
      return jsonRes(200, { schedule: SCHEDULE, summary: { enabled: true, text: 'ok' } })
    })
    await saveSchedule({ enabled: true, at: '09:00', sites: ['hikvision'], keyword: '前端', pages: 1, limit: 20, mode: 'all' })
    expect(mock).toHaveBeenCalledTimes(1)
    expect(sent).toEqual({ enabled: true, at: '09:00', sites: ['hikvision'], keyword: '前端', pages: 1, limit: 20, mode: 'all' })
  })

  it('有改动未保存：编辑中的值和已保存的不一样就该提示（保存失败也不再假装成功）', () => {
    const saved = { enabled: true, at: '09:00', sites: ['hikvision'], keyword: '前端' }
    expect(scheduleDirty(saved, saved)).toBe(false)
    expect(scheduleDirty(saved, { ...saved, enabled: false })).toBe(true)
    expect(scheduleDirty(saved, { ...saved, at: '10:00' })).toBe(true)
    expect(scheduleDirty(saved, { ...saved, keyword: '后端' })).toBe(true)
    expect(scheduleDirty(saved, { ...saved, sites: ['hikvision', 'tencent'] })).toBe(true)
    expect(scheduleDirty(saved, { ...saved, sites: ['tencent'] })).toBe(true)

    // 站点是集合：换个顺序不算改动（真机验证时发现的假「未保存」提示）
    const two = { ...saved, sites: ['hikvision', 'tencent'] }
    expect(scheduleDirty(two, { ...two, sites: ['tencent', 'hikvision'] })).toBe(false)
    expect(scheduleDirty(null, saved)).toBe(true)
  })

  it('助手不认 /schedule（老包）时抛错 —— 界面据此不给这个功能', async () => {
    stubFetch(async () => jsonRes(404, { error: 'not found' }))
    await expect(getSchedule()).rejects.toThrow('not found')
  })
})

describe('桥接窗口（绕过 LNA 权限）', () => {
  it('桥接页地址把工作台 origin 与 nonce 带过去（都要 URL 编码）', () => {
    const url = bridgeUrl('http://127.0.0.1:8787', 'https://internship-workbench-47024.app.workbuddy.host', 'n 1')
    expect(url.startsWith('http://127.0.0.1:8787/bridge?')).toBe(true)
    expect(url).toContain('origin=https%3A%2F%2Finternship-workbench-47024.app.workbuddy.host')
    expect(url).toContain('nonce=n%201')
  })

  it('只认自己那次 open 的 nonce —— 别的页面塞消息进来一律不认', () => {
    expect(isBridgeMessage({ type: 'iw-bridge-ready', nonce: 'abc' }, 'abc')).toBe(true)
    expect(isBridgeMessage({ type: 'iw-bridge-response', nonce: 'abc', id: '1' }, 'abc')).toBe(true)
    expect(isBridgeMessage({ type: 'iw-bridge-ready', nonce: 'other' }, 'abc')).toBe(false)
    expect(isBridgeMessage({ type: 'iw-bridge-response', nonce: 'abc' }, 'abc')).toBe(false) // 缺 id
    // 桥接页自报错误也要认（否则「脚本没跑起来」只能表现为超时）
    expect(isBridgeMessage({ type: 'iw-bridge-error', nonce: 'abc', message: 'boom' }, 'abc')).toBe(true)
    expect(isBridgeMessage({ type: 'iw-bridge-error', nonce: 'abc' }, 'abc')).toBe(false)
    expect(isBridgeMessage(null, 'abc')).toBe(false)
    expect(isBridgeMessage('ready', 'abc')).toBe(false)
  })
})

describe('浏览器本地网络访问（LNA）指引', () => {
  it('GET /outputs 读的是 files 字段（不是 outputs）', async () => {
    const mock = stubFetch(async (url) => {
      expect(url).toBe(`${AGENT_BASE}/outputs`)
      return jsonRes(200, { files: [{ name: 'hikvision__前端-2026-10-03_2304.json', size: 4096, mtime: 1759503840000 }] })
    })
    const files = await listOutputs()
    expect(mock).toHaveBeenCalledTimes(1)
    expect(files).toEqual([{ name: 'hikvision__前端-2026-10-03_2304.json', size: 4096, mtime: 1759503840000 }])
  })

  it('助手不认 /outputs 时抛错（调用方据此退化成旧行为，不吞结果）', async () => {
    stubFetch(async () => jsonRes(404, { error: '没有这个路由' }))
    await expect(listOutputs()).rejects.toThrow('没有这个路由')
  })

  it('Edge / Chrome / 其它各给对应设置路径与地址', () => {
    const edge = lnaHelpFor('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0')
    expect(edge.browser).toBe('Edge')
    expect(edge.deepLink).toContain('loopbackNetwork')
    expect(edge.path).toContain('设备上的应用')

    const chrome = lnaHelpFor('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36')
    expect(chrome.browser).toBe('Chrome')
    expect(chrome.deepLink).toContain('localNetworkAccess')

    const other = lnaHelpFor('Mozilla/5.0 夸克浏览器/6.0')
    expect(other.browser).toBe('这个浏览器')
    expect(other.deepLink).toBe('')
    expect(other.path).toContain('本地网络访问')
  })

  it('查不到权限状态时回 unknown（不猜）', async () => {
    vi.stubGlobal('navigator', {})
    expect(await lnaPermissionState()).toBe('unknown')
  })
})
