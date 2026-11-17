/** 极简 RSS 解析：只取 item/title/link/pubDate，够用且零依赖。 */

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function stripCdata(text) {
  const match = text.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/)
  return match ? match[1] : text
}

function pick(block, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const match = block.match(re)
  if (!match) return ''
  return decodeEntities(stripCdata(match[1])).trim()
}

/**
 * 解析 RSS 2.0 文本。
 * @param {string} xml
 * @returns {Array<{ title: string, link: string, pubDate: string }>}
 */
export function parseRss(xml) {
  if (typeof xml !== 'string' || xml.length === 0) return []
  const entries = []
  const blocks = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? []
  for (const block of blocks) {
    const title = pick(block, 'title')
    if (!title) continue
    entries.push({
      title,
      link: pick(block, 'link'),
      pubDate: pick(block, 'pubDate'),
    })
  }
  return entries
}
