#!/usr/bin/env node
/**
 * Telegram 通道自测：不联网、不需要真实 token。
 *
 * 覆盖三件事：
 *   1. 超长文本按字符分段（Telegram 按字符计限，不是字节）
 *   2. sendMessage 的 chat_id / text 是否正确
 *   3. getUpdates 的「取最新一条 + 立刻确认」语义（避免每轮重复回复）
 */

import { pushTelegram, takeLatestUpdate, messageTextOf } from '../src/telegram.mjs'
import { splitMessage } from '../src/push.mjs'

const failures = []
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`)
    return
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}

const calls = []
let pendingUpdate = { update_id: 42, message: { text: '新闻', chat: { id: 123 }, date: Math.floor(Date.now() / 1000) } }

const fakeFetch = async (url, init = {}) => {
  const method = String(url).split('/').pop()
  const body = JSON.parse(init.body ?? '{}')
  calls.push({ method, body })

  if (method === 'sendMessage') {
    return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }), { status: 200 })
  }
  if (method === 'getUpdates') {
    if (body.offset === -1) {
      const result = pendingUpdate ? [pendingUpdate] : []
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 })
    }
    // 确认调用：把待处理的消息清空
    pendingUpdate = null
    return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 })
  }
  return new Response(JSON.stringify({ ok: false, description: 'unexpected method' }), { status: 404 })
}

async function main() {
  console.log('分段（按字符）：')
  const long = Array.from({ length: 120 }, () => '这是一句用于测试 Telegram 分段的中文内容。').join('')
  const chunks = splitMessage(long, 100, 'chars')
  check('切成多段', chunks.length > 1, `${chunks.length} 段`)
  check('每段不超过 100 字符', chunks.every((chunk) => chunk.length <= 100))
  check('拼接后不丢内容', chunks.join('') === long)

  console.log('\n发送：')
  await pushTelegram({ token: 'T', chatId: '999', text: '测试简报', fetchImpl: fakeFetch })
  const sendCall = calls.find((call) => call.method === 'sendMessage')
  check('调用了 sendMessage', Boolean(sendCall))
  check('chat_id 正确', sendCall?.body?.chat_id === '999', String(sendCall?.body?.chat_id))
  check('正文正确', sendCall?.body?.text === '测试简报', String(sendCall?.body?.text))

  console.log('\n取更新 + 确认：')
  const update = await takeLatestUpdate({ token: 'T', fetchImpl: fakeFetch })
  check('拿到最新一条', update?.update_id === 42, String(update?.update_id))
  check('能取出消息文本', messageTextOf(update) === '新闻', messageTextOf(update))

  const offsetCalls = calls.filter((call) => call.method === 'getUpdates')
  check('先问最新（offset=-1）', offsetCalls[0]?.body?.offset === -1, String(offsetCalls[0]?.body?.offset))
  check('再确认（offset=43）', offsetCalls[1]?.body?.offset === 43, String(offsetCalls[1]?.body?.offset))

  const again = await takeLatestUpdate({ token: 'T', fetchImpl: fakeFetch })
  check('确认过后不会重复取到同一条', again === null, JSON.stringify(again))

  console.log(`\n${failures.length === 0 ? '全部通过 ✅' : `失败 ${failures.length} 项 ❌`}`)
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  - ${failure}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('测试崩了：', error)
  process.exit(1)
})
