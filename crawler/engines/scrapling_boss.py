#!/usr/bin/env python3
"""
BOSS 直聘抓取引擎（Scrapling / patchright 内核）。

为什么存在：BOSS 页面挂了 browser-check-v2.js 浏览器检测 SDK，项目在 Playwright 栈下
拿到的是 8.5KB 空壳 + 0 张卡片，换真 Edge 内核 / 抹 navigator.webdriver / 换 UA 都无效。
patchright 的反检测能力能过这一关。**只服务 BOSS 一个站点。**

分工（刻意如此）：
  - 本文件只做三件事：开 headed 浏览器 → 读列表页卡片 → 解码薪资，然后把**裸 jobs** 吐给 stdout。
  - 产出文件的格式**不在这里拼**。Node 侧（lib/scrapling.mjs）复用 run.mjs 同一个 makePayload，
    所以「网页端批量导入读得了」是构造上成立的，不靠两边手抄字段名。
  - 安全停止判据也不在这里：本文件只回传页面文本，命中哪条规则由 lib/stopRules.mjs 决定，
    避免出现第二份风控清单、跟契约测试那份飘掉。

stdout = 机器读的 JSON；stderr = 给人看的进度。混了就没法 parse。

用法：
  python scrapling_boss.py --profile DIR --login
  python scrapling_boss.py --profile DIR --keyword "AI Agent 实习" --pages 1
"""
import argparse
import json
import pathlib
import re
import sys
import time
import traceback
import urllib.parse

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_NO_LOGIN = 3
EXIT_DEPENDENCY = 4
# 「引擎自己崩了」必须和「这个站点今天没数据」在退出码上是两回事：
# 前几轮有两次诊断代码异常被 scrapling 咽掉，症状伪装成 0 张卡片（风控）。
EXIT_ENGINE_ERROR = 5

SITE = "https://www.zhipin.com"
LIST_URL = SITE + "/web/geek/job?query={kw}&city={city}&page={page}"

# 下面三条不是优化项，是「能不能拿到数据」的前提：违反任何一条都是 0 张卡片，
# 且被风控后约 90 秒才恢复。headless 更是直接不给开关 —— 无头一律空列表。
PRE_REQUEST_SLEEP = 5
PAGE_INTERVAL_SLEEP = 12
CARD_WAIT_TICKS = 20  # 每 tick 1 秒，最多等 20 秒让卡片渲染出来

# 薪资是字体反爬：数字被换成 Unicode 私有区（PUA）码位，靠自定义字体画出正确字形，
# innerText 拿到的是码位。2026-10 实测该映射连续：U+E031 + n == 数字 n。
# ⚠️ BOSS 会换映射，所以连续映射只当**兜底**；每次跑都现场量一次校验，见 PROBE。
SALARY_PUA_BASE = 0xE031
# 与 lib/normalize.mjs:41 的 OBFUSCATED 同一个判据：带私有区码位的值一律不可信。
# 默认（不带 --decode-salary）时按这条规则**丢弃**薪资，绝不把原始码位塞进 jobs ——
# 那会在岗位池里渲染成一排空框，比留个空字符串更坏。
OBFUSCATED_RE = re.compile("[\uE000-\uF8FF]")

CARD_SELECTORS = "li.job-card-wrapper, .job-card-wrapper, .job-card-box"
# 卡片类名是 2026-10 实测的：岗位名 .job-name、薪资 .job-salary、
# 公司 .boss-name、城市 .company-location。踩过的坑：.job-area 和 .salary 取出来全空。
JOB_FIELDS = (
    ("title", ".job-name"),
    ("salary", ".job-salary"),
    ("company", ".boss-name"),
    ("city", ".company-location"),
)

