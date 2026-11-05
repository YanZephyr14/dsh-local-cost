// 价格设置面板的数据与保存：把表单字段写回 price.json。
import { clone, parseWindows } from './config.js'

const WEEKEND = new Set(['offPeak', 'peak', 'ignore'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const FIELD_RE = /^(?:[pP]\d+_(?:in|cr|out)|g_(?:windows|weekend|holidays))$/

/** 面板里最多编辑 4 个模型，其余留在文件里不动。 */
export function editableModels(config) {
  const rows = []
  for (const [key, entry] of Object.entries(config.models ?? {})) {
    if (key === 'default' || key === '*') continue
    if (!entry?.offPeak) continue
    rows.push({ key, entry, label: key.length > 34 ? `${key.slice(0, 32)}…` : key })
    if (rows.length >= 4) break
  }
  return rows
}

/** 表单初值：全部通过 data.<字段> 绑定给输入框。 */
export function pricesData(config) {
  const data = {
    g_windows: (config.peak?.windows ?? []).map((w) => `${w.start}-${w.end}`).join(','),
    g_weekend: config.peak?.weekend ?? 'offPeak',
    g_holidays: (config.peak?.holidays ?? []).join(','),
  }
  editableModels(config).forEach((model, i) => {
    const off = model.entry.offPeak ?? {}
    const peak = model.entry.peak ?? off
    data[`p${i}_in`] = Number(off.input) || 0
    data[`p${i}_cr`] = Number(off.cacheRead) || 0
    data[`p${i}_out`] = Number(off.output) || 0
    data[`P${i}_in`] = Number(peak.input) || 0
    data[`P${i}_cr`] = Number(peak.cacheRead) || 0
    data[`P${i}_out`] = Number(peak.output) || 0
  })
  return data
}

/** 提交上来的 payload 形状不确定：递归扫出认得的字段名。 */
export function collectFields(value, out = {}, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return out
  if (Array.isArray(value)) {
    for (const item of value) collectFields(item, out, depth + 1)
    return out
  }
  for (const [key, item] of Object.entries(value)) {
    if (FIELD_RE.test(key)) out[key] = item
    else if (item && typeof item === 'object') collectFields(item, out, depth + 1)
  }
  return out
}

function rate(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback
  const n = typeof raw === 'string' ? Number(raw.replace(/[,\s¥$]/g, '')) : Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return fallback
  return n
}

/**
 * 把表单字段合进配置。返回 { config, error }：error 是不认识的字段文案，
 * 此时不落盘，调用方原样提示用户。
 */
export function applyFields(base, fields, messages) {
  const config = clone(base)
  config.peak = config.peak ?? {}
  if (fields.g_windows !== undefined) {
    const windows = parseWindows(fields.g_windows)
    if (windows === null) return { config: base, error: messages.windows }
    config.peak.windows = windows
  }
  if (fields.g_weekend !== undefined) {
    const weekend = String(fields.g_weekend ?? '').trim()
    if (!WEEKEND.has(weekend)) return { config: base, error: messages.weekend }
    config.peak.weekend = weekend
  }
  if (fields.g_holidays !== undefined) {
    config.peak.holidays = String(fields.g_holidays ?? '')
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter((s) => DATE_RE.test(s))
      .slice(0, 120)
  }

  const models = editableModels(base)
  models.forEach((model, i) => {
    const entry = { ...(config.models[model.key] ?? {}) }
    const off = { ...(entry.offPeak ?? {}) }
    off.input = rate(fields[`p${i}_in`], Number(off.input) || 0)
    off.cacheRead = rate(fields[`p${i}_cr`], Number(off.cacheRead) || 0)
    off.output = rate(fields[`p${i}_out`], Number(off.output) || 0)
    entry.offPeak = off
    const peak = { ...(entry.peak ?? off) }
    peak.input = rate(fields[`P${i}_in`], off.input)
    peak.cacheRead = rate(fields[`P${i}_cr`], off.cacheRead)
    peak.output = rate(fields[`P${i}_out`], off.output)
    entry.peak = peak
    config.models[model.key] = entry
  })

  return { config, error: null }
}