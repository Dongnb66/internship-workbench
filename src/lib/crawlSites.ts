/**
 * 抓取任务生成器的站点清单。
 *
 * ⚠ 契约：这份清单必须与 `crawler/sites.mjs` 的 `SITES` 保持同步
 * （id / name / needsLogin / kwSearch / urlOnly / verified 六个字段）。
 * 判定依据（与 crawler 的实际行为对齐，不是拍脑袋）：
 * - kwSearch：listUrl 含 `{kw}` 查询模板 → --keyword 会进搜索参数（腾讯/字节/实习僧/BOSS）；
 *   其余站点 --keyword 只被忽略（固定入口页，整页抓取）。
 * - urlOnly：listUrl 为空 → run.mjs 报「没有入口地址」，必须 --url 指定（飞书/北森/通用）。
 * - verified：抓取器实跑验证的结论，live=能抓到真岗位，offline=抓不到（保留作参考）。
 * `src/lib/__tests__/crawlSites.test.ts` 直接 import crawler/sites.mjs 做全量比对，
 * 两边漂移测试会红 —— 改站点清单时两处都要动。
 */

export interface CrawlSite {
  id: string
  name: string
  channel: string
  /** true = 需要先 `node login.mjs --site <id>` 在本机登录一次 */
  needsLogin: boolean
  /** true = --keyword 会进搜索参数；false = 固定入口页，关键词被忽略 */
  kwSearch: boolean
  /** true = 无入口地址，必须 --url 指定具体招聘页 */
  urlOnly: boolean
  /** 站点实跑验证状态：live=实测能抓到真岗位；offline=实测抓不到（保留作参考） */
  verified: '' | 'live' | 'offline'
}

export const CRAWL_SITES: CrawlSite[] = [
  { id: 'tencent', name: '腾讯招聘', channel: '官网投递', needsLogin: false, kwSearch: true, urlOnly: false, verified: 'live' },
  { id: 'bytedance', name: '字节跳动招聘', channel: '官网投递', needsLogin: false, kwSearch: true, urlOnly: false, verified: '' },
  { id: 'huawei', name: '华为招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: '' },
  { id: 'alibaba', name: '阿里巴巴招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: '' },
  { id: 'baidu', name: '百度招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: '' },
  { id: 'meituan', name: '美团招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: 'live' },
  { id: 'jd', name: '京东招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: '' },
  { id: 'netease', name: '网易招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: '' },
  { id: 'xiaomi', name: '小米招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: '' },
  { id: 'kuaishou', name: '快手招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: '' },
  { id: 'mihoyo', name: '米哈游招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: '' },
  { id: 'iflytek', name: '科大讯飞招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: 'live' },
  { id: 'byd', name: '比亚迪招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: 'offline' },
  { id: 'zte', name: '中兴通讯招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: 'live' },
  { id: 'pdd', name: '拼多多招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: 'live' },
  { id: 'huatai', name: '华泰证券招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: 'offline' },
  { id: 'cmb', name: '招商银行招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: 'offline' },
  { id: 'hikvision', name: '海康威视招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: 'live' },
  { id: 'sf', name: '顺丰招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: 'offline' },
  { id: 'lenovo', name: '联想招聘', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: 'offline' },
  { id: 'nowcoder', name: '牛客校招', channel: '牛客', needsLogin: false, kwSearch: false, urlOnly: false, verified: '' },
  { id: 'shixiseng', name: '实习僧', channel: '实习僧', needsLogin: false, kwSearch: true, urlOnly: false, verified: '' },
  { id: 'boss', name: 'BOSS直聘', channel: 'BOSS直聘', needsLogin: true, kwSearch: true, urlOnly: false, verified: '' },
  { id: 'moka', name: 'Moka 托管页', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: false, verified: '' },
  { id: 'feishu', name: '飞书招聘托管页', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: true, verified: '' },
  { id: 'beisen', name: '北森托管页', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: true, verified: '' },
  { id: 'generic', name: '任意页面（通用）', channel: '官网投递', needsLogin: false, kwSearch: false, urlOnly: true, verified: '' },
]

/** 页面上展示用的优先排序：实测可用 > 未验证 > 实测不可用（后者置灰） */
const VERIFIED_ORDER: Record<CrawlSite['verified'], number> = { live: 0, '': 1, offline: 2 }

export function crawlSitesForPicker(): CrawlSite[] {
  return [...CRAWL_SITES].sort((a, b) => VERIFIED_ORDER[a.verified] - VERIFIED_ORDER[b.verified] || a.name.localeCompare(b.name, 'zh'))
}
