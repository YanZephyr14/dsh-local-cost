// 计价：模型价格匹配、峰/谷判定、按 token 类型分项成本。
import { toMinutes } from './config.js'

const formatters = new Map()

/** 用户填了非法时区名时退回手机本地时区，不让计价整体失败。 */
function formatterFor(tz) {
  if (formatters.has(tz)) return formatters.get(tz)
  let fmt
  try {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
  } catch {
    fmt = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
  }
  formatters.set(tz, fmt)
  return fmt
}

/** 某一时刻在配置时区里的日期/分钟/是否周末。 */
export function wallClock(ms, tz) {
  const parts = formatterFor(tz).formatToParts(new Date(ms))
  const get = (type) => parts.find((p) => p.type === type)?.value ?? ''
  const date = `${get('year')}-${get('month')}-${get('day')}`
  const hour = Number(get('hour'))
  const minute = Number(get('minute'))
  const weekday = get('weekday')
  return {
    date,
    minutes: Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0,
    weekday,
    weekend: weekday === 'Sat' || weekday === 'Sun',
  }
}

export function localDate(ms, tz) {
  return wallClock(ms, tz).date
}

/** 本地日期串 YYYY-MM-DD → 该时区当天 00:00 的毫秒；非法返回 null。 */
export function dayStartMs(dateStr, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? ''))
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null
  const guess = Date.UTC(y, mo, d, 12)
  const parts = formatterFor(tz).formatToParts(new Date(guess))
  const get = (type) => parts.find((p) => p.type === type)?.value ?? ''
  const localNoon = Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')), Number(get('hour')) % 24, Number(get('minute')))
  let start = Date.UTC(y, mo, d) - (localNoon - guess)
  if (localDate(start, tz) !== dateStr) {
    if (localDate(start + 86_400_000, tz) === dateStr) start += 86_400_000
    else if (localDate(start - 86_400_000, tz) === dateStr) start -= 86_400_000
    else return null
  }
  return start
}

function inWindow(minutes, start, end) {
  // 起止相同表示整天，跨午夜时用「或」。
  if (start === end) return true
  if (start < end) return minutes >= start && minutes < end
  return minutes >= start || minutes < end
}

export function isPeakAt(clock, peak, ms) {
  if (!peak || peak.enabled === false) return false
  if ((peak.holidays ?? []).includes(clock.date)) return false
  if (clock.weekend) {
    if (peak.weekend === 'offPeak') return false
    if (peak.weekend === 'peak') return true
  }
  for (const window of peak.windows ?? []) {
    const start = toMinutes(window.start)
    const end = toMinutes(window.end)
    if (start === null || end === null) continue
    if (inWindow(clock.minutes, start, end)) return true
  }
  return false
}

/** 下一次峰谷切换的时刻；找不到（例如峰谷关闭）返回 null。 */
export function nextSwitch(peak, now, { horizonMs = 36 * 3600_000, tz = 'Asia/Shanghai' } = {}) {
  if (!peak || peak.enabled === false) return null
  const current = isPeakAt(wallClock(now, tz), peak, now)
  const step = 5 * 60_000
  let previous = now
  for (let t = now + step; t <= now + horizonMs; t += step) {
    if (isPeakAt(wallClock(t, tz), peak, t) !== current) {
      // 在上一档和这一档之间按分钟逼近，拿到切换的那一分钟。
      for (let fine = previous + 60_000; fine < t; fine += 60_000) {
        if (isPeakAt(wallClock(fine, tz), peak, fine) !== current) return { at: fine, peak: !current }
      }
      return { at: t, peak: !current }
    }
    previous = t
  }
  return null
}

function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s_.:-]/g, '')
}

/** 匹配顺序：provider:model → model → default；都没命中返回 null（记为未定价）。 */
export function resolvePrice(models, provider, model) {
  const table = models ?? {}
  const exact = provider && model ? `${provider}:${model}` : ''
  for (const key of [exact, model]) {
    if (key && table[key]?.offPeak) return { key, entry: table[key], matched: key === exact ? 'exact' : 'model' }
  }
  const wanted = new Set([normalize(exact), normalize(model)].filter(Boolean))
  for (const [key, entry] of Object.entries(table)) {
    if (!entry?.offPeak) continue
    const bare = key.includes(':') ? key.slice(key.lastIndexOf(':') + 1) : key
    if (wanted.has(normalize(key)) || wanted.has(normalize(bare))) return { key, entry, matched: 'model' }
  }
  const fallback = table.default ?? table['*']
  if (fallback?.offPeak) return { key: 'default', entry: fallback, matched: 'default' }
  return null
}

/** 单次调用的分项成本：未命中缓存输入 / 缓存命中输入 / 缓存写入 / 输出。 */
export function costParts(call, price, perTokens) {
  const scale = 1 / (Number(perTokens) || 1_000_000)
  const unit = {
    input: Number(price?.input) || 0,
    cacheRead: Number(price?.cacheRead) || 0,
    cacheWrite: Number(price?.cacheWrite) || 0,
    output: Number(price?.output) || 0,
  }
  const parts = {
    input: call.input * unit.input * scale,
    cacheRead: call.cacheRead * unit.cacheRead * scale,
    cacheWrite: call.cacheWrite * unit.cacheWrite * scale,
    output: call.output * unit.output * scale,
  }
  parts.total = parts.input + parts.cacheRead + parts.cacheWrite + parts.output
  return { parts, unit }
}

/** 生效的峰谷规则：模型自己的 schedule 覆盖全局，没写的字段继承全局。 */
export function effectivePeak(config, entry) {
  const base = config?.peak ?? {}
  const schedule = entry?.schedule
  if (!schedule) return base
  return { ...base, ...schedule }
}

/** 一条调用的完整计价结果，聚合层只吃这个。 */
export function priceCall(call, config, clock) {
  const resolved = resolvePrice(config.models, call.provider, call.model)
  const peak = isPeakAt(clock, effectivePeak(config, resolved?.entry), call.t)
  if (!resolved) return { priced: false, peak, tokens: call.input + call.cacheRead + call.cacheWrite + call.output }
  const price = (peak ? resolved.entry.peak : null) ?? resolved.entry.offPeak
  const { parts } = costParts(call, price, config.currency?.perTokens)
  return { priced: true, peak, parts, key: resolved.key, total: parts.total }
}