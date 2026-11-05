// 价格设置面板的数据与保存：分成三个小表单（峰谷时段 / 模型单价 / 新增模型），
// 各存各的，改价格不会顺带重置时段。
import { clone, parseWindows } from './config.js'

const WEEKEND = new Set(['offPeak', 'peak', 'ignore'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const FIELD_RE = /^(?:[pP]\d+_(?:in|cr|out)|w\d+|g_(?:windows|weekend|holidays)|n_(?:key|in|cr|out)|[dD]_(?:in|cr|out)|c_(?:symbol|per|dec)|del_key)$/

export const MAX_EDITABLE = 4

/** 面板里最多编辑 4 个模型（输入框预算 32），其余留在文件里。 */
export function editableModels(config, limit = MAX_EDITABLE) {
  const rows = []
  for (const [key, entry] of Object.entries(config.models ?? {})) {
    if (key === 'default' || key === '*') continue
    if (!entry?.offPeak) continue
    const short = key.includes(':') ? key.slice(key.lastIndexOf(':') + 1) : key
    rows.push({
      key,
      entry,
      label: short.length > 22 ? `${short.slice(0, 20)}…` : short,
      short,
      provider: key.includes(':') ? key.slice(0, key.lastIndexOf(':')) : '',
    })
    if (rows.length >= limit) break
  }
  return rows
}

/** 表单初值：全部通过 data.<字段> 绑定给输入框。 */
export function pricesData(config) {
  const data = {
    g_windows: (config.peak?.windows ?? []).map((w) => `${w.start}-${w.end}`).join(','),
    g_weekend: config.peak?.weekend ?? 'offPeak',
    g_holidays: (config.peak?.holidays ?? []).join(','),
    n_key: '',
    n_in: '',
    n_cr: '',
    n_out: '',
    d_in: Number(config.models?.default?.offPeak?.input) || 0,
    d_cr: Number(config.models?.default?.offPeak?.cacheRead) || 0,
    d_out: Number(config.models?.default?.offPeak?.output) || 0,
    D_in: Number(config.models?.default?.peak?.input) || 0,
    D_cr: Number(config.models?.default?.peak?.cacheRead) || 0,
    D_out: Number(config.models?.default?.peak?.output) || 0,
    c_symbol: config.currency?.symbol ?? '¥',
    c_per: Number(config.currency?.perTokens) || 1000000,
    c_dec: Number(config.currency?.decimals) ?? 3,
    del_key: '',
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
    data[`w${i}`] = (model.entry.schedule?.windows ?? []).map((w) => `${w.start}-${w.end}`).join(',')
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

/** 峰谷时段单独保存。 */
export function applyPeak(base, fields, messages) {
  const config = clone(base)
  config.peak = config.peak ?? {}
  if (fields.g_windows !== undefined) {
    const windows = parseWindows(fields.g_windows)
    if (windows === null) return { error: messages.windows }
    config.peak.windows = windows
  }
  if (fields.g_weekend !== undefined) {
    const weekend = String(fields.g_weekend ?? '').trim()
    if (!WEEKEND.has(weekend)) return { error: messages.weekend }
    config.peak.weekend = weekend
  }
  if (fields.g_holidays !== undefined) {
    config.peak.holidays = String(fields.g_holidays ?? '')
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter((s) => DATE_RE.test(s))
      .slice(0, 120)
  }
  return { config }
}

/** 已有模型的单价单独保存；只改提交上来的那几个字段，其余保持原值。 */
export function applyModels(base, fields, messages) {
  const config = clone(base)
  const models = editableModels(base)
  let touched = 0
  for (let i = 0; i < models.length; i += 1) {
    const model = models[i]
    const entry = { ...(config.models[model.key] ?? {}) }
    const off = { ...(entry.offPeak ?? {}) }
    const peakBefore = { ...(entry.peak ?? off) }
    const signature = (o, p) => [o.input, o.cacheRead, o.output, p.input, p.cacheRead, p.output].map((n) => Number(n) || 0).join('/')
    const before = signature(off, peakBefore)

    // 只写提交上来的字段：没提交的保持原样，不因为「缺省」写成 0。
    if (fields[`p${i}_in`] !== undefined) off.input = rate(fields[`p${i}_in`], Number(off.input) || 0)
    if (fields[`p${i}_cr`] !== undefined) off.cacheRead = rate(fields[`p${i}_cr`], Number(off.cacheRead) || 0)
    if (fields[`p${i}_out`] !== undefined) off.output = rate(fields[`p${i}_out`], Number(off.output) || 0)
    entry.offPeak = off

    // 峰时字段没提交时用原峰价兜底，绝不因为「没提交」而被谷价覆盖。
    const hasPeak = [`P${i}_in`, `P${i}_cr`, `P${i}_out`].some((key) => fields[key] !== undefined)
    const peak = { ...peakBefore }
    if (hasPeak) {
      peak.input = rate(fields[`P${i}_in`], Number(peakBefore.input) || 0)
      peak.cacheRead = rate(fields[`P${i}_cr`], Number(peakBefore.cacheRead) || 0)
      peak.output = rate(fields[`P${i}_out`], Number(peakBefore.output) || 0)
      entry.peak = peak
    }

    // 每个模型可以覆盖全局峰时段；留空表示回到全局。
    const windowsBefore = JSON.stringify(entry.schedule?.windows ?? null)
    if (fields[`w${i}`] !== undefined) {
      const text = String(fields[`w${i}`]).trim()
      if (text === '') {
        if (entry.schedule) {
          const next = { ...entry.schedule }
          delete next.windows
          if (Object.keys(next).length === 0) delete entry.schedule
          else entry.schedule = next
        }
      } else {
        const windows = parseWindows(text)
        if (windows === null) return { error: messages.windows }
        entry.schedule = { ...(entry.schedule ?? {}), windows }
      }
    }

    if (JSON.stringify(entry.schedule?.windows ?? null) !== windowsBefore) touched += 1
    if (signature(off, peak) !== before) touched += 1
    config.models[model.key] = entry
  }
  if (touched === 0) return { error: messages.noChange }
  return { config, touched }
}

/** 新增模型：只收谷时三项，峰时先与谷时相同，之后再改。 */
export function applyAddModel(base, fields, messages) {
  const raw = String(fields.n_key ?? '').trim().replace(/\s+/g, '')
  if (raw === '') return { error: messages.needKey }
  if (raw.length > 120) return { error: messages.badKey }
  const config = clone(base)
  if (config.models[raw]?.offPeak) return { error: messages.exists }
  if (Object.keys(config.models ?? {}).length >= 60) return { error: messages.full }
  const input = rate(fields.n_in, 0)
  const cacheRead = rate(fields.n_cr, 0)
  const output = rate(fields.n_out, 0)
  config.models[raw] = {
    offPeak: { input, cacheRead, output },
    peak: { input, cacheRead, output },
  }
  return { config, added: raw }
}

/** 今天真正调用过、但一条价格都匹配不上的模型。 */
export function unpricedModels(state, config) {
  const rows = state?.models ?? []
  return rows
    .filter((row) => row.calls > 0 && row.priced === 0 && row.model !== '(unknown)')
    .map((row) => row.model)
    .filter((model) => !config.models?.[model]?.offPeak)
    .slice(0, 10)
}

/** 把未定价模型批量加进配置，价格先抄 default（没有就全 0，等用户填）。 */
export function addUnpriced(base, models) {
  const config = clone(base)
  const template = config.models?.default?.offPeak ?? { input: 0, cacheRead: 0, output: 0 }
  const added = []
  for (const model of models) {
    if (config.models?.[model]?.offPeak) continue
    if (Object.keys(config.models ?? {}).length >= 60) break
    config.models[model] = {
      offPeak: {
        input: Number(template.input) || 0,
        cacheRead: Number(template.cacheRead) || 0,
        output: Number(template.output) || 0,
      },
      peak: {
        input: Number(template.input) || 0,
        cacheRead: Number(template.cacheRead) || 0,
        output: Number(template.output) || 0,
      },
    }
    added.push(model)
  }
  return { config, added }
}
/** 兜底价（未知模型用的 default）：谷时与峰时各三项。 */
export function applyDefault(base, fields, messages) {
  const config = clone(base)
  const entry = { ...(config.models?.default ?? {}) }
  const blank = { input: 0, cacheRead: 0, output: 0 }
  const off = { ...(entry.offPeak ?? blank) }
  const peak = { ...(entry.peak ?? off) }
  if (fields.d_in !== undefined) off.input = rate(fields.d_in, Number(off.input) || 0)
  if (fields.d_cr !== undefined) off.cacheRead = rate(fields.d_cr, Number(off.cacheRead) || 0)
  if (fields.d_out !== undefined) off.output = rate(fields.d_out, Number(off.output) || 0)
  if (fields.D_in !== undefined) peak.input = rate(fields.D_in, Number(peak.input) || 0)
  if (fields.D_cr !== undefined) peak.cacheRead = rate(fields.D_cr, Number(peak.cacheRead) || 0)
  if (fields.D_out !== undefined) peak.output = rate(fields.D_out, Number(peak.output) || 0)
  if (off.input === undefined && off.output === undefined) return { error: messages.needRate }
  config.models = config.models ?? {}
  config.models.default = { offPeak: off, peak }
  return { config }
}

/** 货币与单位：符号、每多少 token 计价、小数位。 */
export function applyCurrency(base, fields) {
  const config = clone(base)
  config.currency = { ...(config.currency ?? {}) }
  if (fields.c_symbol !== undefined) {
    const symbol = String(fields.c_symbol).trim().slice(0, 4)
    if (symbol !== '') config.currency.symbol = symbol
  }
  if (fields.c_per !== undefined) {
    const per = rate(fields.c_per, config.currency.perTokens)
    if (per > 0) config.currency.perTokens = Math.round(per)
  }
  if (fields.c_dec !== undefined) {
    const dec = rate(fields.c_dec, config.currency.decimals)
    config.currency.decimals = Math.min(6, Math.round(dec))
  }
  return { config }
}

/** 删掉一个模型（default / * 不允许删）。 */
export function deleteModel(base, fields, messages) {
  const key = String(fields.del_key ?? '').trim()
  if (key === '') return { error: messages.needKey }
  if (key === 'default' || key === '*') return { error: messages.notDeletable }
  const config = clone(base)
  if (!config.models?.[key]) return { error: messages.notFound }
  delete config.models[key]
  return { config, removed: key }
}
