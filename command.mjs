#!/usr/bin/env node
/**
 * 「发一句话就推送」的入口 —— 供 GitHub Actions 每 5 分钟轮询一次。
 *
 * 流程：取 Telegram 的最新一条未确认消息 → 确认掉（避免下轮重复处理）
 *      → 命中触发词就现生成一份简报，回到发送者的会话里。
 *
 * 触发词：新闻 / 新聞 / news / 日报 / 日報
 */

import { loadConfig, loadDotEnv } from './src/config.mjs'
import { runPipeline } from './src/pipeline.mjs'
import { messageTextOf, takeLatestUpdate } from './src/telegram.mjs'

const TRIGGER = /新闻|新聞|news|日报|日報/i
const MAX_AGE_SECONDS = 30 * 60

async function main() {
  await loadDotEnv()
  const config = loadConfig()

  if (!config.telegram.token) {
    console.error('[news] 缺少 NEWS_TELEGRAM_TOKEN')
    process.exit(1)
  }

  const update = await takeLatestUpdate({ token: config.telegram.token })
  if (!update) {
    console.log('[news] 没有新的 Telegram 消息')
    return
  }

  const message = update.message ?? update.edited_message ?? null
  const text = messageTextOf(update)
  const chatId = message?.chat?.id
  const ageSeconds = typeof message?.date === 'number' ? Math.floor(Date.now() / 1000) - message.date : 0

  if (!message || chatId === undefined || chatId === null) {
    console.log('[news] 不是文本消息，忽略')
    return
  }
  if (ageSeconds > MAX_AGE_SECONDS) {
    console.log(`[news] 消息已过去 ${ageSeconds} 秒，忽略（避免补答旧消息）`)
    return
  }
  if (!TRIGGER.test(text)) {
    console.log(`[news] 不是触发词，忽略：${text.slice(0, 30)}`)
    return
  }

  console.log(`[news] 收到「${text}」，开始生成…`)

  // 回到发送者的会话（私聊就是本人；群里就是那个群）
  const target = {
    ...config,
    channel: 'telegram',
    telegram: { ...config.telegram, chatId: String(chatId) },
  }

  const result = await runPipeline(target, { log: (message) => console.log(message) })
  console.log(`[news] 完成：${result.text.length} 字，${result.headlines.domestic} 国内 / ${result.headlines.international} 国际`)
}

main().catch((error) => {
  console.error(`[news] 失败：${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
