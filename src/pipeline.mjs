/** 一次完整流水线：采集 → 生成 → 推送。 */

import { composeDigest } from './digest.mjs'
import { pushWecom } from './push.mjs'
import { pushTelegram } from './telegram.mjs'
import { collectHeadlines, DOMESTIC_SOURCES, INTERNATIONAL_SOURCES, renderCorpus } from './sources.mjs'

/**
 * @returns {Promise<{ ok: boolean, text: string, headlines: object, errors: string[], push: object|null, slotLabel: string }>}
 */
export async function runPipeline(config, { now = new Date(), fetchImpl, log = () => {} } = {}) {
  const options = { now, lookbackHours: config.lookbackHours, fetchImpl, perSource: 8 }

  const [domestic, international] = await Promise.all([
    collectHeadlines(DOMESTIC_SOURCES, options),
    collectHeadlines(INTERNATIONAL_SOURCES, options),
  ])

  const errors = [...domestic.errors, ...international.errors]
  log(`国内头条 ${domestic.items.length} 条，国际头条 ${international.items.length} 条`)
  if (errors.length > 0) log(`部分来源异常：${errors.join('；')}`)

  if (domestic.items.length + international.items.length === 0) {
    throw new Error(`没有抓到任何头条，未生成简报（${errors.join('；') || '来源全部为空'}）`)
  }

  const corpus = renderCorpus({ domestic: domestic.items, international: international.items })
  const { text, slotLabel } = await composeDigest({ config, corpus, now, fetchImpl })
  log(`简报生成完成：${slotLabel} ${text.length} 字`)

  let push = null
  if (config.dryRun) {
    log('DRY_RUN=1，跳过推送')
  } else if (config.channel === 'telegram') {
    push = await pushTelegram({
      token: config.telegram.token,
      chatId: config.telegram.chatId,
      text,
      fetchImpl,
    })
    log(`已推送到 Telegram：${push.parts} 段`)
  } else {
    push = await pushWecom({ webhook: config.wecomWebhook, text, fetchImpl })
    log(`已推送到企业微信：${push.parts} 段`)
  }

  return {
    ok: true,
    text,
    slotLabel,
    headlines: {
      domestic: domestic.items.length,
      international: international.items.length,
    },
    errors,
    push,
  }
}
