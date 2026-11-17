/** Telegram Bot API：发送消息 + 拉取更新（用于「发新闻就推送」）。 */

import { splitMessage } from './push.mjs'

const TELEGRAM_LIMIT_CHARS = 3800 // 官方上限 4096 字符，留余量

function apiBase(token) {
  return `https://api.telegram.org/bot${token}`
}

async function call(token, method, payload, { fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(`${apiBase(token)}/${method}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    })
    const raw = await response.text()
    let parsed = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
    if (!response.ok || parsed?.ok === false) {
      const description = parsed?.description ?? raw.slice(0, 200)
      throw new Error(`Telegram ${method} 失败：HTTP ${response.status} ${description}`)
    }
    return parsed
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 发送文本到 Telegram。超长自动分段（按字符数，Telegram 按字符计限）。
 * @returns {Promise<{ ok: boolean, parts: number }>}
 */
export async function pushTelegram({
  token,
  chatId,
  text,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
  delayMs = 800,
} = {}) {
  if (!token) throw new Error('缺少 Telegram Bot Token（NEWS_TELEGRAM_TOKEN）')
  if (!chatId) throw new Error('缺少 Telegram Chat ID（NEWS_TELEGRAM_CHAT_ID）')

  const parts = splitMessage(text, TELEGRAM_LIMIT_CHARS, 'chars')
  if (parts.length === 0) throw new Error('没有可推送的内容')

  for (let index = 0; index < parts.length; index += 1) {
    const prefix = parts.length > 1 ? `（${index + 1}/${parts.length}）\n` : ''
    await call(
      token,
      'sendMessage',
      {
        chat_id: chatId,
        text: `${prefix}${parts[index]}`,
        disable_web_page_preview: true,
      },
      { fetchImpl, timeoutMs },
    )
    if (index < parts.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  return { ok: true, parts: parts.length }
}

/**
 * 取出「最新一条未确认」的更新并立刻确认掉，避免下次轮询重复处理。
 * 用 offset=-1 拿最后一条，再用 offset=update_id+1 确认。
 * @returns {Promise<object|null>} Telegram Update 对象，没有新消息时返回 null
 */
export async function takeLatestUpdate({ token, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (!token) throw new Error('缺少 Telegram Bot Token')
  const latest = await call(token, 'getUpdates', { offset: -1, limit: 1, timeout: 0 }, { fetchImpl, timeoutMs })
  const update = Array.isArray(latest?.result) ? latest.result[0] : undefined
  if (!update) return null

  // 确认：把这条及之前的全部标记为已读
  await call(token, 'getUpdates', { offset: update.update_id + 1, limit: 1, timeout: 0 }, { fetchImpl, timeoutMs })
  return update
}

export function messageTextOf(update) {
  const message = update?.message ?? update?.edited_message ?? null
  const text = message?.text
  return typeof text === 'string' ? text.trim() : ''
}
