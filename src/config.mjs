/** 配置：全部来自环境变量，可选地从同目录 .env 读取（无第三方依赖）。 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** 极简 .env 解析：KEY=VALUE，支持 # 注释与首尾引号。已有环境变量优先。 */
export async function loadDotEnv(file = join(ROOT, '.env')) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function int(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseTimes(value, fallback) {
  const list = String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^\d{2}:\d{2}$/.test(item))
  return list.length > 0 ? [...new Set(list)].sort() : fallback
}

export function loadConfig(env = process.env) {
  // 没显式指定渠道时自动判断：有 Telegram token 就走 Telegram
  const explicitChannel = String(env.NEWS_CHANNEL ?? '').trim().toLowerCase()
  const channel = explicitChannel || (String(env.NEWS_TELEGRAM_TOKEN ?? '').trim() ? 'telegram' : 'wecom')
  return {
    channel,
    wecomWebhook: String(env.NEWS_WECOM_WEBHOOK ?? '').trim(),
    telegram: {
      token: String(env.NEWS_TELEGRAM_TOKEN ?? '').trim(),
      chatId: String(env.NEWS_TELEGRAM_CHAT_ID ?? '').trim(),
    },
    llm: {
      baseUrl: String(env.NEWS_LLM_BASE ?? 'https://api.deepseek.com').replace(/\/+$/, ''),
      apiKey: String(env.NEWS_LLM_KEY ?? '').trim(),
      model: String(env.NEWS_LLM_MODEL ?? 'deepseek-chat').trim(),
      maxTokens: int(env.NEWS_LLM_MAX_TOKENS, 4000),
    },
    timeZone: String(env.NEWS_TZ ?? 'Asia/Shanghai').trim(),
    times: parseTimes(env.NEWS_TIMES, ['08:00', '20:00']),
    domesticItems: int(env.NEWS_DOMESTIC, 5),
    internationalItems: int(env.NEWS_INTERNATIONAL, 10),
    maxChars: int(env.NEWS_MAX_CHARS, 3000),
    lookbackHours: int(env.NEWS_LOOKBACK_HOURS, 24),
    dryRun: String(env.NEWS_DRY_RUN ?? '0') === '1',
  }
}

/** 常驻模式的状态文件（记录哪些时段已经推过，避免重启重复推送）。 */
export function stateFile(env = process.env) {
  return String(env.NEWS_STATE_FILE ?? join(ROOT, '.state.json'))
}

export { ROOT }
