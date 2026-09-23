/**
 * 站点适配表。
 *
 * 一个「适配」只描述三件事：从哪里进、列表怎么翻、有没有反爬。
 * **提取本身不在这里** —— 用的是 extension/collector.js 里那套「重复结构检测」，
 * 靠 DOM 结构自己找卡片，不依赖任何一个站点的类名。这也是它不容易随改版失效的原因。
 *
 * `channel` 必须落在 src/lib/constants.ts 的 CHANNELS 里，否则工作台里按渠道筛选会漏掉它们。
 *
 * `verified` 的含义要说清楚：
 *   - 'live'   ：本机真跑通过，这个文件里写的 URL 与翻页方式当时有效
 *   - 'offline'：只在本地夹具上验证过管线，没打过真实站点
 *   - 未写    ：没验过，等你第一次跑的结果
 * 招聘站点的路由和反爬策略改动很频繁，所以这个标记会过期，看到 'live' 也别当成永久承诺。
 */

export const STRATEGIES = ['auto', 'query', 'next', 'more', 'scroll', 'none']

/** 各站点共用的翻页按钮文案（按可信度排序，先试「下一页」再试「加载更多」） */
export const NEXT_TEXTS = ['下一页', '下页', '后一页', 'Next', 'next', '›', '»', '>']
export const MORE_TEXTS = ['加载更多', '查看更多', '更多职位', '展开更多', '点击加载', 'Load more', 'Show more']

