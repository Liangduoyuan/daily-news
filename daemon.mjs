#!/usr/bin/env node
/**
 * 常驻模式 —— 进程内自带定时器，适合跑在 VPS / Docker 里。
 *
 *   node daemon.mjs
 *
 * 按 NEWS_TIMES（默认 08:00、20:00）在 NEWS_TZ 时区触发，错过整点后
 * 仍在补发窗口内会补推一次；已推过的时段写入状态文件，重启不重复。
 */

import { readFile, writeFile } from 'node:fs/promises'
import { loadConfig, loadDotEnv, stateFile } from './src/config.mjs'
import { runPipeline } from './src/pipeline.mjs'

const TICK_MS = 30_000
const CATCH_UP_MINUTES = 180
const RETAIN_DAYS = 7

function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}
const log = (message) => console.log(`[${stamp()}] ${message}`)

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

async function readState(file) {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'))
    return raw && typeof raw.fired === 'object' && raw.fired !== null ? raw.fired : {}
  } catch {
    return {}
  }
}

async function writeState(file, fired) {
  const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000
  const kept = {}
  for (const [key, value] of Object.entries(fired)) {
    const at = Date.parse(value)
    if (Number.isFinite(at) && at >= cutoff) kept[key] = value
  }
  try {
    await writeFile(file, `${JSON.stringify({ version: 1, fired: kept }, null, 2)}\n`, 'utf8')
  } catch (error) {
    log(`状态写入失败（不影响推送）：${error.message}`)
  }
}

async function main() {
  await loadDotEnv()
  const config = loadConfig()

  if (!config.dryRun && !config.wecomWebhook) {
    console.error('[news] 缺少 NEWS_WECOM_WEBHOOK，常驻模式无法推送')
    process.exit(1)
  }
  if (!config.llm.apiKey) {
    console.error('[news] 缺少 NEWS_LLM_KEY，简报无法生成')
    process.exit(1)
  }

  const file = stateFile()
  const fired = await readState(file)
  log(`常驻启动：${config.times.join(' · ')}（${config.timeZone}），国内 ${config.domesticItems} 条 + 国际 ${config.internationalItems} 条`)

  let running = false
  const tick = () => {
    if (running) return
    const clock = clockIn(new Date(), config.timeZone)
    const nowMinutes = clock.hour * 60 + clock.minute
    for (const slot of config.times) {
      const key = `${clock.date}|${slot}`
      if (fired[key]) continue
      const [hour, minute] = slot.split(':').map(Number)
      const late = nowMinutes - (hour * 60 + minute)
      if (late < 0 || late > CATCH_UP_MINUTES) continue

      running = true
      fired[key] = new Date().toISOString()
      void writeState(file, fired)
      log(`触发 ${slot} 推送`)
      runPipeline(config, { log })
        .catch((error) => log(`推送失败：${error instanceof Error ? error.message : error}`))
        .finally(() => {
          running = false
        })
      return
    }
  }

  tick()
  setInterval(tick, TICK_MS)
}

main().catch((error) => {
  console.error(`[news] 启动失败：${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
