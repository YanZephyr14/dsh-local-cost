// price.json 的读取、校验与原子写入。所有字段都能被用户直接改，读的时候一律兜底。
import fs from 'node:fs'
import path from 'node:path'

export const CONFIG_FILE = 'price.json'

/** 计价模式：全天一个价 / 统一峰谷 / 分模型峰谷。 */
export const MODES = ['flat', 'global', 'perModel']

/** 首次运行生成的默认配置：价格取当前 cost-meter 里的自定义价（¥/百万 token），峰时先与谷时相同。 */
export const DEFAULT_CONFIG = {
  v: 1,
  currency: { code: 'CNY', symbol: '¥', perTokens: 1000000, decimals: 3 },
  peak: {
    enabled: true,
    tz: 'Asia/Shanghai',
    windows: [
      { start: '09:00', end: '12:00' },
      { start: '14:00', end: '18:00' },
    ],
    weekend: 'offPeak',
    holidays: [],
  },
  models: {
    'custom-dashscope-aliyuncs:deepseek-v4.1-flash-1017': {
      offPeak: { input: 1, cacheRead: 0.1, output: 4 },
      peak: { input: 1, cacheRead: 0.1, output: 4 },
    },
  },
}

const WEEKEND = new Set(['offPeak', 'peak', 'ignore'])
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

/** "9:00" / "09:00" / "0900" → 分钟数；不认识返回 null。 */
export function toMinutes(text) {
  const raw = String(text ?? '').trim()
  const colon = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw)
  if (colon) return Number(colon[1]) * 60 + Number(colon[2])
  const digits = /^(\d{3,4})$/.exec(raw)
  if (!digits) return null
  const padded = digits[1].padStart(4, '0')
  const hour = Number(padded.slice(0, 2))
  const minute = Number(padded.slice(2))
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

/** 分钟数 → "HH:MM"。 */
export function fromMinutes(total) {
  const m = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** "09:00-12:00, 14:00-18:00" → 窗口数组；有多余内容或起止相同返回 null。 */
export function parseWindows(text) {
  const parts = String(text ?? '')
    .split(/[,，;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return []
  if (parts.length > 12) return null
  const out = []
  for (const part of parts) {
    const m = /^([0-9:]+)-([0-9:]+)$/.exec(part)
    if (!m) return null
    const start = toMinutes(m[1])
    const end = toMinutes(m[2])
    if (start === null || end === null || start === end) return null
    out.push({ start: fromMinutes(start), end: fromMinutes(end) })
  }
  return out
}

export function formatWindows(peak) {
  return (peak?.windows ?? []).map((w) => `${w.start}-${w.end}`).join(',')
}

function num(value, fallback, { min = 0, max = 1e9 } = {}) {
  const n = typeof value === 'string' ? Number(value.replace(/[,\s]/g, '')) : Number(value)
  if (!Number.isFinite(n) || n < min || n > max) return fallback
  return n
}

/** 单个模型的峰谷覆盖：windows / weekend / holidays 都可单独覆盖全局。 */
export function sanitizeSchedule(raw, issues) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  if (Array.isArray(raw.windows)) {
    const windows = []
    for (const w of raw.windows.slice(0, 12)) {
      const start = toMinutes(w?.start)
      const end = toMinutes(w?.end)
      if (start === null || end === null || start === end) {
        issues.push('某个模型的峰时段看不懂，已跳过该段')
        continue
      }
      windows.push({ start: fromMinutes(start), end: fromMinutes(end) })
    }
    out.windows = windows
  }
  if (WEEKEND.has(raw.weekend)) out.weekend = raw.weekend
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled
  if (Array.isArray(raw.holidays)) {
    out.holidays = raw.holidays.map((d) => String(d).trim()).filter((d) => DATE_RE.test(d)).slice(0, 120)
  }
  return Object.keys(out).length > 0 ? out : null
}

function sanitizeRate(raw, base) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const key of ['input', 'cacheRead', 'cacheWrite', 'output']) {
    const fallback = base?.[key] ?? 0
    const value = num(src[key], fallback)
    if (value !== 0 || src[key] !== undefined) out[key] = value
  }
  return out
}

/** 用户填的时区名是否被运行时认识；不认识就退回默认时区并提示。 */
export function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
    return true
  } catch {
    return false
  }
}

/** 没写 mode 的旧配置按现状推断：关峰谷=flat；有模型时段=perModel；否则 global。 */
export function inferMode(config) {
  if (config?.peak?.enabled === false) return 'flat'
  const anySchedule = Object.values(config?.models ?? {}).some((m) => Array.isArray(m?.schedule?.windows) && m.schedule.windows.length > 0)
  return anySchedule ? 'perModel' : 'global'
}