# 用页面**自己生效的字体**把 0~9 和页面上出现的每个 PUA 码位分别画进 canvas，
# 按像素海明距离取最近 —— 得到现场映射。距离 >3 视为抗锯齿噪声外的不可信判定。
PROBE = r"""
async () => {
  // 关键：等 webfont 真加载完再量。没等就会用回退字形画，
  // 与 0~9 的像素海明距离虚高到 10+，把正确映射整批误拒（2026-10-02 真跑实测就是这个形态）。
  try { await document.fonts.ready; } catch (e) {}
  const els = document.querySelectorAll('.job-salary');
  if (!els.length) return { error: 'no .job-salary' };
  const cs = getComputedStyle(els[0]);
  const fontSpec = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;

  const cv = document.createElement('canvas');
  cv.width = 44; cv.height = 52;
  const ctx = cv.getContext('2d', { willReadFrequently: true });

  const sig = (ch) => {
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#000';
    ctx.font = fontSpec;
    ctx.textBaseline = 'top';
    ctx.fillText(ch, 3, 3);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const bits = new Uint8Array(cv.width * cv.height);
    let k = 0;
    for (let i = 3; i < d.length; i += 4) bits[k++] = d[i] > 60 ? 1 : 0;
    return bits;
  };

  const hamming = (a, b) => {
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
  };

  const refs = {};
  for (let i = 0; i <= 9; i++) refs[String(i)] = sig(String(i));

  const pua = new Set();
  els.forEach((n) => {
    for (const ch of n.textContent) {
      const c = ch.codePointAt(0);
      if (c >= 0xe000 && c <= 0xf8ff) pua.add(c);
    }
  });

  const rows = [];
  for (const cp of pua) {
    const s = sig(String.fromCodePoint(cp));
    const scored = Object.entries(refs)
      .map(([d, rs]) => [d, hamming(s, rs)])
      .sort((a, b) => a[1] - b[1]);
    rows.push({ cp, best: scored[0][0], bestDist: scored[0][1], secondDist: scored[1][1] });
  }
  return { fontSpec, rows };
}
"""


# 进度走 stderr：编不出来时替换掉，而不是抛异常（机器读的 stdout 保真，
# 给人看的 stderr 保活，两边目标不同）
try:
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def emit(payload, code):
    """唯一出口：结果只走 stdout，进度只走 stderr。"""
    payload["exit_code"] = code
    # ensure_ascii=True 是刻意的：Windows 中文系统下子进程的 stdout 默认 GBK，
    # 页面文本里那种私有区码位（U+E031 起的一段）根本编不出来，会 UnicodeEncodeError
    # 把整轮弄崩在最后一米。转义成纯 ASCII 后对任何 codepage / 任何调用方都免疫。
    json.dump(payload, sys.stdout, ensure_ascii=True)
    sys.stdout.write("\n")
    sys.stdout.flush()
    return code


def contiguous_digit(codepoint):
    n = codepoint - SALARY_PUA_BASE
    return str(n) if 0 <= n <= 9 else None


def make_decoder(mapping, warnings):
    """mapping 是**共享可变**字典：第 1 页现场量出来的结果写回它，后续页自动沿用。

    解不出来的码位**绝不静默通过**：不填 '?'、不留原字符、不猜数字，
    而是把 (码位) 记进 problems 并让调用方把这条薪资整体置 None。
    理由：一个会安静给出错数字的解析器，比一个会报错的解析器危险得多。
    """

    def decode(text, problems=None):
        out = []
        unresolved = []
        for ch in str(text or ""):
            cp = ord(ch)
            if not 0xE000 <= cp <= 0xF8FF:
                out.append(ch)
                continue
            if cp in mapping:
                out.append(mapping[cp])
                continue
            guess = contiguous_digit(cp)
            if guess is None:
                unresolved.append(f"U+{cp:04X}")
                out.append(ch)
                continue
            if mapping:
                # 这一轮确实跑了现场测量，只是这个码位不在样本里 —— 值得逐位点名
                warnings.add(
                    f"U+{cp:04X} 不在现场测量样本里，按连续映射当 {guess} 处理 —— "
                    "这一位**未被现场测量证实**，BOSS 换映射时这种外推会给出错数字"
                )
            out.append(guess)
        if unresolved and problems is not None:
            problems.extend(sorted(set(unresolved)))
            return None
        return "".join(out)

    return decode


def measure_salary_map(page, mapping, warnings, verbose=False):
    """返回 (font_spec, measurements)；可信映射就地写进共享的 mapping，不可信的显式说明为什么不用。

    刻意不往调用方的闭包里写东西：上一版在这里给一个不存在的 payload_state 赋值，
    异常被 scrapling 吞成一句「Error executing page_action」，症状与「BOSS 给了 0 张卡片」
    完全一样 —— 诊断路径自己把抓取弄死，这是第二次（上一次是 set 上调 .append）。
    """
    try:
        raw = page.evaluate(PROBE)
    except Exception as exc:
        warnings.add(f"字体映射现场测量失败，本轮回落连续映射：{str(exc)[:120]}")
        return "", []

    if not raw or raw.get("error"):
        warnings.add(f"字体映射现场测量无结果，本轮回落连续映射：{(raw or {}).get('error')}")
        return "", []

    kept = 0
    measurements = []
    for row in raw.get("rows", []):
        cp, best, dist, second_dist = row["cp"], str(row["best"]), row["bestDist"], row["secondDist"]
        if verbose:
            measurements.append({
                "codepoint": f"U+{cp:04X}",
                "digit": best,
                "distance": dist,
                "second_distance": second_dist,
                "trusted": dist <= 3 and (second_dist - dist) >= 2,
            })
        if dist > 3:
            warnings.add(f"U+{cp:04X}→{best} 海明距离 {dist} > 3，不信，回落连续映射")
            continue
        if second_dist - dist < 2:
            warnings.add(f"U+{cp:04X} 次选只领先 {second_dist - dist}，不可分辨，回落连续映射")
            continue
        mapping[cp] = best
        kept += 1
        if contiguous_digit(cp) != best:
            warnings.add(
                f"⚠ U+{cp:04X} 现场判定 {best}，连续映射会是 {contiguous_digit(cp)} —— "
                "BOSS 已换映射，本轮以现场值为准"
            )
    log(f"  字体映射：现场量出 {kept} 个可信码位（共量 {len(measurements)} 个码位）")
    return raw.get("fontSpec", ""), (measurements if verbose else [])


