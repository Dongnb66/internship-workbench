import fs from 'node:fs'
const f = process.argv[2]
const d = JSON.parse(fs.readFileSync(f, 'utf8'))
const a = Array.isArray(d) ? d : d.jobs || d.data || []
console.log('条数:', a.length)
a.slice(0, 12).forEach((j, i) => {
  console.log(`${i + 1}. [${j.title || ''}]  公司:${j.company || '-'}  城市:${j.city || '-'}  薪资:${j.salary || '-'}`)
  console.log(`    url: ${String(j.url || '').slice(0, 90)}`)
})