/** 合并用户配置与默认值；坏字段丢掉并记一条问题，不让整个插件失效。 */
export function sanitize(raw) {
  const issues = []
  const defaults = clone(DEFAULT_CONFIG)
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}

  const currency = { ...defaults.currency }
  if (src.currency && typeof src.currency === 'object') {
    if (typeof src.currency.code === 'string' && src.currency.code.length <= 8) currency.code = src.currency.code
    if (typeof src.currency.symbol === 'string' && src.currency.symbol.length <= 4) currency.symbol = src.currency.symbol
    currency.perTokens = num(src.currency.perTokens, currency.perTokens, { min: 1, max: 1e9 })
    currency.decimals = Math.round(num(src.currency.decimals, currency.decimals, { min: 0, max: 6 }))
  }

  const peak = { ...defaults.peak, windows: clone(defaults.peak.windows), holidays: [] }
  if (src.peak && typeof src.peak === 'object') {
    if (typeof src.peak.enabled === 'boolean') peak.enabled = src.peak.enabled
    if (typeof src.peak.tz === 'string' && src.peak.tz.length <= 64) {
      if (validTimeZone(src.peak.tz)) peak.tz = src.peak.tz
      else {
        peak.tz = defaults.peak.tz
        issues.push(`时区「${src.peak.tz}」认不出来，已按 ${defaults.peak.tz} 计算`)
      }
    }
    if (Array.isArray(src.peak.windows)) {
      const windows = []
      for (const w of src.peak.windows.slice(0, 12)) {
        const start = toMinutes(w?.start)
        const end = toMinutes(w?.end)
        if (start === null || end === null || start === end) {
          issues.push('峰时段里有看不懂的时间，已跳过该段')
          continue
        }
        windows.push({ start: fromMinutes(start), end: fromMinutes(end) })
      }
      peak.windows = windows
    }
    if (WEEKEND.has(src.peak.weekend)) peak.weekend = src.peak.weekend
    else if (src.peak.weekend !== undefined) issues.push('周末策略只能是 offPeak / peak / ignore')
    if (Array.isArray(src.peak.holidays)) {
      peak.holidays = src.peak.holidays
        .map((d) => String(d).trim())
        .filter((d) => DATE_RE.test(d))
        .slice(0, 120)
    }
  }

  const models = {}
  const rawModels = src.models && typeof src.models === 'object' && !Array.isArray(src.models) ? src.models : defaults.models
  for (const [key, value] of Object.entries(rawModels).slice(0, 60)) {
    if (!value || typeof value !== 'object') continue
    const offPeak = sanitizeRate(value.offPeak ?? value, {})
    if (Object.keys(offPeak).length === 0) continue
    const entry = { offPeak }
    if (value.peak && typeof value.peak === 'object') entry.peak = sanitizeRate(value.peak, offPeak)
    const schedule = sanitizeSchedule(value.schedule, issues)
    if (schedule) entry.schedule = schedule
    models[String(key).slice(0, 120)] = entry
  }
  if (Object.keys(models).length === 0) models[Object.keys(defaults.models)[0]] = clone(defaults.models[Object.keys(defaults.models)[0]])

  let mode = MODES.includes(src.mode) ? src.mode : null
  if (!mode) mode = inferMode({ peak, models })

  const config = { v: 1, mode, currency, peak, models }
  return { config, issues }
}

export function writeAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

/** 读配置：缺文件就写一份默认值；坏 JSON 用默认值并带上错误文案。 */
export function loadConfig(dir) {
  const file = path.join(dir, CONFIG_FILE)
  let raw
  let error = null
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    if (err?.code === 'ENOENT') {
      const seed = clone(DEFAULT_CONFIG)
      try {
        writeAtomic(file, seed)
      } catch {
        /* 只读目录也能用内存默认值 */
      }
      return { config: sanitize(seed).config, error: null, file }
    }
    raw = null
    error = '价格配置不是合法 JSON，暂用内置默认值'
  }
  const { config, issues } = sanitize(raw)
  return { config, error: error ?? issues[0] ?? null, file }
}

/** 保存前再校验一次；致命错误抛异常，由调用方转成一句提示。 */
export function saveConfig(dir, raw) {
  const { config, issues } = sanitize(raw)
  if (!Array.isArray(config.peak.windows)) throw new Error('峰时段格式不对')
  writeAtomic(path.join(dir, CONFIG_FILE), config)
  return { config, issues }
}