def parse_cards(page, decode, decode_salary):
    """字段取不到的留空，不猜；薪资按开关决定「丢弃」还是「解码」。"""
    try:
        cards = page.query_selector_all(CARD_SELECTORS)
    except Exception as exc:
        log(f"  取卡片失败：{exc}")
        return [], 0

    parsed = []
    for card in cards:
        try:
            row = {}
            for field, sel in JOB_FIELDS:
                el = card.query_selector(sel)
                row[field] = el.inner_text().strip() if el else ""
            if not row["title"]:
                continue
            raw_salary = row["salary"]
            row["__obf"] = bool(OBFUSCATED_RE.search(raw_salary))
            if decode_salary and row["__obf"]:
                problems = []
                row["salary"] = decode(raw_salary, problems)
                if problems:
                    row["__bad"] = problems
            elif row["__obf"]:
                # 默认路径：守 OBFUSCATED 这条线，整条薪资丢成空串
                row["salary"] = ""
            link = card.query_selector("a[href*='/job_detail/']")
            url = (link.get_attribute("href") if link else "") or ""
            row["url"] = SITE + url if url.startswith("/") else url
            parsed.append(row)
        except Exception:
            continue
    return parsed, len(cards)


def page_wall_text(page):
    """标题 + 正文前 6000 字，交给 Node 的 detectStopWall 判停。"""
    try:
        title = page.title() or ""
    except Exception:
        title = ""
    try:
        body = page.inner_text("body")[:6000]
    except Exception:
        body = ""
    # 只用来喂 lib/stopRules.mjs 的关键词匹配，所以把私有区码位剔掉：
    # 那些字符是薪资渲染的副产物，既不影响判停，又会把 6KB 的原始码位塞进 stdout
    return OBFUSCATED_RE.sub("", f"{title} {body}").strip()


def looks_logged_in(page):
    try:
        txt = page.inner_text("body")[:3000]
    except Exception:
        return False
    if "登录/注册" in txt or "登录 / 注册" in txt:
        return False
    return any(kw in txt for kw in ["我的简历", "消息", "个人中心", "退出登录", "我的"])


def open_session(profile, **kw):
    from scrapling.fetchers import StealthySession

    opts = dict(
        headless=False,
        user_data_dir=str(profile),
        network_idle=True,
        wait=4000,
        timeout=120000,
        locale="zh-CN",
    )
    opts.update(kw)
    return StealthySession(**opts)


def list_url(keyword, city, page_no):
    return LIST_URL.format(kw=urllib.parse.quote(keyword), city=urllib.parse.quote(city), page=page_no)


