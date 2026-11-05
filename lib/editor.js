// 价格设置面板的数据与保存：分成三个小表单（峰谷时段 / 模型单价 / 新增模型），
// 各存各的，改价格不会顺带重置时段。
import { clone, parseWindows } from './config.js'

const WEEKEND = new Set(['offPeak', 'peak', 'ignore'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const FIELD_RE = /^(?:m_sel|s_(?:mode|windows|weekend|holidays)|m_(?:in|cr|out)|M_(?:in|cr|out)|g_(?:windows|weekend|holidays)|n_(?:key|in|cr|out)|[dD]_(?:in|cr|out)|c_(?:symbol|per|dec)|del_key)$/

export const MAX_EDITABLE = 4

/** 下拉可切换的全部模型（最多 24，select 上限）。 */
export function modelOptions(config) {
  const rows = []
  for (const [key, entry] of Object.entries(config.models ?? {})) {
    if (key === 'default' || key === '*') continue
    if (!entry?.offPeak) continue
    rows.push(entryRow(key, entry))
    if (rows.length >= 24) break
  }
  return rows
}

function entryRow(key, entry) {
  const short = key.includes(':') ? key.slice(key.lastIndexOf(':') + 1) : key
  return {
    key,
    entry,
    label: short.length > 22 ? `${short.slice(0, 20)}…` : short,
    short,
    provider: key.includes(':') ? key.slice(0, key.lastIndexOf(':')) : '',
  }
}

/** 兼容旧调用：前 N 个模型。 */
export function editableModels(config, limit = MAX_EDITABLE) {
  const rows = []
  for (const [key, entry] of Object.entries(config.models ?? {})) {
    if (key === 'default' || key === '*') continue
    if (!entry?.offPeak) continue
    rows.push(entryRow(key, entry))
    if (rows.length >= limit) break
  }
  return rows
}

/** 表单初值：峰谷时段 + 当前选中模型的单价（单模型字段，切换只换这份数据）。 */
export function pricesData(config, selectedKey, modeOverride) {
  const key = selectionOf(config, selectedKey)
  const entry = config.models?.[key] ?? { offPeak: {} }
  const off = entry.offPeak ?? {}
  const peak = entry.peak ?? off
  // 该模型实际生效的时段规则：自己的 schedule 优先，没写的继承全局
  const sched = { enabled: config.peak?.enabled !== false, windows: [], weekend: 'offPeak', holidays: [], ...(config.peak ?? {}), ...(entry.schedule ?? {}) }
  const flat = modeOverride ? modeOverride === 'flat' : sched.enabled === false
  return {
    m_sel: key,
    s_mode: modeOverride ?? (flat ? 'flat' : 'peak'),
    s_windows: (sched.windows ?? []).map((w) => `${w.start}-${w.end}`).join(','),
    s_weekend: sched.weekend ?? 'offPeak',
    s_holidays: (sched.holidays ?? []).join(','),
    m_in: Number(off.input) || 0,
    m_cr: Number(off.cacheRead) || 0,
    m_out: Number(off.output) || 0,
    M_in: Number(peak.input) || 0,
    M_cr: Number(peak.cacheRead) || 0,
    M_out: Number(peak.output) || 0,
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
}

/** 当前选中的模型 key；选中项失效时回落到第一个。 */
export function selectionOf(config, selectedKey) {
  if (selectedKey && config.models?.[selectedKey]?.offPeak) return selectedKey
  return modelOptions(config)[0]?.key ?? ''
}


/**
 * 提交上来的 payload 形状不确定（App 版本之间可能不一样），这里统一归一化：
 * - 平铺：{ p0_in: 2 }
 * - 带前缀/点路径：{ "data.p0_in": 2 }、{ "data/p0_in": 2 }、{ data: { p0_in: 2 } }
 * - 值包一层：{ p0_in: { value: 2 } }、{ p0_in: { text: "2" } }
 * - 键值对数组：[{ bind: "data.p0_in", value: 2 }]、[{ key: "p0_in", text: "2" }]
 * 只认叶子名，多余的包装层一律忽略。
 */
export function collectFields(value, out = {}) {
  let payload = value
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      return out
    }
  }
  const seen = new Set()
  const put = (name, raw) => {
    if (!FIELD_RE.test(name) || seen.has(name)) return
    seen.add(name)
    out[name] = unwrap(raw)
  }
  const visit = (node, depth) => {
    if (depth > 8 || node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }
    // 键值对数组的一项：{ bind|key|path|name: "data.x", value|text: ... }
    const label = node.bind ?? node.key ?? node.path ?? node.name ?? node.id
    if (typeof label === 'string' && ['value', 'text', 'v'].some((k) => k in node)) {
      put(leafOf(label), node.value ?? node.text ?? node.v)
      return
    }
    for (const [key, item] of Object.entries(node)) {
      if (FIELD_RE.test(key)) put(key, item)
      else if (typeof item === 'object' && item !== null) {
        // 兼容 { p0_in: { value: 2 } } 这种直接包一层的写法
        const leaf = leafOf(key)
        if (leaf !== key && FIELD_RE.test(leaf) && !Array.isArray(item)) put(leaf, item)
        else visit(item, depth + 1)
      } else if (leafOf(key) !== key) {
        const leaf = leafOf(key)
        if (FIELD_RE.test(leaf)) put(leaf, item)
      }
    }
  }
  visit(payload, 0)
  return out
}

/** "data.p0_in" / "bindings/data/p0_in" → "p0_in" */
function leafOf(key) {
  const text = String(key ?? '')
  const cut = Math.max(text.lastIndexOf('.'), text.lastIndexOf('/'), text.lastIndexOf(':'))
  return cut >= 0 ? text.slice(cut + 1) : text
}

/** 值可能是原始值，也可能包了一层 { value } / { text } / { v }。 */
function unwrap(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if ('value' in raw) return raw.value
    if ('text' in raw) return raw.text
    if ('v' in raw) return raw.v
  }
  return raw
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

/** 保存单个模型的完整独立设置：模式、时段、谷峰价全部写进这一个条目。 */
export function applyModelSettings(base, fields, messages, selectedKey) {
  const key = fields.m_sel ?? selectedKey
  if (!key || !base.models?.[key]?.offPeak) return { error: messages.notFound }
  const config = clone(base)
  const entry = { ...(config.models[key] ?? {}) }
  const off = { ...(entry.offPeak ?? {}) }
  const peakBefore = { ...(entry.peak ?? off) }

  if (fields.m_in !== undefined) off.input = rate(fields.m_in, Number(off.input) || 0)
  if (fields.m_cr !== undefined) off.cacheRead = rate(fields.m_cr, Number(off.cacheRead) || 0)
  if (fields.m_out !== undefined) off.output = rate(fields.m_out, Number(off.output) || 0)
  entry.offPeak = off
  const hasPeak = ['M_in', 'M_cr', 'M_out'].some((n) => fields[n] !== undefined)
  if (hasPeak) {
    const peak = { ...peakBefore }
    peak.input = rate(fields.M_in, Number(peakBefore.input) || 0)
    peak.cacheRead = rate(fields.M_cr, Number(peakBefore.cacheRead) || 0)
    peak.output = rate(fields.M_out, Number(peakBefore.output) || 0)
    entry.peak = peak
  }

  // 时段规则整体落到该模型自己的 schedule：保存后它与全局彻底脱钩
  const mode = fields.s_mode
  if (mode === 'flat') {
    entry.schedule = { enabled: false }
  } else if (mode === 'peak' || fields.s_windows !== undefined || fields.s_weekend !== undefined || fields.s_holidays !== undefined) {
    const sched = { ...(base.peak ?? {}), ...(entry.schedule ?? {}) }
    delete sched.tz
    if (fields.s_windows !== undefined) {
      const windows = parseWindows(fields.s_windows)
      if (windows === null) return { error: messages.windows }
      sched.windows = windows
    }
    if (fields.s_weekend !== undefined) {
      const weekend = String(fields.s_weekend).trim()
      if (!WEEKEND.has(weekend)) return { error: messages.weekend }
      sched.weekend = weekend
    }
    if (fields.s_holidays !== undefined) {
      sched.holidays = String(fields.s_holidays)
        .split(/[,，\s]+/)
        .map((d) => d.trim())
        .filter((d) => DATE_RE.test(d))
        .slice(0, 120)
    }
    sched.enabled = true
    entry.schedule = sched
  }

  config.models[key] = entry
  return { config, key }
}

/** 确保某个模型有价格条目（从费用面板点「未定价」进入时用）；新条目抄 default。 */
export function ensureModelEntry(base, model) {
  const key = String(model ?? '').trim()
  if (key === '' || key.length > 120) return { config: base, created: false, error: 'key' }
  if (base.models?.[key]?.offPeak) return { config: base, created: false, key }
  const config = clone(base)
  const template = config.models?.default?.offPeak ?? { input: 0, cacheRead: 0, output: 0 }
  const rates = {
    input: Number(template.input) || 0,
    cacheRead: Number(template.cacheRead) || 0,
    output: Number(template.output) || 0,
  }
  config.models = config.models ?? {}
  config.models[key] = { offPeak: { ...rates }, peak: { ...rates } }
  return { config, created: true, key }
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
