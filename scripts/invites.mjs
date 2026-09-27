#!/usr/bin/env node
/**
 * 造邀请码：`npm run invites 6` → 打印 6 枚码 + **一行可以直接替换的源码**。
 *
 * 只做参数解析与打印，规则全在 `src/lib/invites.ts`（那边有断言）。
 * 之所以给成 CLI 而不是"你自己 import 一下"：这一步是**发给别人之前**做的，
 * 手搓的码会踩念混与错位两类坑，而那两类错都只在用户当面进不来时才暴露。
 */
import { generateCodes, renderSourceLine } from '../src/lib/invites.ts'

const arg = process.argv[2]
const count = arg === undefined ? 6 : Number(arg)

try {
  const codes = generateCodes(count)
  console.log('把下面这一行替换进 src/lib/registration.ts 的 INVITE_CODES：\n')
  console.log(renderSourceLine(codes))
  console.log('\n发给人时可以逐个给（谁用哪一个，将来能追）：')
  codes.forEach((c, i) => console.log(`  ${i + 1}. ${c}`))
  console.log('\n提醒：这些码是准入口令，不是密钥——它们最终在源码与产物里。')
  console.log('改完要重新发布才生效；服务端 sign-up 那一半仍需在云控制台关（见 docs/HANDOFF.md 5b）。')
} catch (error) {
  console.error(String(error?.message ?? error))
  console.error('用法：npm run invites [数量 1..200]（默认 6）')
  process.exit(1)
}