export const SITES = [
  {
    id: 'tencent',
    name: '腾讯招聘',
    channel: '官网投递',
    listUrl: 'https://join.qq.com/post.html?query={kw}',
    strategy: 'auto',
    wait: 3000,
    needsLogin: false,
    notes: '校招/社招岗位列表，未登录也能看到公开岗位。实跑：1 页 10 条，标题与城市 10/10 全对',
    verified: 'live',
  },
  {
    id: 'bytedance',
    name: '字节跳动招聘',
    channel: '官网投递',
    listUrl: 'https://jobs.bytedance.com/campus/position?keywords={kw}',
    strategy: 'auto',
    wait: 3500,
    needsLogin: false,
    notes: '校招岗位列表；前端是 SPA，首次渲染较慢',
  },
  {
    id: 'huawei',
    name: '华为招聘',
    channel: '官网投递',
    listUrl: 'https://career.huawei.com/reccampportal/portal5/campus-recruitment.html',
    strategy: 'auto',
    wait: 3500,
    needsLogin: false,
    notes: '校招门户；部分岗位要先选「应届生」身份',
  },
  {
    id: 'alibaba',
    name: '阿里巴巴招聘',
    channel: '官网投递',
    listUrl: 'https://talent.alibaba.com/campus/position-list?lang=zh',
    strategy: 'auto',
    wait: 3500,
    needsLogin: false,
    notes: '校园招聘岗位列表',
  },
  {
    id: 'baidu',
    name: '百度招聘',
    channel: '官网投递',
    listUrl: 'https://talent.baidu.com/jobs/campus',
    strategy: 'auto',
    wait: 3000,
    needsLogin: false,
    notes: '校招岗位列表',
  },
  {
    id: 'meituan',
    name: '美团招聘',
    channel: '官网投递',
    listUrl: 'https://zhaopin.meituan.com/web/campus',
    strategy: 'auto',
    wait: 3000,
    needsLogin: false,
    notes: '校招岗位列表。实跑：1 页 10 条，公司/标题/城市全对（修复「JD 正文被当成岗位名」的卡片检测 bug 之后）',
    verified: 'live',
  },
  {
    id: 'jd',
    name: '京东招聘',
    channel: '官网投递',
    listUrl: 'https://campus.jd.com/#/jobs',
    strategy: 'next',
    wait: 3500,
    needsLogin: false,
    notes: 'hash 路由，只能靠点按钮翻页，--url 传的参数形式不生效',
  },
  {
    id: 'netease',
    name: '网易招聘',
    channel: '官网投递',
    listUrl: 'https://hr.163.com/job-list.html',
    strategy: 'auto',
    wait: 3000,
    needsLogin: false,
    notes: '列表页含社招与实习，建议配 --mode intern',
  },
  {
    id: 'xiaomi',
    name: '小米招聘',
    channel: '官网投递',
    listUrl: 'https://hr.xiaomi.com/campus/position',
    strategy: 'auto',
    wait: 3000,
    needsLogin: false,
    notes: '校招岗位列表',
  },
  {
    id: 'kuaishou',
    name: '快手招聘',
    channel: '官网投递',
    listUrl: 'https://campus.kuaishou.cn/recruit/campus/e/#/campus/index/',
    strategy: 'next',
    wait: 3500,
    needsLogin: false,
    notes: 'hash 路由',
  },
  {
    id: 'mihoyo',
    name: '米哈游招聘',
    channel: '官网投递',
    listUrl: 'https://jobs.mihoyo.com/#/campus/position',
    strategy: 'next',
    wait: 3000,
    needsLogin: false,
    notes: 'hash 路由',
  },
  {
    id: 'iflytek',
    name: '科大讯飞招聘',
    channel: '官网投递',
    listUrl: 'https://campus.iflytek.com/',
    strategy: 'auto',
    wait: 3500,
    needsLogin: false,
    notes: '官网走北森（zhiye.com）托管，页面公开；校招/实习/社招分频道。实跑：1 页 5 条真岗位（核心技术研究员、软件开发工程师…）',
    verified: 'live',
  },
  {
    id: 'byd',
    name: '比亚迪招聘',
    channel: '官网投递',
    listUrl: 'https://job.byd.com/portal/pc',
    strategy: 'auto',
    wait: 4500,
    needsLogin: false,
    notes: 'SPA 门户，根路径是引导页，须用 /portal/pc；制造类岗位占比高，建议配关键词筛。实跑：/portal/pc 仍只读到 1 条（页面标题），岗位列表要点进「校园招聘」后才出现，需要「进入后再点导航」的能力，本版抓取器还没有 —— 暂不可用',
    verified: 'offline',
  },
  {
    id: 'zte',
    name: '中兴通讯招聘',
    channel: '官网投递',
    listUrl: 'https://job.zte.com.cn/',
    strategy: 'auto',
    wait: 3500,
    needsLogin: false,
    notes: '校招频道的岗位列表，页面跳转到 Moka 托管（app.mokahr.com）。实跑：1 页 6 条，含 Moka 真实投递链接（AI算法工程师…）',
    verified: 'live',
  },
  {
    id: 'pdd',
    name: '拼多多招聘',
    channel: '官网投递',
    listUrl: 'https://careers.pinduoduo.com/campus/grad',
    strategy: 'auto',
    wait: 3500,
    needsLogin: false,
    notes: '校招应届生频道（/campus/grad）。实跑：1 页 5 条（AI Infra研发工程师、运营管培生…）',
    verified: 'live',
  },
  {
    id: 'huatai',
    name: '华泰证券招聘',
    channel: '官网投递',
    listUrl: 'https://job.htsc.com.cn/',
    strategy: 'auto',
    wait: 3500,
    needsLogin: false,
    notes: '华泰证券招聘官网（官方声明的唯一校招网申渠道）。注意别用 htsc.hotjob.cn，该域名不解析。站点证书 CN 与域名不符，靠 ignoreHTTPSErrors 才打开。实跑：首页 4 条全是「校招启动通知 / Q&A / 测评通知」新闻稿（wecruit.hotjob.cn/pb/news.html），不是岗位列表 —— 真岗位在 pb/position 路由且要登录。暂不可用',
    verified: 'offline',
  },
  {
    id: 'cmb',
    name: '招商银行招聘',
    channel: '官网投递',
    listUrl: 'https://career.cmbchina.com/',
    strategy: 'auto',
    wait: 3500,
    needsLogin: false,
    notes: '银行类岗位。实跑：读到 23 条，但逐条核对 DOM 后确认全是首页「员工风采」轮播（div.staff-item，员工花名+岗位连成一行、无链接），不是岗位列表；全站各路由（/、/campus、/school…）返回同一个 5740 字首页，真岗位列表要登录后才出。暂不可用',
    verified: 'offline',
  },
  {
    id: 'hikvision',
    name: '海康威视招聘',
    channel: '官网投递',
    listUrl: 'https://campushr.hikvision.com/school.html?activeTab=1',
    strategy: 'auto',
    wait: 4500,
    needsLogin: false,
    notes: '官网首页只有宣传图，职位表在 school.html?activeTab=1；校招门户，研发岗为主。实跑：修 URL 后 5 条（音频算法、LLM大模型算法…）',
    verified: 'live',
  },
  {
    id: 'sf',
    name: '顺丰招聘',
    channel: '官网投递',
    listUrl: 'https://campus.sf-express.com/',
    strategy: 'auto',
    wait: 3500,
    needsLogin: false,
    notes: '顺丰校招专站；hr.sf-express.com 是社招站且连不通，别用。实跑：3 条，但内容是「网络规划、产品管理、IE工程师」这类**方向栏目名**（一个方向下挂一批岗），不是具体岗位标题，能看不能用，建议配 --url 换成带筛选的列表页',
    verified: 'offline',
  },
  {
    id: 'lenovo',
    name: '联想招聘',
    channel: '官网投递',
    listUrl: 'https://talent.lenovo.com.cn/',
    strategy: 'auto',
    wait: 3500,
    needsLogin: false,
    notes: '校招门户，含管培生与研发方向。实跑：首页只读到 1 条（站点名），岗位列表要再点一次导航才出现；和比亚迪同一个原因（需要「进入后再点导航」的能力），本版抓取器还没有 —— 暂不可用',
    verified: 'offline',
  },
  {
    id: 'nowcoder',
    name: '牛客校招',
    channel: '牛客',
    listUrl: 'https://www.nowcoder.com/jobs/campus',
    strategy: 'auto',
    wait: 3000,
    needsLogin: false,
    notes: '未登录只能看到部分岗位；登录后 --url 换成带筛选条件的地址更好用',
  },
  {
    id: 'shixiseng',
    name: '实习僧',
    channel: '实习僧',
    listUrl: 'https://www.shixiseng.com/interns?keyword={kw}&city=全国',
    strategy: 'auto',
    wait: 3000,
    needsLogin: false,
    notes: '普通 HTTP 请求会被 403，真浏览器能正常打开 —— 正好说明「用你自己看得见的那一屏」为什么重要',
  },
  {
    id: 'boss',
    name: 'BOSS直聘',
    channel: 'BOSS直聘',
    listUrl: 'https://www.zhipin.com/web/geek/job?query={kw}&city=100010000',
    strategy: 'auto',
    wait: 3500,
    needsLogin: true,
    notes: '必须先跑 `node login.mjs --site boss` 在本机登录一次；抓取器只用你已经登录的那个会话读页面，不代填账号密码',
  },
  {
    id: 'moka',
    name: 'Moka 托管页',
    channel: '官网投递',
    listUrl: 'https://app.mokahr.com/campus-recruitment/',
    strategy: 'auto',
    wait: 3500,
    needsLogin: false,
    notes: '很多中小公司用 Moka 托管校招页；用 --url 直接换成目标公司的 mokahr 地址更准',
  },
  {
    id: 'feishu',
    name: '飞书招聘托管页',
    channel: '官网投递',
    listUrl: '',
    strategy: 'auto',
    wait: 3500,
    needsLogin: false,
    notes: '入口形如 https://xxx.jobs.feishu.cn/index，用 --url 传具体公司地址',
  },
  {
    id: 'beisen',
    name: '北森托管页',
    channel: '官网投递',
    listUrl: '',
    strategy: 'auto',
    wait: 3500,
    needsLogin: false,
    notes: '入口形如 https://xxx.zhiye.com/，用 --url 传具体公司地址',
  },
  {
    id: 'generic',
    name: '任意页面（通用）',
    channel: '官网投递',
    listUrl: '',
    strategy: 'auto',
    wait: 3000,
    needsLogin: false,
    notes: '不给 --site 时用 --url 传任意招聘页地址，走同一套结构检测',
  },
]