def do_login(profile, city, timeout_s):
    state = {"ok": False, "wall_text": ""}

    def action(page):
        log("  窗口已打开，请自己扫码/输密码登录（引擎不代填账号密码）")
        for i in range(max(1, timeout_s // 5)):
            page.wait_for_timeout(5000)
            if looks_logged_in(page):
                state["ok"] = True
                log(f"  ✅ 第 {i * 5}s 检测到已登录，会话已存进档案目录")
                return
            if i % 6 == 0:
                log(f"  等待登录中… {i * 5}s")
        state["wall_text"] = page_wall_text(page)
        log("  ⏱ 超时未检测到登录")

    with open_session(profile, page_action=action) as s:
        s.fetch(list_url("AI Agent", city, 1))
    return state


def _grab_body(page, ctx):
    """page_action 的本体。刻意提成模块级函数：这样它能被**离线**覆盖（假 page 就能测），
    不必为了验证一条错误处理路径去真打一次 BOSS 再冷却 90 秒。"""
    outcome = ctx["outcome"]
    for _ in range(CARD_WAIT_TICKS):
        page.wait_for_timeout(1000)
        if page.query_selector_all("li.job-card-wrapper, .job-card-wrapper"):
            break
    outcome["logged_in"] = looks_logged_in(page)
    # 字体对账默认**不跑**（实测每轮误拒 6/9 个码位，一条每轮喊 6 次的防线等于没有防线）。
    # 只有显式 --check-salary-font 才量，且把每个码位的海明距离一起回传。
    state = ctx["state"]
    if ctx["check_font"] and not state["measured"]:
        state["font_spec"], state["measurements"] = measure_salary_map(
            page, ctx["mapping"], ctx["warnings"], verbose=True
        )
        state["measured"] = True
    jobs, cards = parse_cards(page, ctx["decode"], ctx["decode_salary"])
    outcome["jobs"] = jobs
    outcome["cards"] = cards
    ctx["wall_parts"].append(page_wall_text(page))


def guarded_page_action(action, page, ctx):
    """只包 page_action 这一层的**未处理异常**：

    scrapling 会把 page_action 里的异常咽成一行「Error executing page_action」，
    页面照样返回 0 张卡片 —— 于是「引擎代码崩了」在症状上和「BOSS 今天不给数据」**完全同形**。
    这一层把 traceback 原样留下并标记引擎内部错误，退出码用 EXIT_ENGINE_ERROR（5），
    与「抓到 0 条」（正常退出 0 + 空 jobs）**区分开**。

    注意边界：**不**把所有异常都改成硬失败 —— 命中安全停止清单（验证码/登录墙/风控）
    是 `lib/stopRules.mjs` 的**有意的正常停止**，那条路走的是「返回 wall_text 交给 Node 判」，
    不经过这里，所以不会被这层伪装成引擎故障。
    """
    try:
        action(page, ctx)
    except Exception:
        ctx["engine_error"] = traceback.format_exc()


def do_crawl(profile, keyword, pages, city, limit, decode_salary, check_font):
    warnings = set()
    mapping = {}
    collected = []
    wall_parts = []
    logged_in = None
    # 闭包里要改的的量，放同一个字典：nonlocal 写在嵌套函数里很容易漏
    state = {"measured": False, "font_spec": "", "measurements": []}
    engine_error = {"tb": ""}

    with open_session(profile) as s:
        for index in range(1, pages + 1):
            log(f"\n▶ 第 {index}/{pages} 页（先等 {PRE_REQUEST_SLEEP}s 再请求，尊重风控）")
            time.sleep(PRE_REQUEST_SLEEP)

            ctx = {
                "decode": make_decoder(mapping, warnings),
                "outcome": {"cards": 0, "jobs": [], "logged_in": None},
                "mapping": mapping,
                "warnings": warnings,
                "state": state,
                "wall_parts": wall_parts,
                "check_font": check_font,
                "decode_salary": decode_salary,
            }

            def grab(page):
                guarded_page_action(_grab_body, page, ctx)
                if ctx.get("engine_error"):
                    engine_error["tb"] = ctx["engine_error"]

            try:
                s.fetch(list_url(keyword, city, index), page_action=grab)
                logged_in = outcome["logged_in"]
            except Exception as exc:
                # 不重试：被风控时重试只会加速封号。停止与否由 Node 侧的停止清单判。
                warnings.add(f"第 {index} 页抓取异常，按「遇到就停」不再重试：{str(exc)[:120]}")
                break

            log(f"  卡片 {outcome['cards']} 张，解析 {len(outcome['jobs'])} 条")
            collected.extend(outcome["jobs"])
            if not outcome["jobs"]:
                log("  本页 0 条，停止翻页（继续请求只会加重风控）")
                break
            if index < pages:
                log(f"  页间等待 {PAGE_INTERVAL_SLEEP}s…")
                time.sleep(PAGE_INTERVAL_SLEEP)

    seen = set()
    uniq = []
    for job in collected:
        key = (job["company"], job["title"], job["city"])
        if key in seen:
            continue
        seen.add(key)
        uniq.append(job)
    if decode_salary and not state["measured"]:
        warnings.add(
            "本轮**未做现场对账**：薪资值来自内置连续映射（U+E031+n，2026-10 实测表），不是当次页面证实的。"
            "要核对映射就加 --check-salary-font"
        )
    if len(uniq) > limit:
        log(f"  本次上限 {limit} 条，其余 {len(uniq) - limit} 条丢弃")
        uniq = uniq[:limit]

    # 「第几条」必须对着**最终产出的那份列表**数，所以放到 dedupe / 截断之后才算，
    # 并且算完就把内部标记摘掉——__bad / __obf 不该进 jobs。
    undecoded = []
    dropped = 0
    for position, job in enumerate(uniq, start=1):
        bad = job.pop("__bad", None)
        obf = job.pop("__obf", False)
        if bad:
            undecoded.append({"index": position, "title": job["title"], "codepoints": bad})
        elif obf and not decode_salary:
            dropped += 1
    if undecoded:
        log(f"  ⚠ {len(undecoded)} 条薪资未能解码（已置空，不是「数据源没给」）：")
        for item in undecoded:
            log(f"     第 {item['index']} 条 {item['title'][:30]} —— 认不出的码位 {', '.join(item['codepoints'])}")

    return {
        "jobs": uniq,
        "engine_error": engine_error["tb"],
        "salary_mode": "decoded" if decode_salary else "obfuscated_dropped",
        # 默认**不做**每轮现场对账：2026-10-02 实测它会把 6/9 个码位误判为不可信，
        # 每轮喊 6 次的防线等于没有防线。要看完整测量请加 --check-salary-font。
        "salary_map": {
            "font_spec": state["font_spec"],
            "measured_entries": len(mapping),
            "measured": state["measured"],
            "reconciled_this_run": state["measured"],
            "measurements": state["measurements"],
        },
        "salary_dropped": dropped,
        "salary_undecoded": {"count": len(undecoded), "items": undecoded},
        "wall_text": "\n".join(wall_parts)[:6000],
        "logged_in": logged_in,

        "warnings": sorted(warnings),
    }


def main():
    parser = argparse.ArgumentParser(description="BOSS 直聘 Scrapling 引擎（stdout 出 JSON，stderr 出进度）")
    parser.add_argument("--keyword", default="", help="岗位关键词，可含空格")
    parser.add_argument("--pages", type=int, default=1)
    parser.add_argument("--limit", type=int, default=60)
    parser.add_argument("--city", default="100010000", help="BOSS 城市码，默认全国")
    parser.add_argument("--profile", required=True, help="持久档案目录，登录态存这里")
    parser.add_argument("--login", action="store_true", help="只开窗口让用户登录，不抓取")
    parser.add_argument("--login-timeout", type=int, default=900, help="--login 最长等待秒数")
    parser.add_argument(
        "--check-salary-font",
        action="store_true",
        help="可选诊断：现场量一遍薪资字体映射并输出每个码位的海明距离。默认不跑（实测会大面积误拒）",
    )
    parser.add_argument(
        "--decode-salary",
        action="store_true",
        help="显式解开薪资的字体混淆。默认关：关着时带私有区码位的薪资一律丢弃为空（见 crawler/README.md 那条政策线）",
    )
    args = parser.parse_args()

    profile = pathlib.Path(args.profile).expanduser().resolve()
    profile.mkdir(parents=True, exist_ok=True)

    try:
        import scrapling  # noqa: F401
    except Exception as exc:
        print(f"scrapling 导入失败：{exc}", file=sys.stderr)
        return emit({"ok": False, "error": f"scrapling 导入失败：{exc}"}, EXIT_DEPENDENCY)

    if args.login:
        state = do_login(profile, args.city, args.login_timeout)
        return emit(
            {
                "ok": state["ok"],
                "mode": "login",
                "jobs": [],
                "wall_text": state["wall_text"],
                "logged_in": state["ok"],
                "warnings": [],
            },
            EXIT_OK if state["ok"] else EXIT_NO_LOGIN,
        )

    if not args.keyword.strip():
        print("--keyword 不能为空（BOSS 无关键词时列表页不稳定）", file=sys.stderr)
        return EXIT_USAGE

    result = do_crawl(
        profile,
        args.keyword.strip(),
        max(1, args.pages),
        args.city,
        max(1, args.limit),
        args.decode_salary,
        args.check_salary_font,
    )
    if result.get("engine_error"):
        print("", file=sys.stderr, flush=True)
        print("===== 引擎内部错误（不是站点没数据）=====", file=sys.stderr, flush=True)
        print(result["engine_error"], file=sys.stderr, flush=True)
        print("上面的 traceback 是引擎自己的代码异常，与 BOSS 是否给数据无关。", file=sys.stderr, flush=True)
    return emit(
        {
            "ok": True,
            "mode": "crawl",
            "engine": "scrapling",
            "site_id": "boss",
            "keyword": args.keyword.strip(),
            "pages_requested": max(1, args.pages),
            "salary_font_base": hex(SALARY_PUA_BASE),
            **result,
        },
        EXIT_ENGINE_ERROR if result.get("engine_error") else EXIT_OK,
    )


if __name__ == "__main__":
    sys.exit(main())
