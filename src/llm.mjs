/** OpenAI 兼容的 chat/completions 调用（DeepSeek 默认）。 */

export async function chat({
  baseUrl,
  apiKey,
  model,
  maxTokens = 4000,
  system,
  user,
  temperature = 0.4,
  timeoutMs = 180000,
  fetchImpl = globalThis.fetch,
}) {
  if (!apiKey) throw new Error('缺少 LLM API Key（NEWS_LLM_KEY）')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
    })

    const raw = await response.text()
    if (!response.ok) {
      throw new Error(`LLM 请求失败 HTTP ${response.status}: ${raw.slice(0, 300)}`)
    }
    let payload
    try {
      payload = JSON.parse(raw)
    } catch {
      throw new Error(`LLM 返回了非 JSON 内容: ${raw.slice(0, 200)}`)
    }
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('LLM 没有返回正文（可能被内容过滤或 token 用尽）')
    }
    return content.trim()
  } finally {
    clearTimeout(timer)
  }
}
