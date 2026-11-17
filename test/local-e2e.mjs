#!/usr/bin/env node
/**
 * 本地端到端自测：不联网、不需要真实 key。
 *
 * 用三个假端点替换真实依赖 ——
 *   news.google.com  → 假 RSS
 *   api.deepseek.com → 假模型（同时记录我们发过去的 prompt）
 *   qyapi.weixin.qq.com → 假群机器人（记录推送内容）
 *
 * 断言：素材正确分组、prompt 里带 5/10 条数与「英语每日一句」、推送内容落库。
 */

import { runPipeline } from '../src/pipeline.mjs'
import { splitMessage } from '../src/push.mjs'
import { parseRss } from '../src/rss.mjs'

const ORIGIN = 'http://127.0.0.1:0'
const failures = []
const captured = { prompts: [], pushes: [], rssQueries: [] }

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`)
    return
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}

function rssFixture(name, count) {
  const items = Array.from({ length: count }, (_, index) => {
    const id = index + 1
    return [
      '<item>',
      `<title><![CDATA[${name} 第 ${id} 条测试头条 - ${name}]]></title>`,
      `<link>https://example.com/${encodeURIComponent(name)}/${id}</link>`,
      `<pubDate>${new Date().toUTCString()}</pubDate>`,
      '</item>',
    ].join('')
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${name}</title>${items}</channel></rss>`
}

const CANNED = [
  '📰 每日双语新闻简报 · 2026-11-16 早报',
  '',
  '一、国内要闻（5 条）',
  '1. 测试国内一',
  'EN: Test domestic one.',
  '',
  '二、国际要闻（10 条）',
  '1. 测试国际一',
  'EN: Test international one.',
  '',
  '三、今日观察',
  '中文：测试观察。',
  'EN: Test takeaway.',
  '',
  '四、英语每日一句',
  '「Test sentence.」',
  '中文：测试句子。',
  '出处：佚名',
].join('\n')

const SITE_NAMES = {
  'cctv.com': 'CCTV 央视网',
  'news.cn': '新华社',
  'people.com.cn': '人民日报',
  'cnn.com': 'CNN',
  'bbc.com': 'BBC',
  'foxnews.com': 'Fox News',
  'nytimes.com': 'The New York Times',
  'reuters.com': 'Reuters',
}

const fakeFetch = async (url, init = {}) => {
  if (typeof url === 'string' && url.startsWith('https://news.google.com/rss/search')) {
    const query = new URL(url).searchParams.get('q') ?? ''
    captured.rssQueries.push(query)
    const domain = Object.keys(SITE_NAMES).find((candidate) => query.includes(`site:${candidate}`))
    const name = domain ? SITE_NAMES[domain] : 'unknown'
    return new Response(rssFixture(name, 6), {
      status: 200,
      headers: { 'content-type': 'application/rss+xml' },
    })
  }

  if (typeof url === 'string' && url.startsWith('https://api.deepseek.com')) {
    const body = JSON.parse(init.body ?? '{}')
    const userMessage = body.messages?.find((message) => message.role === 'user')?.content ?? ''
    captured.prompts.push({ body, userMessage })
    return new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: CANNED } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  if (typeof url === 'string' && url.startsWith('https://qyapi.weixin.qq.com')) {
    const body = JSON.parse(init.body ?? '{}')
    captured.pushes.push(body)
    return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  throw new Error(`测试没有为这个 URL 准备假实现：${url}`)
}

const config = {
  wecomWebhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test',
  llm: {
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'test-key',
    model: 'deepseek-chat',
    maxTokens: 2000,
  },
  timeZone: 'Asia/Shanghai',
  times: ['08:00', '20:00'],
  domesticItems: 5,
  internationalItems: 10,
  maxChars: 3000,
  lookbackHours: 24,
  dryRun: false,
}

async function main() {
  console.log('RSS 解析器：')
  const parsed = parseRss(rssFixture('CCTV 央视网', 3))
  check('解析出 3 条', parsed.length === 3, `实际 ${parsed.length}`)
  check('标题去掉 CDATA', parsed[0].title.includes('第 1 条测试头条'), parsed[0]?.title)
  check('带 link', parsed[0].link.includes('example.com'), parsed[0]?.link)

  console.log('\n长文本分段：')
  const long = Array.from({ length: 200 }, (_, i) => `第 ${i} 行，这是一行用于测试分段的中文内容。`).join('\n')
  const chunks = splitMessage(long)
  check('切成多段', chunks.length > 1, `${chunks.length} 段`)
  check(
    '每段都在 3800 字节内',
    chunks.every((chunk) => Buffer.byteLength(chunk, 'utf8') <= 3800),
  )
  check('拼接后内容不丢行', chunks.join('\n') === long)

  console.log('\n完整流水线（假端点）：')
  const result = await runPipeline(config, { fetchImpl: fakeFetch, now: new Date('2026-11-16T00:10:00Z') })

  check('抓取到国内头条', result.headlines.domestic > 0, `${result.headlines.domestic} 条`)
  check('抓取到国际头条', result.headlines.international > 0, `${result.headlines.international} 条`)
  check('查询覆盖 8 个来源', new Set(captured.rssQueries).size === 8, `${new Set(captured.rssQueries).size} 个`)
  check(
    '查询都带 site: 限定',
    captured.rssQueries.every((query) => query.includes('site:')),
  )

  const prompt = captured.prompts[0]?.userMessage ?? ''
  check('prompt 要求国内 5 条', prompt.includes('国内 5 条'))
  check('prompt 要求国际 10 条', prompt.includes('国际 10 条'))
  check('prompt 含英语每日一句', prompt.includes('英语每日一句'))
  check('prompt 含国内来源分组', prompt.includes('[CCTV 央视网]') && prompt.includes('[新华社]'))
  check('prompt 含国际来源分组', prompt.includes('[CNN]') && prompt.includes('[Reuters]'))

  check('推送了一次', captured.pushes.length === 1, `${captured.pushes.length} 次`)
  const pushed = captured.pushes[0]?.markdown?.content ?? ''
  check('推送类型是 markdown', captured.pushes[0]?.msgtype === 'markdown')
  check('推送内容与简报一致', pushed === CANNED.trim(), `长度 ${pushed.length}`)

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
