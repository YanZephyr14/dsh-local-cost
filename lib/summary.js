// 聚合：今日 / 本会话 / 近 7 天，以及按模型、按峰谷、按 token 类型的拆分。
import { localDate, priceCall, wallClock } from './pricing.js'

export function emptyBucket() {
  return {
    amount: 0,
    calls: 0,
    tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    parts: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    peak: { amount: 0, calls: 0, tokens: 0 },
    offPeak: { amount: 0, calls: 0, tokens: 0 },
    unpriced: { calls: 0, tokens: 0 },
  }
}

function add(bucket, call, result) {
  bucket.calls += 1
  bucket.tokens.input += call.input
  bucket.tokens.cacheRead += call.cacheRead
  bucket.tokens.cacheWrite += call.cacheWrite
  bucket.tokens.output += call.output
  const tokens = call.input + call.cacheRead + call.cacheWrite + call.output
  if (!result.priced) {
    bucket.unpriced.calls += 1
    bucket.unpriced.tokens += tokens
    return
  }
  bucket.amount += result.total
  for (const key of ['input', 'cacheRead', 'cacheWrite', 'output']) bucket.parts[key] += result.parts[key]
  const side = result.peak ? bucket.peak : bucket.offPeak
  side.amount += result.total
  side.calls += 1
  side.tokens += tokens
}

/** 会话目录名与 scope.sessionId 的宽松匹配（有的地方带 session- 前缀）。 */
function sameSession(dirName, sessionId) {
  if (!sessionId) return false
  const a = String(dirName)
  const b = String(sessionId)
  return a === b || a === `session-${b}` || a.endsWith(b)
}

export function summarize(calls, config, { sessionId, now = Date.now() } = {}) {
  const tz = config.peak?.tz || 'Asia/Shanghai'
  const todayKey = localDate(now, tz)
  const weekStart = now - 7 * 86_400_000
  const today = emptyBucket()
  const session = emptyBucket()
  const week = emptyBucket()
  const models = new Map()

  for (const call of calls) {
    const clock = wallClock(call.t, tz)
    const result = priceCall(call, config, clock)
    const tokens = call.input + call.cacheRead + call.cacheWrite + call.output
    if (clock.date === todayKey) add(today, call, result)
    if (call.t >= weekStart) add(week, call, result)
    if (sameSession(call.session, sessionId)) add(session, call, result)

    const key = call.model || call.provider || '(unknown)'
    const row = models.get(key) ?? { model: key, provider: call.provider, amount: 0, tokens: 0, calls: 0, priced: 0 }
    if (!row.provider && call.provider) row.provider = call.provider
    row.calls += 1
    row.tokens += tokens
    if (result.priced) {
      row.amount += result.total
      row.priced += 1
    }
    models.set(key, row)
  }

  const modelRows = [...models.values()].sort((a, b) => b.amount - a.amount || b.tokens - a.tokens)
  return { today, session, week, models: modelRows, todayKey, now }
}

/** 分项占比；总额为 0 时返回 null，由视图显示「—」。 */
export function share(part, total) {
  if (!(total > 0)) return null
  return part / total
}