const STORAGE_KEY = 'iwb_applykit'
const LAST_COLLECT = 'iwb_last_collect'

const $ = (id) => document.getElementById(id)
const statusEl = () => $('status')

function setStatus(text, kind) {
  const el = statusEl()
  el.textContent = text
  el.className = kind ? `status ${kind}` : 'status'
}

function setCollectStatus(text, kind) {
  const el = $('collectStatus')
  el.textContent = text
  el.className = kind ? `status ${kind}` : 'status'
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 剪贴板 API 在扩展 popup 里偶发被拒，退回旧接口
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

/** 采集当前页面：只注入读取脚本，不发任何请求 */
async function collectCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) {
    setCollectStatus('没有找到当前标签页', 'err')
    return
  }
  if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(tab.url ?? '')) {
    setCollectStatus('浏览器内部页面不能采集，请打开实际的招聘页面', 'err')
    return
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['collector.js'] })
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (typeof window.__iwbCollectJobs === 'function' ? window.__iwbCollectJobs() : null),
    })
    const data = res?.result
    if (!data) {
      setCollectStatus('页面没有响应，刷新后再试一次', 'err')
      return
    }
    if (!data.count) {
      setCollectStatus('这一屏没有识别到岗位。请确认当前是搜索结果列表或岗位详情页，且岗位已经渲染出来。', 'err')
      return
    }
    await chrome.storage.local.set({ [LAST_COLLECT]: data })
    const ok = await copy(data.text)
    $('collectJsonBtn').style.display = ''
    setCollectStatus(
      ok
        ? `已采集 ${data.count} 个岗位并复制到剪贴板。切到工作台 →「岗位池」→「批量导入」→ 粘贴，即可结构化入库。`
        : `已采集 ${data.count} 个岗位，但剪贴板写入被拒绝。可点「复制 JSON」或重试。`,
      ok ? 'ok' : 'err',
    )
  } catch (error) {
    setCollectStatus(`采集失败：${error.message}。部分页面限制脚本注入，可改用工作台的「粘贴导入」。`, 'err')
  }
}

$('collectBtn').addEventListener('click', collectCurrentPage)

$('collectJsonBtn').addEventListener('click', async () => {
  const store = await chrome.storage.local.get(LAST_COLLECT)
  const data = store[LAST_COLLECT]
  if (!data) {
    setCollectStatus('还没有采集结果', 'err')
    return
  }
  const ok = await copy(JSON.stringify(data))
  setCollectStatus(ok ? 'JSON 已复制，粘贴到工作台的批量导入同样能识别。' : '复制失败，请手动重试', ok ? 'ok' : 'err')
})

/** 兼容两种来源：工作台导出的 { profile: {...} }，或直接的扁平对象 */
function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null
  const src = raw.profile && typeof raw.profile === 'object' ? raw.profile : raw
  const out = {}
  for (const [k, v] of Object.entries(src)) {
    if (v === null || v === undefined) continue
    const text = String(v).trim()
    if (!text) continue
    out[String(k).trim()] = text
  }
  return Object.keys(out).length ? out : null
}

function renderKit(kit) {
  const box = $('kitBox')
  box.innerHTML = ''
  if (!kit) {
    box.innerHTML = '<div class="empty">本机还没有数据，先导入工作台导出的 applykit.json。</div>'
    return
  }
  for (const [k, v] of Object.entries(kit)) {
    const row = document.createElement('div')
    const b = document.createElement('b')
    b.textContent = k
    const s = document.createElement('span')
    s.textContent = v.length > 60 ? `${v.slice(0, 60)}…` : v
    row.appendChild(b)
    row.appendChild(s)
    box.appendChild(row)
  }
}

async function loadKit() {
  const store = await chrome.storage.local.get(STORAGE_KEY)
  const kit = store[STORAGE_KEY] ?? null
  renderKit(kit)
  return kit
}

async function saveKit(kit) {
  await chrome.storage.local.set({ [STORAGE_KEY]: kit })
  renderKit(kit)
}

$('importBtn').addEventListener('click', () => $('file').click())

$('file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const kit = normalize(JSON.parse(text))
    if (!kit) {
      setStatus('这个 JSON 里没有可用的字段', 'err')
      return
    }
    await saveKit(kit)
    setStatus(`已导入 ${Object.keys(kit).length} 个字段`, 'ok')
  } catch (error) {
    setStatus(`解析失败：${error.message}`, 'err')
  }
})

$('parseBtn').addEventListener('click', async () => {
  try {
    const kit = normalize(JSON.parse($('paste').value || '{}'))
    if (!kit) {
      setStatus('粘贴的内容里没有可用的字段', 'err')
      return
    }
    await saveKit(kit)
    setStatus(`已保存 ${Object.keys(kit).length} 个字段`, 'ok')
  } catch (error) {
    setStatus(`解析失败：${error.message}`, 'err')
  }
})

$('clearBtn').addEventListener('click', async () => {
  await chrome.storage.local.remove(STORAGE_KEY)
  renderKit(null)
  setStatus('已清空本机数据', 'ok')
})

$('fillBtn').addEventListener('click', async () => {
  const kit = await loadKit()
  setStatus(kit ? `已读取 ${Object.keys(kit).length} 个字段` : '本机没有数据', kit ? 'ok' : 'err')
})

$('goBtn').addEventListener('click', async () => {
  const kit = await loadKit()
  if (!kit) {
    setStatus('没有数据可填，先导入 applykit.json', 'err')
    return
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) {
    setStatus('没有找到当前标签页', 'err')
    return
  }
  if (/^(chrome|edge|about|devtools):/i.test(tab.url ?? '')) {
    setStatus('浏览器内部页面不允许填充，请打开实际网申页面', 'err')
    return
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (payload) => window.__iwbFillApplyKit(payload),
      args: [kit],
    })
    const data = result?.result
    if (!data) {
      setStatus('页面没有响应，试试刷新后再点一次', 'err')
      return
    }
    setStatus(`已填充 ${data.filled} 个字段（页面共识别 ${data.candidates} 个候选输入框）。已填项用橙色描边标注，请核对后提交。`, 'ok')
  } catch (error) {
    setStatus(`填充失败：${error.message}，部分网申页限制脚本注入，可手动复制填写包内容。`, 'err')
  }
})

loadKit()
