/**
 * 岗位采集：把「用户正在看的这一屏」里的岗位列表结构化成文本 / JSON。
 *
 * 这个文件是**两条通道共用的唯一提取实现**：
 *   1) 浏览器扩展（popup.js 注入本文件后调用 window.__iwbCollectJobs）
 *   2) 本地抓取器（crawler/run.mjs 把本文件 addScriptTag 进页面，逐页调用同一函数）
 * 所以对提取算法的任何改动都会同时作用在两边，不会出现「扩展读得准、抓取器读不准」。
 *
 * 边界说明（写在这里是为了以后有人想「顺手加个翻页」时能看到）：
 * - 本文件只读当前已渲染的 DOM，不发任何网络请求、不调接口、不解密参数。
 *   翻页/导航是 crawler/run.mjs 的职责，不在这里 —— 这个文件被注入后必须是纯读取。
 * - 不绕过登录、验证码、滑块。用户看到什么就采什么 —— 采集结果里不会出现
 *   用户自己没看到的内容，所以既不需要额外权限，也不涉及抓取他人数据。
 */
;(function () {
  const CITIES = [
    '北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京', '西安', '苏州',
    '长沙', '重庆', '天津', '合肥', '郑州', '青岛', '厦门', '福州', '济南', '大连',
    '沈阳', '东莞', '佛山', '无锡', '宁波', '珠海', '南昌', '昆明', '贵阳', '石家庄',
    '太原', '哈尔滨', '长春', '兰州', '乌鲁木齐', '海口', '南宁', '惠州', '中山',
    '远程', '全国',
  ]

  const TITLE_WORDS =
    /(实习|工程师|开发|算法|产品|运营|设计|分析|研究|架构|测试|前端|后端|全栈|数据|研发|校招|招聘|专员|助理|经理|顾问|编辑|策划|讲师|医师|教师|销售|客服|法务|财务|人事|科学家|专家|Intern|intern)/

  const SALARY_RE =
    /(\d{1,4}\s*[-~至]\s*\d{1,4}\s*(?:\/天|\/日|\/月|元?\/天|元?\/月|元|K|k)|面议|\d{1,3}\s*[kK]\s*[-~至]\s*\d{1,3}\s*[kK])/

  const COMPANY_HINT =
    /(公司|集团|科技|网络|信息|技术|软件|数据|智能|传媒|教育|文化|电子|通信|银行|证券|保险|研究院|研究所|实验室|中心|工作室|事务所|有限|股份|控股|实业|企业)/

  const NOISE_LINE =
    /^(立即沟通|继续沟通|收藏|举报|分享|查看|详情|申请|投递|已投递|刚刚|昨天|前天|活跃|在线|急招|热招|置顶|广告|推荐|相关|更多|展开|收起)$/

  /**
   * 结构化字段的标签行。这些行常带「技术」「中心」这类会被 COMPANY_HINT 命中的字眼，
   * 所以在选公司名之前必须先挡掉，否则会把「工作地点：深圳总部 北京」当成公司名。
   */
  const META_LINE =
    /^(工作地点|工作城市|招聘范围|招聘对象|岗位类别|职位类别|面试地点|薪资|薪资范围|学历|学历要求|经验|经验要求|所属部门|事业群|部门|发布时间|截止时间|岗位职责|任职要求|职位描述|职位名称|公司规模|融资阶段)/

  /**
   * 带竖线的行一律不是公司名，也不是任何结构化字段。
   * 这类行是「岗位方向 ｜ 招聘对象 ｜ 事业群」三段式标签（腾讯列表页就是
   * 「市场 ｜ 应届毕业生 ｜CDG」「产品 ｜ 应届毕业生 ｜IEG PCG」），
   * 三段单看都像正常文本，靠 COMPANY_HINT / META_LINE 各挡一半是挡不住的。
   */
  const PIPE_LINE = /[｜|]/

  const txt = (el) => String(el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim()

  const linesOf = (el) =>
    String(el.innerText || el.textContent || '')
      .split('\n')
      .map((s) => s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)

  function median(list) {
    if (!list.length) return 0
    const a = list.slice().sort((x, y) => x - y)
    const m = Math.floor(a.length / 2)
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
  }

  /** 结构指纹：同一种「卡片」的标签名 + class 集合应当一致 */
  function signature(el) {
    const cls = Array.from(el.classList || [])
      .filter((c) => c.length > 0 && c.length < 40 && !/^(active|selected|on|hover|open|is-|js-|has-)/i.test(c))
      .sort()
      .join('.')
    return `${el.tagName.toLowerCase()}|${cls}`
  }

  function pickCity(text) {
    // 取「文本里最早出现」的城市，而不是城市表里排序最靠前的那个。
    // 多个城市并列时（如「深圳总部 北京 上海」），第一个才是主地点。
    const t = String(text || '')
    let best = ''
    let at = -1
    for (const c of CITIES) {
      const i = t.indexOf(c)
      if (i < 0) continue
      if (at < 0 || i < at) {
        at = i
        best = c
      }
    }
    return best
  }

  /**
   * 找「重复出现的卡片容器」：把同类标签 + 同类 class 的元素分组，
   * 取数量够多、体积又最小的一组 —— 那就是列表里的单张岗位卡。
   * 这种找法不依赖任何站点的类名，站点改版也不会直接失效。
   *
   * 关于 a[href]：**不能强制要求卡片里有链接**。不少官方校招站（腾讯就是）把岗位卡做成
   * 纯 div + 点击事件，一个 <a> 都没有；一旦强制要求，整页就会退化成「1 个岗位」。
   * 里层带链接的组只作为同分时的优先项 —— 因为带链接才补得了 JD。
   *
   * 关于「独立条目」：数量不能单独当主键。真实反例（美团校招）：岗位卡 10 个，但每张卡
   * 里的「岗位职责」段落有 12 个，纯按数量排就会把 JD 正文当成岗位名（标题变成
   * 「1. 负责各类后台服务…」）。
   *
   * 判据是**父容器是否「比卡片厚得多」**（parentOversize）。真正的卡片列表，所有卡片
   * 挂在同一个「列表壳」容器下，这个壳的文本 = n 张卡拼起来，体量远大于单张卡；
   * 而卡内碎片（JD 段落、岗位名）的父容器**就是卡片本身**，体量≈一张卡。
   *
   * 实测（美团列表页第一页，DOM 结构）：
   *   div.postion_list_wrapper                 ← 列表壳，文本 1587 字
   *     └── div.position_list_item.cursor_pointer  ×10  parents=1  ✅ 真卡片
   *           └── div.position_list_item_content   ×10  parents=10 （卡片内层包装）
   *                 └── div..._content_left        ×10  parents=10
   *                       ├── div.postion_name     ×5   parents=5   碎片
   *                       ├── div.position_duty    ×9   parents=9   碎片
   *                       └── div.desc.hidden-ellipsis ×12 parents=9  碎片
   *
   * 对比 `父容器文本 / 卡片文本`：
   *   position_list_item  1587 / 118 = 13.4  ← 父容器是列表壳 ✅
   *   position_list_item_content  118 / 118 = 1.0  ← 父容器就是卡片本身 ❌
   *   desc.hidden-ellipsis   74 / 64 = 1.2   ← 同上 ❌
   * 所以门槛是 parentOversize ≥ 2：父容器至少要比单张卡厚一倍，才算「卡片列表」。
   *
   * 另外用「内层包装」检查兜底：若某组的父链上存在文本完全相同的别组元素
   * （position_list_item_content 的父元素就是 position_list_item，文本一致），
   * 说明它只是卡片的内壳，不是卡片本身。
   */
  /**
   * 卡片组打分（纯算术，被 findCards 调用，同时导出给单测）。
   *
   * 排序主键是**数量**；数量接近时优先「父容器更厚」的那组（更接近完整列表壳）。
   * 注意这里刻意**不含任何「越小越好」的项**：卡内碎片往往数量更多，任何让
   * 碎片得分变高的软因子都会翻车 —— 卡片的正确性由 findCards 的硬门槛
   * （parentOversize ≥ 2 + 内层包装检测）保证，不靠打分调权。
   *
   * @param {{n:number, parentOversize:number, linked:number, cardLen:number}} s
   */
  function scoreCardGroup(s) {
    return s.n * 1000 + Math.min(50, s.parentOversize) * 10 + s.linked * 200 - s.cardLen
  }

  function findCards() {
    const groups = new Map()
    const nodes = document.querySelectorAll('li, article, section, tr, div')
    for (const el of nodes) {
      const t = txt(el)
      if (t.length < 12 || t.length > 1500) continue
      if (el.querySelectorAll('input, textarea, select').length > 3) continue
      if (!TITLE_WORDS.test(t)) continue
      const sig = signature(el)
      if (!groups.has(sig)) groups.set(sig, [])
      groups.get(sig).push(el)
    }

    let best = null
    for (const list of groups.values()) {
      if (list.length < 4) continue
      // 同一指纹里若存在包含关系，只保留最内层（真正的卡片）
      const inner = list.filter((el) => !list.some((other) => other !== el && el.contains(other)))
      if (inner.length < 4) continue
      const linked = inner.filter((el) => el.querySelector('a[href]')).length
      // 父容器是否「比卡片厚得多」：真卡片的父容器是列表壳（装着全部卡片），
      // 碎片的父容器就是卡片本身。见函数头注释里的实测数据。
      const cardLen = median(inner.map((el) => txt(el).length)) || 1
      const parents = [...new Set(inner.map((el) => el.parentElement).filter(Boolean))]
      const parentOversize = parents.length ? median(parents.map((p) => txt(p).length)) / cardLen : 0
      // 硬门槛：父容器体量不到单张卡的 2 倍 → 这是卡内碎片，不是卡片列表，淘汰。
      // 必须是门槛而非乘数 —— 碎片组往往数量更多，软乘数压不住它的数量优势。
      if (parentOversize < 2) continue
      // 内层包装：父链上存在文本完全相同的别组元素 → 本组只是卡片内壳，淘汰。
      const texts = new Set(inner.map((el) => txt(el)))
      const isInnerWrapper = inner.some((el) => {
        let p = el.parentElement
        while (p && p !== document.body) {
          if (texts.has(txt(p))) return true
          p = p.parentElement
        }
        return false
      })
      if (isInnerWrapper) continue
      // 过了门槛才比数量；数量相同时优先「父容器更厚」（更接近完整列表壳）。
      const score = scoreCardGroup({
        n: inner.length,
        parentOversize,
        linked: linked / inner.length,
        cardLen,
      })
      if (!best || score > best.score) best = { score, list: inner }
    }
    return best ? best.list : []
  }

  function isNotJobLine(line, title, salary, city) {
    if (line === title || line === salary) return false
    if (city && line.includes(city) && line.length <= 20) return false
    if (SALARY_RE.test(line)) return false
    if (NOISE_LINE.test(line)) return false
    if (META_LINE.test(line)) return false
    if (/^\d+\s*(人|个职位|天前|小时前|分钟前)/.test(line)) return false
    if (/^(经验|学历|本科|硕士|博士|大专|不限|应届)/.test(line) && line.length <= 12) return false
    return true
  }

  /** 单张卡片 → 岗位草稿。取不到的字段留空，不猜。 */
  function extractCard(card) {
    const lines = linesOf(card).slice(0, 20)
    if (!lines.length) return null

    const anchor = card.querySelector('a[href]')
    // 卡片里没有链接就不编一个：拿列表页地址冒充岗位链接，会让「补 JD」把列表页抓成岗位
    let url = anchor ? String(anchor.href || '') : ''
    if (url && !/^https?:/i.test(url)) url = ''

    const anchorText = anchor ? txt(anchor) : ''

    let title = ''
    if (anchorText && anchorText.length <= 40 && TITLE_WORDS.test(anchorText)) title = anchorText
    if (!title) {
      for (const l of lines) {
        if (l.length >= 2 && l.length <= 40 && TITLE_WORDS.test(l) && !/^(岗位|职位|公司)/.test(l)) {
          title = l
          break
        }
      }
    }
    if (!title) return null

    let salary = ''
    for (const l of lines) {
      if (l.length <= 30 && SALARY_RE.test(l) && !TITLE_WORDS.test(l)) {
        salary = l
        break
      }
    }

    let cityLine = ''
    for (const l of lines) {
      if (l === title || l === salary) continue
      const hit = pickCity(l)
      if (hit && l.length <= 30) {
        cityLine = l
        break
      }
    }
    const city = cityLine ? pickCity(cityLine) : pickCity(txt(card))

    // 公司名：带「公司/科技/集团…」这类后缀的短行最可信；退一步用最后一个短文本行。
    // 带竖线的行一律不当公司名 —— 那是「技术 ｜ 应届毕业生 ｜CDG」这种标签行。
    let company = ''
    const companyCandidates = lines.filter(
      (l) =>
        l.length >= 2 &&
        l.length <= 30 &&
        l !== title &&
        l !== salary &&
        l !== cityLine &&
        COMPANY_HINT.test(l) &&
        !META_LINE.test(l) &&
        !PIPE_LINE.test(l),
    )
    if (companyCandidates.length) company = companyCandidates[0]
    if (!company) {
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const l = lines[i]
        // 兜底分支同样要挡竖线行：它是「市场 ｜ 应届毕业生 ｜CDG」这类标签行唯一能钻的空子
        if (PIPE_LINE.test(l)) continue
        if (isNotJobLine(l, title, salary, city) && l.length >= 2 && l.length <= 24 && !COMPANY_HINT.test(l)) {
          company = l
          break
        }
      }
    }

    const raw = txt(card).slice(0, 1500)
    return { company, title, city, salary, url, raw }
  }

  /**
   * 详情页正文容器候选。
   *
   * ⚠️ 这里是「候选里挑文本最长的」，不是「第一个命中的」。
   * 逗号选择器配 querySelector 的语义是命中即停，而招聘详情页最喜欢把
   * `main` / `.content` 这类合规名字给一个装饰性壳子：实习僧实测 `main` 只有 19 个字
   * （一条面包屑），JD 挂在不认识的 `div.inn_detail` 上。命中即停的结果是 raw 只有 19 字，
   * 比列表页那条摘要（125 字）还短，抓取器的合并规则反过来判给列表摘要，
   * 于是症状是「补全 0 条 JD、不报错」。由 extension/__fixtures__/mock-job-detail-trap.html
   * 与 crawler/selftest.mjs 的 ④ 钉住。
   */
  const DETAIL_CONTAINERS = 'main, article, .content, #content, #job-detail, .job-detail'

  /** 少到这个数就不算「读到正文了」——既用来决定要不要退回整页，也用来决定这一条要不要 */
  const MIN_JD_CHARS = 40

  /**
   * 选正文容器：合规候选里取文本最长的；一个都装不下足够文字时才退到整页。
   *
   * 刻意不与整页比长度：夹具和扩展会在 `document.body` 末尾挂一段采集结果 JSON，
   * 一比倍数就永远选整页，导航和推荐位全被收进 JD（第一版就是这么翻车的）。
   */
  function pickDetailBody() {
    let best = null
    let bestLen = 0
    for (const el of Array.from(document.querySelectorAll(DETAIL_CONTAINERS))) {
      const len = txt(el).length
      if (len > bestLen) {
        best = el
        bestLen = len
      }
    }
    return bestLen >= MIN_JD_CHARS ? best : document.body
  }

  /** `<title>` 段尾的招聘样板词，剥掉才是干净的公司名 / 岗位名（刻意不含裸「实习」二字：那是岗位名的一部分） */
  const TITLE_BOILER = /(?:校园招聘|社会招聘|应届生招聘|实习生招聘|实习招聘|招聘|校招|社招)+$/

  /** 平台自己的名字混在 `<title>` 里，绝不能当公司名 */
  const PLATFORM_WORD = /(实习僧|BOSS直聘|boss直聘|牛客|猎聘|智联|前程无忧|51job|Moka|官网|首页|广告|推荐|登录|注册)/

  /** 「{短品牌}招聘」这种段是站点招牌，不是岗位名 */
  const BRAND_SEGMENT = /^.{2,10}(?:招聘|校招|社招)$/

  /** 「{X}实习生招聘」这一种段：X 就是公司名，可它带着「招聘」，会被 TITLE_WORDS 一把挡掉 */
  const COMPANY_TAIL = /^(.{2,20}?)(?:实习生?|应届生?|校园)?(?:招聘|校招|社招)$/

  /** 详情页 `<title>` 的分段，多数站点是「{岗位}-{公司}-{平台}」或「{公司}招聘 - {岗位}」 */
  function titleParts() {
    return String(document.title || '')
      .split(/[-_|｜—–]/)
      .map((s) => s.trim())
      .filter(Boolean)
  }

  /** 详情页兜底：整页只有一个岗位时，卡片检测会因为「少于 4 个」而失效 */
  function extractDetailPage(maxJd) {
    const limit = maxJd > 0 ? maxJd : 12000
    const h1 = document.querySelector('h1')
    const parts = titleParts()
    // 没有 <h1> 的站点（实习僧详情页就是这样）只能从 <title> 里挑「像岗位」的那一段；
    // 整串 document.title 直接当岗位名会写成「…-…实习生招聘-实习僧」，那是三个字段挤在一格里。
    const fromTitle = parts.find((p) => TITLE_WORDS.test(p) && !BRAND_SEGMENT.test(p) && !PLATFORM_WORD.test(p))
    const rawTitle = (h1 ? txt(h1) : '') || fromTitle || document.title
    const title = rawTitle.replace(TITLE_BOILER, '') || rawTitle
    const body = txt(pickDetailBody()).slice(0, limit)
    if (!body || body.length < MIN_JD_CHARS) return []
    const raw = body

    // 城市与薪资往往在正文容器之外（页面头部的信息条），所以探测范围要放宽到
    // 「h1 所在容器 + 正文」，而不是只搜正文。
    const header = h1 && h1.parentElement ? txt(h1.parentElement).slice(0, 800) : ''
    const probe = `${header}\n${raw}`

    // 公司名从 <title> 里捞：常见格式是「岗位 - 公司 - 平台」
    let company = ''
    for (const part of parts) {
      const p = part.replace(TITLE_BOILER, '')
      // 这一段刻意**不**再挡平台名：能走到这里说明它已同时满足「含公司特征词」和「不含岗位词」，
      // 而各家平台的招牌名（实习僧 / BOSS直聘 / 牛客 / 智联招聘 / 前程无忧）一条都进不来 —— 变异测试
      // 证明这个守卫在这条分支上永远不被触发。真正会撞上平台名的是下面那条兜底分支，那边有挡。
      if (p.length >= 2 && p.length <= 30 && COMPANY_HINT.test(p) && !TITLE_WORDS.test(p)) {
        company = p
        break
      }
    }
    if (!company) {
      // 第一段是岗位，不参与「公司名」判定，否则「XX招聘」这种招牌会被当成岗位、
      // 而真正的公司段带着「招聘」二字反而过不了 TITLE_WORDS 那关。
      for (const part of parts.slice(1)) {
        const m = COMPANY_TAIL.exec(part)
        if (m && !PLATFORM_WORD.test(m[1]) && !TITLE_WORDS.test(m[1])) {
          company = m[1]
          break
        }
      }
    }

    return [
      {
        company,
        title: title.slice(0, 60),
        city: pickCity(probe),
        salary: (SALARY_RE.exec(probe) || [''])[0],
        url: location.href,
        raw,
      },
    ]
  }

  /** 采集结果 → 带标签的纯文本，用 --- 分隔；既能被本地正则识别，也能喂给大模型 */
  function toText(result) {
    const head = `# 采集自 ${result.page.title || ''} （${result.page.url}）\n# 共 ${result.jobs.length} 个岗位 · ${new Date().toLocaleString('zh-CN')}`
    const blocks = result.jobs.map((j) => {
      const rows = [
        j.company ? `公司：${j.company}` : '',
        `岗位：${j.title}`,
        j.city ? `城市：${j.city}` : '',
        j.salary ? `薪资：${j.salary}` : '',
        j.url ? j.url : '',
        '岗位原文：',
        j.raw.replace(/\n{2,}/g, '\n'),
      ]
      return rows.filter(Boolean).join('\n')
    })
    return `${head}\n\n${blocks.join('\n\n---\n\n')}\n`
  }

  /**
   * 采集当前页面。
   *
   * @param {{mode?: 'list'|'detail', maxJd?: number}} [options]
   *   mode='list'   只认列表卡片，不做详情页兜底（列表页里推荐位很多时更准）
   *   mode='detail' 强制按详情页读（详情页底部常挂「相关推荐」，不强制会误判成列表）
   *   不传 = 自动：卡片够 4 张就走列表，否则退化成详情页
   *   maxJd 正文长度上限，默认 12000
   */
  window.__iwbCollectJobs = function collectJobs(options) {
    const opts = options || {}
    const mode = opts.mode === 'list' || opts.mode === 'detail' ? opts.mode : ''
    const maxJd = Number(opts.maxJd) > 0 ? Number(opts.maxJd) : 12000

    let jobs = []
    if (mode !== 'detail') {
      const cards = findCards()
      if (cards.length >= 4) {
        const seen = new Set()
        for (const card of cards) {
          const job = extractCard(card)
          if (!job) continue
          const key = `${job.title}|${job.salary}`
          if (seen.has(key)) continue
          seen.add(key)
          jobs.push(job)
        }
      }
    }
    if (mode === 'detail' || jobs.length < 2) jobs = extractDetailPage(maxJd)

    const result = {
      source: '实习工作台采集器',
      version: 1,
      mode: mode || 'auto',
      collected_at: new Date().toISOString(),
      page: { url: location.href, title: document.title, site: location.hostname },
      count: jobs.length,
      jobs,
    }
    result.text = toText(result)
    return result
  }

  /**
   * 纯函数导出：给「卡片组打分」单独做单测用。
   *
   * findCards 依赖真实 DOM，没法在 node 里直接跑；但**排序规则本身**是纯算术，
   * 而它正是历史上出过错的地方（美团那次把 JD 段落当成了岗位卡）。把这段抽成
   * 纯函数暴露出来，让它可以脱离浏览器被测到 —— 这是唯一能在 CI 里拦住
   * 「碎片靠数量优势顶掉真卡片」这类回归的办法。
   */
  window.__iwbScoreCardGroup = scoreCardGroup
})()
