/** 简报生成：把头条素材交给模型，产出中英双语文本（含英语每日一句）。 */

import { chat } from './llm.mjs'
import { renderCorpus } from './sources.mjs'

export const SYSTEM_PROMPT = [
  '你是一名严谨的国际新闻编辑，负责把新闻头条素材整理成中英双语简报。',
  '只输出简报正文，不要任何前言、说明或结语。',
  '事实必须来自素材。素材没写的数字、日期、人名、机构名、引语一律不许编造；不确定就换一条或写得笼统。',
  '中文与英文必须描述同一件事，英文不是逐字直译，而是同一事实的自然英文表述。',
].join('\n')

function clockIn(now, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = Object.fromEntries(formatter.formatToParts(now).map((p) => [p.type, p.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  }
}

export function slotLabelOf(clock) {
  return clock.hour < 12 ? '早报' : '晚报'
}

export function buildPrompt({ config, corpus, clock, slotLabel }) {
  const domestic = config.domesticItems
  const international = config.internationalItems
  const total = domestic + international
  return [
    `请基于下面的头条素材，生成 ${clock.date} 的《${slotLabel}》。`,
    '',
    '写作要求：',
    `1. 共 ${total} 条新闻：国内 ${domestic} 条、国际 ${international} 条，严格按这个数量。`,
    '2. 优先政治、经济、科技，其余领域只要足够重要也可以入选（题材不限）。',
    `3. 国内条目只能从「国内来源」里选，国际条目只能从「国际来源」里选，不要串组。`,
    '4. 每条新闻两行，严格按这个格式（序号后是中文，第二行以 EN: 开头是英文）：',
    '   1. 中文一句话，不超过 38 字，写清主体 + 发生了什么 + 关键数字（若素材有）。',
    '   EN: One English sentence, at most 18 words, the same fact — not a literal translation.',
    '5. 纯文本，不要 Markdown 语法（不要 #、*、|、表格、代码块）。可以用「」、·、— 、emoji 分隔。',
    '6. 结构：',
    `   📰 每日双语新闻简报 · ${clock.date} ${slotLabel}`,
    `   一、国内要闻（${domestic} 条，编号 1-${domestic}）`,
    '   （条目）',
    `   二、国际要闻（${international} 条，编号 1-${international}）`,
    '   （条目）',
    '   三、今日观察',
    '   中文：一句判断或线索（不超过 40 字）',
    '   EN: One short English takeaway.',
    '   四、英语每日一句',
    '   「英文原句」',
    '   中文：这句的中文翻译（不超过 40 字）',
    '   出处：作者或作品；不确定就写「佚名」，绝对不要编造出处',
    '7. 「英语每日一句」可以是一句鼓励的话、一句名言，或一句英文诗；不要和上面的新闻重复，也不要每次都用同一句。',
    `8. 全文控制在 ${config.maxChars} 字符以内（含标点与换行）。两组都要给足条数，宁可每条写短一点。`,
    '9. 不要出现「素材」「头条」「根据检索」等字样。',
    '',
    '头条素材：',
    corpus,
  ].join('\n')
}

export async function composeDigest({ config, corpus, now = new Date(), fetchImpl, timeoutMs }) {
  const clock = clockIn(now, config.timeZone)
  const slotLabel = slotLabelOf(clock)
  const text = await chat({
    baseUrl: config.llm.baseUrl,
    apiKey: config.llm.apiKey,
    model: config.llm.model,
    maxTokens: config.llm.maxTokens,
    system: SYSTEM_PROMPT,
    user: buildPrompt({ config, corpus, clock, slotLabel }),
    fetchImpl,
    timeoutMs,
  })
  return { text, clock, slotLabel }
}

export { renderCorpus, clockIn }
