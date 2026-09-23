const { cloud } = require('./cloud')
const constants = require('./constants')

let cachedModel = null

/** 取一个可用模型。云服务免密钥，所以这里不需要任何 API Key。 */
async function pickModel() {
  if (cachedModel) return cachedModel
  const models = await cloud.llm.models.list()
  const usable = (models || []).filter(function (m) { return m && m.disabled !== true && m.enabled !== false })
  if (!usable.length) return null
  cachedModel = usable[0].id
  return cachedModel
}

/**
 * 唯一的模型调用入口：只支持流式，逐帧累积文本。
 * 小程序里同样用 for await 消费 SSE —— 分块由 SDK 的 wx.request 传输层负责，
 * 不要改用 wx.request，也不要去找 EventSource（那个运行时里没有）。
 */
async function streamChat(opts) {
  const model = await pickModel()
  if (!model) throw new Error('当前没有可用模型，请稍后重试')

  let text = ''
  const stream = await cloud.llm.chat.completions.create({
    model: model,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user }
    ],
    stream: true,
    stream_options: { include_usage: true },
    ...(opts.json ? { response_format: { type: 'json_object' } } : {})
  })

  for await (const chunk of stream) {
    const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta
    if (delta && delta.content) {
      text += delta.content
      if (opts.onDelta) opts.onDelta(delta.content)
    }
  }
  return text
}

function profileBrief(profile) {
  if (!profile) return '（发起人尚未填写画像，仅依据 JD 本身评估）'
  return [
    '姓名：' + (profile.full_name || '—'),
    '年级：' + (profile.grade || '—') + ' / ' + (profile.grad_year || '—'),
    '专业：' + (profile.major || '—'),
    '期望城市：' + ((profile.expect_city || []).join('、') || '—'),
    '期望岗位类型：' + ((profile.expect_type || []).join('、') || '—'),
    '期望日薪：' + (profile.expect_daily || '—'),
    '技能：' + ((profile.skills || []).join('、') || '—'),
    '目标方向：' + ((profile.directions || []).join('、') || '—'),
    '项目与事实：' + (profile.resume_summary || '—')
  ].join('\n')
}

const EVAL_SYSTEM = '你是中国大学生实习/校招求职的 JD 评估助手，输出必须诚实、可执行、不虚构。\n' +
  '只输出一个 JSON 对象，不要输出任何解释文字或 Markdown 代码块，结构如下：\n' +
  '{\n' +
  '  "score": 0-100 的整数匹配度,\n' +
  '  "verdict": "一句话结论（值不值得投，20 字内）",\n' +
  '  "dims": { ' + constants.DIMS.map(function (d) { return '"' + d + '": 1-10 的整数' }).join(', ') + ' },\n' +
  '  "highlights": ["与候选人真实经历对得上的亮点，2-4 条"],\n' +
  '  "gaps": ["JD 要求但候选人明显缺失或存疑的点，1-4 条；没有就写空数组"],\n' +
  '  "greeting": "给 HR 的一句打招呼（可复制直接发送）"\n' +
  '}\n' +
  '规则：\n' +
  '- highlights 只能来自候选人画像里真实存在的事实，不得虚构经历或技能。\n' +
  '- gaps 要直说，但语气中性，不做人身评价。\n' +
  '- greeting 必须遵守下面的打招呼纪律。\n' +
  constants.GREETING_RULES

async function evaluateJD(jd, profile, onDelta) {
  const raw = await streamChat({
    system: EVAL_SYSTEM,
    user: '【候选人画像】\n' + profileBrief(profile) + '\n\n【目标岗位 JD】\n' + String(jd || '').slice(0, 8000),
    json: true,
    onDelta: onDelta
  })

  let parsed = {}
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    // 模型偶尔会把 JSON 包进 Markdown 代码块，剥一层再解析一次
    parsed = JSON.parse(String(raw).replace(/```json/g, '').replace(/```/g, '').trim())
  }

  const dims = {}
  for (let i = 0; i < constants.DIMS.length; i += 1) {
    const d = constants.DIMS[i]
    const v = Number(parsed && parsed.dims ? parsed.dims[d] : NaN)
    dims[d] = isFinite(v) ? Math.max(1, Math.min(10, Math.round(v))) : 5
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(Number(parsed.score || 60)))),
    verdict: String(parsed.verdict || '评估完成'),
    dims: dims,
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights.map(String) : [],
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps.map(String) : [],
    greeting: String(parsed.greeting || '')
  }
}

async function generateGreeting(company, title, jd, profile, onDelta) {
  return streamChat({
    system: '你在帮一名中国大学生写发给 HR / 技术负责人 的第一条打招呼消息。输出只有消息正文本身，不要标题、不要解释、不要引号包裹。\n' +
      constants.GREETING_RULES,
    user: '【候选人画像】\n' + profileBrief(profile) + '\n\n【公司与岗位】' + company + ' · ' + title + '\n\n【JD 原文】\n' + String(jd || '').slice(0, 6000),
    onDelta: onDelta
  })
}

module.exports = {
  pickModel: pickModel,
  streamChat: streamChat,
  profileBrief: profileBrief,
  evaluateJD: evaluateJD,
  generateGreeting: generateGreeting
}
