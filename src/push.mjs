/**
 * 推送通道：企业微信群机器人 + Telegram Bot。
 *
 * 限制：
 *   - 企业微信 markdown content 最大 4096 字节，每分钟最多 20 条
 *   - Telegram sendMessage 最大 4096 字符
 * 所以按「字节」或「字符」切段，段间不重复已发送内容。
 */

const WECOM_LIMIT_BYTES = 3800

function byteLength(text) {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * 按行切分，保证每段不超过 limit；单行超长时硬切。
 * @param {string} text
 * @param {number} [limit]
 * @param {'bytes'|'chars'} [unit] 企业微信按字节，Telegram 按字符
 * @returns {string[]}
 */
export function splitMessage(text, limit = WECOM_LIMIT_BYTES, unit = 'bytes') {
  const measure = unit === 'chars' ? (value) => value.length : byteLength
  const normalized = String(text ?? '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  if (measure(normalized) <= limit) return [normalized]

  const chunks = []
  let current = ''
  for (const line of normalized.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line
    if (measure(candidate) <= limit) {
      current = candidate
      continue
    }
    if (current) chunks.push(current)
    if (measure(line) <= limit) {
      current = line
      continue
    }
    // 单行本身超长：按单位硬切
    let rest = line
    while (measure(rest) > limit) {
      let cut = limit
      while (cut > 1 && measure(rest.slice(0, cut)) > limit) cut -= 1
      chunks.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    current = rest
  }
  if (current) chunks.push(current)
  return chunks
}

async function postJson(url, body, { fetchImpl, timeoutMs }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const raw = await response.text()
    let payload = null
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = null
    }
    if (!response.ok) {
      throw new Error(`企业微信 HTTP ${response.status}: ${raw.slice(0, 200)}`)
    }
    if (payload && typeof payload.errcode === 'number' && payload.errcode !== 0) {
      throw new Error(`企业微信返回 errcode=${payload.errcode} ${payload.errmsg ?? ''}`)
    }
    return payload
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 推送文本到企业微信群机器人。
 * @returns {Promise<{ ok: boolean, parts: number, results: Array }>}
 */
export async function pushWecom({
  webhook,
  text,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
  delayMs = 1200,
} = {}) {
  if (!webhook) throw new Error('缺少企业微信 Webhook（NEWS_WECOM_WEBHOOK）')
  const parts = splitMessage(text, WECOM_LIMIT_BYTES, 'bytes')
  if (parts.length === 0) throw new Error('没有可推送的内容')

  const results = []
  for (let index = 0; index < parts.length; index += 1) {
    const prefix = parts.length > 1 ? `（${index + 1}/${parts.length}）\n` : ''
    const payload = await postJson(
      webhook,
      {
        msgtype: 'markdown',
        markdown: { content: `${prefix}${parts[index]}` },
      },
      { fetchImpl, timeoutMs },
    )
    results.push(payload)
    if (index < parts.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  return { ok: true, parts: parts.length, results }
}
