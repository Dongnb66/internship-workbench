/**
 * 网申表单自动填充
 * 匹配依据：可见文案（label / 前后文本）+ placeholder + name + id + aria-label
 * 只填普通输入框、文本域与下拉框；不动复选框、单选框、文件上传与验证码类字段。
 */

const FIELD_RULES = [
  { key: ['姓名', 'name', '真实姓名'], patterns: ['姓名', '真实姓名', '中文名', 'yourname', 'fullname', 'realname', 'username', 'name'], ignore: ['姓', 'lastname', 'firstname', '昵称', 'nickname', '项目名', '公司名', '学校名', '用户名'] },
  { key: ['性别'], patterns: ['性别', 'gender', 'sex'], ignore: ['性別', '性别要求'] },
  { key: ['联系电话', '手机号'], patterns: ['手机', '电话', 'mobile', 'phone', 'tel'], ignore: ['紧急', 'parent', '区号', '验证码'] },
  { key: ['电子邮箱', '常用邮箱'], patterns: ['邮箱', 'email', 'mail'], ignore: ['验证码', '确认'] },
  { key: ['学校'], patterns: ['学校', '院校', '毕业院校', 'school', 'university', 'college'], ignore: ['中学', '高中', '小学'] },
  { key: ['学历'], patterns: ['学历', 'degree', 'educationlevel'], ignore: ['最高'] },
  { key: ['专业'], patterns: ['专业', 'major', 'specialty'], ignore: ['第二', '辅修'] },
  { key: ['毕业年份'], patterns: ['毕业时间', '毕业年份', '毕业年月', 'graduation', 'graduatedate', 'gradyear'], ignore: [] },
  { key: ['年级'], patterns: ['年级', '在读', 'grade'], ignore: [] },
  { key: ['期望城市'], patterns: ['期望城市', '意向城市', '工作城市', '期望地点', 'city', 'location', 'expectcity'], ignore: ['现居', '户籍'] },
  { key: ['期望岗位'], patterns: ['期望职位', '意向岗位', '应聘岗位', '期望岗位', 'targetposition', 'expectposition', 'position'], ignore: ['当前岗位'] },
  { key: ['期望日薪'], patterns: ['期望薪资', '期望日薪', '薪资要求', 'salary', 'expectsalary'], ignore: ['月薪', '年薪'] },
  { key: ['可到岗时间'], patterns: ['到岗', '入职时间', '可实习时间', 'availablefrom', 'joindate', 'reportdate'], ignore: [] },
  { key: ['可实习时长'], patterns: ['实习时长', '实习期限', '可实习周期', 'duration', 'internperiod'], ignore: [] },
  { key: ['技能关键词'], patterns: ['技能关键词', '专业技能', '技术栈', '技能', 'techstack', 'skill', '专长'], ignore: ['技能等级', '技能证书', '语言能力', '技能培训'] },
  { key: ['GitHub'], patterns: ['github', '代码仓库', '开源'], ignore: [] },
  { key: ['作品集'], patterns: ['作品集', '个人主页', '博客', 'portfolio', 'website', 'homepage', 'blog'], ignore: [] },
  { key: ['一句话自我介绍'], patterns: ['自我介绍', '个人简介', '自我评价', 'selfintro', 'selfevaluation', 'introduction', 'aboutme'], ignore: ['为什么', '优势'] },
  { key: ['项目经历'], patterns: ['项目经历', '项目经验', '实习经历', '工作经历', 'projectexperience', 'experience'], ignore: ['教育经历'] },
]

const SKIP_TYPE = ['checkbox', 'radio', 'file', 'password', 'hidden', 'image', 'submit', 'button', 'reset', 'range', 'color']
const SKIP_KEYWORD = ['验证码', 'captcha', 'verify', '搜索', 'search', '确认密码', 'confirmpassword', '口令']

function visible(el) {
  const rect = el.getBoundingClientRect()
  const style = window.getComputedStyle(el)
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
}

function describe(el) {
  const parts = []
  const push = (v) => {
    if (v) parts.push(String(v))
  }
  push(el.getAttribute('placeholder'))
  push(el.getAttribute('aria-label'))
  push(el.getAttribute('title'))
  push(el.getAttribute('name'))
  push(el.getAttribute('id'))
  push(el.getAttribute('data-name'))

  if (el.labels) {
    for (const l of el.labels) push(l.textContent)
  }
  const wrapper = el.closest('label')
  if (wrapper) push(wrapper.textContent)

  const row = el.closest('.form-item, .form-group, .ant-form-item, .el-form-item, tr, li, div')
  if (row) push(row.textContent?.slice(0, 160))
  return parts.join(' ').toLowerCase().replace(/\s+/g, '')
}

function candidates() {
  const list = []
  const nodes = document.querySelectorAll('input, textarea, select')
  for (const el of nodes) {
    if (el.dataset.iwbFilled === '1') continue
    if (SKIP_TYPE.includes((el.getAttribute('type') || 'text').toLowerCase())) continue
    if (el.disabled || el.readOnly) continue
    if (!visible(el)) continue
    const text = describe(el)
    if (!text) continue
    if (SKIP_KEYWORD.some((k) => text.includes(k.toLowerCase()))) continue
    list.push({ el, text })
  }
  return list
}

function setValue(el, value) {
  const tag = el.tagName.toLowerCase()
  if (tag === 'select') {
    const options = Array.from(el.options || [])
    const target = options.find((o) => o.textContent.trim() === value) ||
      options.find((o) => o.textContent.includes(value) || value.includes(o.textContent.trim()))
    if (!target) return false
    el.value = target.value
  } else {
    el.focus()
    el.value = value
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new Event('blur', { bubbles: true }))
  el.dataset.iwbFilled = '1'
  const prev = el.style.outline
  el.style.outline = '2px solid #f2542d'
  el.style.outlineOffset = '1px'
  window.setTimeout(() => {
    el.style.outline = prev
  }, 6000)
  return true
}

window.__iwbFillApplyKit = function fillApplyKit(kit) {
  const pool = candidates()
  let filled = 0
  const used = new Set()

  for (const rule of FIELD_RULES) {
    let value = ''
    for (const k of rule.key) {
      if (kit[k]) {
        value = String(kit[k])
        break
      }
    }
    if (!value) continue

    let best = null
    let bestScore = 0
    for (const item of pool) {
      if (used.has(item.el)) continue
      if (rule.ignore.some((w) => item.text.includes(w.toLowerCase()))) continue
      let score = 0
      for (const p of rule.patterns) {
        if (item.text.includes(p.toLowerCase())) score = Math.max(score, p.length)
      }
      if (score > bestScore) {
        bestScore = score
        best = item.el
      }
    }
    if (!best) continue
    if (setValue(best, value)) {
      used.add(best)
      filled += 1
    }
  }

  return { filled, candidates: pool.length }
}
