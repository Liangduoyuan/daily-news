/**
 * 新闻源：统一走 Google News RSS 的 `site:` 搜索。
 *
 * 为什么不用各家自己的 RSS：路透社已停更 RSS，纽约时报要 API key，
 * 央视/新华的栏目 RSS 经常变更；Google News 用一条 `site:` 查询就能覆盖
 * 全部八家，且自带 pubDate 便于按时间窗过滤。
 *
 * 注意：Google News 在中国大陆网络不可达。云端部署请选海外区域，
 * 或把 SOURCES 换成各站自己的 RSS（readRss 是通用解析器，换 URL 即可）。
 */

import { parseRss } from './rss.mjs'

export const DOMESTIC_SOURCES = [
  { name: 'CCTV 央视网', domain: 'cctv.com', query: '央视新闻 OR CCTV', lang: 'zh' },
  { name: '新华社', domain: 'news.cn', query: '新华社 OR 新华网', lang: 'zh' },
  { name: '人民日报', domain: 'people.com.cn', query: '人民日报', lang: 'zh' },
]

export const INTERNATIONAL_SOURCES = [
  { name: 'CNN', domain: 'cnn.com', query: 'world news', lang: 'en' },
  { name: 'BBC', domain: 'bbc.com', query: 'news', lang: 'en' },
  { name: 'Fox News', domain: 'foxnews.com', query: 'politics', lang: 'en' },
  { name: 'The New York Times', domain: 'nytimes.com', query: 'world', lang: 'en' },
  { name: 'Reuters', domain: 'reuters.com', query: 'world news', lang: 'en' },
]

const LOCALE = {
  zh: { hl: 'zh-CN', gl: 'CN', ceid: 'CN:zh-Hans' },
  en: { hl: 'en-US', gl: 'US', ceid: 'US:en' },
}

export function googleNewsUrl({ source, lookbackHours = 24 }) {
  const when = lookbackHours <= 24 ? 'when:1d' : 'when:7d'
  const query = `site:${source.domain} ${source.query} ${when}`
  const locale = LOCALE[source.lang] ?? LOCALE.en
  const params = new URLSearchParams({
    q: query,
    hl: locale.hl,
    gl: locale.gl,
    ceid: locale.ceid,
  })
  return `https://news.google.com/rss/search?${params.toString()}`
}

/** 抓一个 URL 并返回文本；失败返回 null 而不是抛错（单源失败不该拖垮整条流水线）。 */
export async function fetchText(url, { fetchImpl = globalThis.fetch, timeoutMs = 15000, userAgent } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        'user-agent': userAgent ?? 'Mozilla/5.0 (compatible; dsh-news-cloud/1.0)',
        accept: 'application/rss+xml, application/xml, text/xml',
      },
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 标题归一化用于去重：去掉 Google News 追加的 " - 来源" 尾巴和标点。 */
function normalizeTitle(title) {
  return title
    .replace(/\s+[-–—]\s+[^-–—]{2,40}$/, '')
    .replace(/[「」《》"'“”‘’·、，。！？!?,.:;：；\s]/g, '')
    .toLowerCase()
}

function withinLookback(pubDate, now, hours) {
  if (!pubDate) return true
  const at = Date.parse(pubDate)
  if (!Number.isFinite(at)) return true
  return now - at <= hours * 60 * 60 * 1000
}

/**
 * 采集一组来源的头条。
 * @returns {Promise<{items: Array, errors: Array}>} items 已去重并按时间倒序
 */
export async function collectHeadlines(
  sources,
  { now = new Date(), lookbackHours = 24, perSource = 6, fetchImpl, timeoutMs } = {},
) {
  const items = []
  const errors = []
  const seen = new Set()

  const results = await Promise.all(
    sources.map(async (source) => {
      const url = googleNewsUrl({ source, lookbackHours })
      const xml = await fetchText(url, { fetchImpl, timeoutMs })
      if (!xml) return { source, entries: [], error: '抓取失败' }
      const entries = parseRss(xml).filter((entry) => withinLookback(entry.pubDate, now.getTime(), lookbackHours))
      return { source, entries, error: null }
    }),
  )

  for (const { source, entries, error } of results) {
    if (error) {
      errors.push(`${source.name}: ${error}`)
      continue
    }
    let taken = 0
    for (const entry of entries) {
      if (taken >= perSource) break
      const key = normalizeTitle(entry.title)
      if (!key || seen.has(key)) continue
      seen.add(key)
      taken += 1
      items.push({
        source: source.name,
        domain: source.domain,
        lang: source.lang,
        title: entry.title.replace(/\s+[-–—]\s+[^-–—]{2,40}$/, '').trim(),
        link: entry.link,
        pubDate: entry.pubDate,
      })
    }
    if (taken === 0) errors.push(`${source.name}: 时间窗内无新闻`)
  }

  items.sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0))
  return { items, errors }
}

/** 把采集结果渲染成给模型看的素材文本，按国内/国际分组。 */
export function renderCorpus({ domestic, international }) {
  const section = (title, items) => {
    if (items.length === 0) return `${title}\n（本组没有抓到素材）`
    const lines = items.map(
      (item, index) => `${index + 1}. [${item.source}] ${item.title}`,
    )
    return `${title}\n${lines.join('\n')}`
  }
  return [
    section('## 国内来源（CCTV / 新华社 / 人民日报）', domestic),
    section('## 国际来源（CNN / BBC / Fox News / The New York Times / Reuters）', international),
  ].join('\n\n')
}
