#!/usr/bin/env node
/**
 * 一次性执行入口 —— 交给系统 cron / 云函数定时触发。
 *
 *   node run.mjs
 *
 * 退出码：0 成功；1 失败（cron 会把非 0 视为失败）。
 */

import { loadConfig, loadDotEnv } from './src/config.mjs'
import { runPipeline } from './src/pipeline.mjs'

function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

async function main() {
  await loadDotEnv()
  const config = loadConfig()

  if (!config.dryRun && config.channel === 'telegram') {
    if (!config.telegram.token) {
      console.error('[news] 缺少 NEWS_TELEGRAM_TOKEN：请向 @BotFather 申请机器人后填入')
      process.exit(1)
    }
    if (!config.telegram.chatId) {
      console.error('[news] 缺少 NEWS_TELEGRAM_CHAT_ID：先给机器人发一句话，再用 getUpdates 查 chat.id')
      process.exit(1)
    }
  }
  if (!config.dryRun && config.channel === 'wecom' && !config.wecomWebhook) {
    console.error('[news] 缺少 NEWS_WECOM_WEBHOOK：请先在企业微信群里添加机器人并复制 Webhook')
    process.exit(1)
  }
  if (!config.llm.apiKey) {
    console.error('[news] 缺少 NEWS_LLM_KEY：简报需要模型生成，请填 DeepSeek API Key')
    process.exit(1)
  }

  const log = (message) => console.log(`[${stamp()}] ${message}`)
  try {
    const result = await runPipeline(config, { log })
    console.log('\n──────── 简报正文 ────────\n')
    console.log(result.text)
    console.log('\n──────────────────────────')
    log(`完成：国内 ${result.headlines.domestic} 条 / 国际 ${result.headlines.international} 条，${result.text.length} 字`)
  } catch (error) {
    console.error(`[${stamp()}] 失败：${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}

main()