export function findSite(id) {
  const key = String(id ?? '').trim().toLowerCase()
  return SITES.find((s) => s.id === key) ?? null
}

/**
 * 单一公司的官方招聘板：页面本身就没有「公司」这个字段（腾讯的岗位卡只有标题和城市），
 * 所以公司名由站点表直接给，不用启发式去猜 —— 猜出来的必然是「工作地点：…」这种标签行。
 *
 * 多公司平台（BOSS / 实习僧 / 牛客 / Moka / 飞书 / 北森托管页）故意留空：
 * 那里必须靠页面解析，硬塞一个公司名比留空更坏。
 * 命令行 `--company <名字>` 优先于这张表，用来处理「用 --url 抓了某家公司自己的站」。
 */
export const BOARD_COMPANY = {
  tencent: '腾讯',
  bytedance: '字节跳动',
  huawei: '华为',
  alibaba: '阿里巴巴',
  baidu: '百度',
  meituan: '美团',
  jd: '京东',
  netease: '网易',
  xiaomi: '小米',
  kuaishou: '快手',
  mihoyo: '米哈游',
  iflytek: '科大讯飞',
  byd: '比亚迪',
  zte: '中兴通讯',
  pdd: '拼多多',
  huatai: '华泰证券',
  cmb: '招商银行',
  hikvision: '海康威视',
  sf: '顺丰',
  lenovo: '联想',
}

