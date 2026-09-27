/**
 * 把版本号注进 index.html —— 让「线上现在跑的是哪一版」变成一句话就能问出来的事。
 *
 * 为什么需要它（2026-09-27 真实踩到）：发布 `5f2a30e` 之后前端源码一行没动，产物文件名、字节数、
 * 内容全部与上一次相同，于是"已发布新代码"和"还在跑旧代码"从线上**完全无法区分**。
 * 当时唯一的候选证据是 ETag / Last-Modified，而实测那 12 分钟里没有任何新提交、mtime 照样被推前
 * （沙箱重启同样改它）—— 时间型证据不能当发布判别器，只有内容型证据可以。
 *
 * 所以这里注的是一个**可 grep 的内容标记**：发版后 `curl -s <站点>/ | grep app-version` 一步到位。
 * 版本号一律从 package.json 传进来，本文件不许出现任何版本字面量 —— 写死的标记在升级后会变成假话，
 * 而假话比没标记更坏。空值直接抛，不静默注一个空 meta（空 meta 永远 grep 得到，等于伪验证）。
 */

export function appVersionPlugin(version) {
  const v = String(version ?? '').trim()
  if (!v) {
    throw new Error('appVersionPlugin 需要一个非空版本号：空标记会让「grep 到了」变成假证据')
  }
  return {
    name: 'iwb-app-version',
    // 只在构建期跑：dev 服务器不需要这行 meta，注入它只会让本地和产物的 HTML 长得不一样
    apply: 'build',
    transformIndexHtml(html) {
      if (!String(html).includes('</head>')) {
        throw new Error('index.html 里找不到 </head>，版本标记注不进去 —— 请检查模板，不要悄悄跳过')
      }
      return String(html).replace('</head>', `    <meta name="app-version" content="${v}" />\n  </head>`)
    },
  }
}