/** 只在「页面里读不到公司名」时补默认值，读到了就尊重页面 */
export function companyFor(site, override = '') {
  const forced = String(override ?? '').trim()
  if (forced) return forced
  return BOARD_COMPANY[site?.id] ?? ''
}

export function isBoardOverride(site, override = '') {
  return Boolean(String(override ?? '').trim()) || Boolean(BOARD_COMPANY[site?.id])
}

/** 没给 --site 时的兜底：按域名反查，能认出来就顺便带上正确的 channel 和 needsLogin */
export function detectSiteByUrl(url) {
  const host = String(url ?? '').toLowerCase()
  if (!host) return null
  if (host.includes('zhipin.com')) return findSite('boss')
  if (host.includes('shixiseng.com')) return findSite('shixiseng')
  if (host.includes('nowcoder.com')) return findSite('nowcoder')
  if (host.includes('join.qq.com')) return findSite('tencent')
  if (host.includes('jobs.bytedance.com')) return findSite('bytedance')
  if (host.includes('career.huawei.com')) return findSite('huawei')
  if (host.includes('talent.alibaba.com')) return findSite('alibaba')
  if (host.includes('talent.baidu.com')) return findSite('baidu')
  if (host.includes('zhaopin.meituan.com')) return findSite('meituan')
  if (host.includes('campus.jd.com')) return findSite('jd')
  if (host.includes('hr.163.com')) return findSite('netease')
  if (host.includes('hr.xiaomi.com')) return findSite('xiaomi')
  if (host.includes('kuaishou')) return findSite('kuaishou')
  if (host.includes('mihoyo')) return findSite('mihoyo')
  if (host.includes('iflytek.com')) return findSite('iflytek')
  if (host.includes('byd.com')) return findSite('byd')
  if (host.includes('zte.com.cn')) return findSite('zte')
  if (host.includes('pinduoduo.com')) return findSite('pdd')
  // 注意：hotjob.cn / wecruit.hotjob.cn 是北森 wecruit 的共用托管域名，多家公司共用，
  // 不能反查成某一家（如华泰），否则会把别家岗位误标成华泰。让公司名留空更安全。
  if (host.includes('htsc.com.cn')) return findSite('huatai')
  if (host.includes('cmbchina.com')) return findSite('cmb')
  if (host.includes('hikvision.com')) return findSite('hikvision')
  if (host.includes('sf-express.com')) return findSite('sf')
  if (host.includes('lenovo.com')) return findSite('lenovo')
  if (host.includes('mokahr.com') || host.includes('moka.com')) return findSite('moka')
  if (host.includes('jobs.feishu.cn')) return findSite('feishu')
  if (host.includes('zhiye.com') || host.includes('beisen')) return findSite('beisen')
  return null
}
