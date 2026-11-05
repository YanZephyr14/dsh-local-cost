// 面板视图（v2）：费用明细与价格设置。只负责画，不写文件。
import { formatWindows } from './config.js'
import { share } from './summary.js'

const DICT = {
  zh: {
    costs: '费用',
    today: '今日',
    session: '本会话',
    week: '近 7 天',
    calls: '次调用',
    peak: '峰时',
    offPeak: '谷时',
    nowPeak: '当前峰时',
    nowOff: '当前谷时',
    toOff: '转谷时',
    toPeak: '转峰时',
    inMinutes: '还有 {n} 分钟',
    soon: '不到 1 分钟',
    allDay: '峰谷未启用，全天一个价',
    breakdown: '费用构成（今日）',
    breakdownCaption: '占比：{a} / {b} / {c}',
    breakdownCaption4: '占比：{a} / {b} / {c} / {d}',
    brInput: '未命中缓存输入',
    brCache: '缓存命中输入',
    brWrite: '缓存写入',
    brOutput: '输出',
    tokensTitle: 'Token（今日）',
    tokenCalls: '调用',
    tokenInput: '输入',
    tokenCache: '缓存读',
    tokenOutput: '输出',
    peakTable: '峰时 vs 谷时（今日）',
    colSlot: '时段',
    colAmount: '金额',
    colCalls: '次数',
    colTokens: 'Token',
    byModel: '按模型（今日）',
    refresh: '刷新',
    openPrices: '价格设置',
    unpriced: '有 {n} 次调用没匹配到价格，未计入金额',
    unpricedShort: '未定价',
    readFail: '{n} 个日志暂时读不到',
    noCalls: '今天还没有调用记录',
    noPrice: '今天的调用都还没匹配到价格，先去「价格设置」填单价',
    per: '¥/百万 token',
    pricesTitle: '价格设置',
    unitLine: '单位 {sym} / 百万 token（currency 可在 price.json 改）',
    secPeak: '峰谷时段',
    secModels: '模型单价',
    secAdd: '新增模型',
    fWindows: '峰时段',
    fWeekend: '周末怎么算',
    fHolidays: '节假日（全天谷时）',
    optOff: '谷时',
    optPeak: '峰时',
    optWindow: '按窗口',
    fNewKey: '模型 key',
    hintNewKey: 'provider:model 或 model',
    savePeak: '保存时段',
    saveModels: '保存单价',
    saveAdd: '添加',
    restHint: '还有 {n} 个模型没显示（面板最多 4 个），请改 price.json',
    unpricedTag: '未定价',
    fillUnpriced: '并入未定价',
    filledNone: '今天没有未定价的模型',
    filled: '已加入 {n} 个模型，请填单价',
    configBroken: '配置有问题：{msg}（下面按内置默认值算）',
    saveFailed: '保存失败，文件可能只读',
    noChange: '价格没有变化',
    needKey: '先填模型 key',
    badKey: '这个 key 太长',
    exists: '已有同名模型，改上面那段就行',
    full: '模型数量到上限了',
    peakHint: '峰时留空 = 按谷时算',
    scopeNote: '口径：不含标题生成等辅助调用；子智能体只计入今日 / 近 7 天',
    unpricedHint: '今天这些模型还没定价：{list}',
    fieldWindows: '峰时段',
    fieldWeekend: '周末',
    fieldHolidays: '假日（全天谷时）',
    hintWindows: '如 09:00-12:00,14:00-18:00',
    hintWeekend: 'off / peak / ignore',
    hintHolidays: '2026-10-01,2026-10-02',
    save: '保存',
    inLabel: '输入',
    crLabel: '缓存读',
    outLabel: '输出',
    offSection: '谷时',
    peakSection: '峰时',
    fileHint: '改完点对应表单的保存；也可以直接改 price.json。',
    saved: '已保存',
    badWindows: '峰时段看不懂，用 09:00-12:00 这种写法',
    badWeekend: '周末只能填 off / peak / ignore',
    noFields: '没收到新的价格，请重试',
  },
  en: {
    costs: 'Costs',
    today: 'Today',
    session: 'This chat',
    week: 'Last 7d',
    calls: 'calls',
    peak: 'Peak',
    offPeak: 'Off-peak',
    nowPeak: 'Peak now',
    nowOff: 'Off-peak now',
    toOff: 'to off-peak',
    toPeak: 'to peak',
    inMinutes: 'in {n} min',
    soon: 'in <1 min',
    allDay: 'Peak pricing off — one rate all day',
    breakdown: 'Cost breakdown (today)',
    breakdownCaption: 'Shares: {a} / {b} / {c}',
    breakdownCaption4: 'Shares: {a} / {b} / {c} / {d}',
    brInput: 'Input (cache miss)',
    brCache: 'Input (cache hit)',
    brWrite: 'Cache write',
    brOutput: 'Output',
    tokensTitle: 'Tokens (today)',
    tokenCalls: 'Calls',
    tokenInput: 'Input',
    tokenCache: 'Cache read',
    tokenOutput: 'Output',
    peakTable: 'Peak vs off-peak (today)',
    colSlot: 'Slot',
    colAmount: 'Amount',
    colCalls: 'Calls',
    colTokens: 'Tokens',
    byModel: 'By model (today)',
    refresh: 'Refresh',
    openPrices: 'Prices',
    unpriced: '{n} call(s) had no price and are excluded',
    unpricedShort: 'No price',
    readFail: '{n} log(s) unreadable right now',
    noCalls: 'No calls today yet',
    noPrice: 'No call matched a price — set rates in Prices',
    per: 'per 1M tokens',
    pricesTitle: 'Prices',
    unitLine: 'Rates in {sym} per 1M tokens (currency editable in price.json)',
    secPeak: 'Peak windows',
    secModels: 'Model rates',
    secAdd: 'Add model',
    fWindows: 'Peak windows',
    fWeekend: 'Weekends',
    fHolidays: 'Holidays (off-peak)',
    optOff: 'Off-peak',
    optPeak: 'Peak',
    optWindow: 'By window',
    fNewKey: 'Model key',
    hintNewKey: 'provider:model or model',
    savePeak: 'Save windows',
    saveModels: 'Save rates',
    saveAdd: 'Add',
    restHint: '{n} more model(s) hidden here (max 4 in the panel) — edit price.json',
    unpricedTag: 'No price',
    fillUnpriced: 'Add unpriced',
    filledNone: 'No unpriced model today',
    filled: 'Added {n} model(s) — fill in the rates',
    configBroken: 'Config problem: {msg} (using built-in defaults below)',
    saveFailed: 'Save failed — the file may be read-only',
    noChange: 'Nothing changed',
    needKey: 'Enter a model key first',
    badKey: 'That key is too long',
    exists: 'That model already exists — edit the section above',
    full: 'Model list is full',
    peakHint: 'Empty peak falls back to off-peak',
    scopeNote: 'Scope: excludes title/compaction helper calls; sub-agents count for today / 7 days only',
    unpricedHint: 'No price yet for: {list}',
    fieldWindows: 'Peak windows',
    fieldWeekend: 'Weekend',
    fieldHolidays: 'Holidays (off-peak)',
    hintWindows: 'e.g. 09:00-12:00,14:00-18:00',
    hintWeekend: 'off / peak / ignore',
    hintHolidays: '2026-10-01,2026-10-02',
    save: 'Save',
    inLabel: 'Input',
    crLabel: 'Cache read',
    outLabel: 'Output',
    offSection: 'Off-peak',
    peakSection: 'Peak',
    fileHint: 'Tap each form’s Save; price.json works too.',
    saved: 'Saved',
    badWindows: 'Cannot read the windows — use 09:00-12:00',
    badWeekend: 'Weekend must be off / peak / ignore',
    noFields: 'No new rates received, try again',
  },
}

export function translator(locale) {
  const zh = !String(locale ?? '').toLowerCase().startsWith('en')
  const table = zh ? DICT.zh : DICT.en
  return (key, vars) => {
    let text = table[key] ?? key
    for (const [k, v] of Object.entries(vars ?? {})) text = text.replaceAll(`{${k}}`, String(v))
    return text
  }
}

export function money(config, value) {
  const symbol = config.currency?.symbol ?? '¥'
  if (!(Number(value) > 0)) return `${symbol}0`
  const decimals = Number.isFinite(config.currency?.decimals) ? config.currency.decimals : 3
  let digits = decimals
  let text = Number(value).toFixed(digits)
  if (Number(text) === 0) text = Number(value).toFixed(Math.min(6, digits + 2))
  return `${symbol}${text}`
}

export function percent(part, total) {
  const ratio = share(part, total)
  if (ratio === null) return '—'
  return `${(ratio * 100).toFixed(1)}%`
}

export function compact(value) {
  const n = Number(value) || 0
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

function peakLine(config, state, t) {
  const peak = config.peak
  if (!peak || peak.enabled === false) return t('allDay')
  const isPeak = state.isPeak
  const next = state.nextSwitch
  const head = isPeak ? t('nowPeak') : t('nowOff')
  if (!next) return head
  const minutes = Math.max(0, Math.round((next.at - state.now) / 60_000))
  const when = minutes <= 0 ? t('soon') : t('inMinutes', { n: minutes })
  const target = next.peak ? t('toPeak') : t('toOff')
  return `${head} · ${when}${target}`
}

/** 费用面板：今日/本会话/近 7 天 + 费用构成 + 峰谷 + 按模型。 */
export function costView(config, state, caps) {
  const t = translator(caps?.locale)
  const today = state.today
  const total = today.amount
  const metrics = [
    { type: 'metric', label: t('today'), value: money(config, today.amount), caption: `${today.calls} ${t('calls')}` },
  ]
  if (state.hasSession !== false) {
    metrics.push({ type: 'metric', label: t('session'), value: money(config, state.session.amount), caption: `${state.session.calls} ${t('calls')}` })
  }
  const children = []
  if (state.configError) children.push({ type: 'callout', text: t('configBroken', { msg: state.configError }), tone: 'warn' })
  children.push(
    { type: 'row', children: metrics },
    { type: 'metric', label: t('week'), value: money(config, state.week.amount), caption: `${state.week.calls} ${t('calls')}` },
    { type: 'callout', text: peakLine(config, state, t), tone: state.isPeak ? 'warn' : 'good' },
  )

  if (today.calls === 0) {
    children.push({ type: 'emptyState', title: t('noCalls') })
  } else if (total > 0) {
    const hasWrite = today.parts.cacheWrite > 0
    const categories = hasWrite
      ? [t('brInput'), t('brCache'), t('brWrite'), t('brOutput')]
      : [t('brInput'), t('brCache'), t('brOutput')]
    const values = hasWrite
      ? [today.parts.input, today.parts.cacheRead, today.parts.cacheWrite, today.parts.output]
      : [today.parts.input, today.parts.cacheRead, today.parts.output]
    const shares = values.map((v) => percent(v, total))
    const caption = hasWrite
      ? t('breakdownCaption4', { a: shares[0], b: shares[1], c: shares[2], d: shares[3] })
      : t('breakdownCaption', { a: shares[0], b: shares[1], c: shares[2] })
    children.push({
      type: 'chart',
      kind: 'donut',
      categories,
      series: [{ name: t('today'), values: values.map((v) => Number(v.toFixed(4))) }],
      unit: config.currency?.symbol ?? '¥',
      caption: `${t('breakdown')} · ${caption}`,
    })
    const rows = categories.map((label, i) => [label, `${money(config, values[i])} · ${shares[i]}`])
    children.push({ type: 'keyValue', items: rows })
  } else {
    children.push({ type: 'callout', text: t('noPrice'), tone: 'warn' })
  }

  children.push({
    type: 'keyValue',
    items: [
      [t('tokenCalls'), `${today.calls}`],
      [t('tokenInput'), compact(today.tokens.input)],
      [t('tokenCache'), compact(today.tokens.cacheRead)],
      [t('tokenOutput'), compact(today.tokens.output)],
    ],
  })

  if (today.calls > 0 && config.peak?.enabled !== false) {
    children.push({
      type: 'table',
      columns: [t('colSlot'), t('colAmount'), t('colCalls'), t('colTokens')],
      rows: [
        [t('peak'), money(config, today.peak.amount), `${today.peak.calls}`, compact(today.peak.tokens)],
        [t('offPeak'), money(config, today.offPeak.amount), `${today.offPeak.calls}`, compact(today.offPeak.tokens)],
      ],
    })
  }

  if (state.models.length > 0) {
    children.push({
      type: 'list',
      items: state.models.slice(0, 6).map((row) => ({
        title: row.model,
        subtitle: `${row.calls} ${t('calls')} · ${compact(row.tokens)} tokens`,
        trailing: row.amount > 0 ? money(config, row.amount) : t('unpricedTag'),
        tone: row.priced === 0 ? 'warn' : undefined,
      })),
    })
  }

  if (today.unpriced.calls > 0) children.push({ type: 'callout', text: t('unpriced', { n: today.unpriced.calls }), tone: 'warn' })
  if (state.unreadable > 0) children.push({ type: 'text', text: t('readFail', { n: state.unreadable }), tone: 'muted' })

  children.push({ type: 'text', text: t('scopeNote'), tone: 'muted' })
  children.push({
    type: 'actions',
    items: [
      { label: t('refresh'), action: 'refresh' },
      { label: t('openPrices'), action: 'openPrices', style: 'primary' },
    ],
  })

  return { v: 2, type: 'stack', title: t('costs'), children }
}

function numberField(label, bind) {
  return { type: 'number', label, bind, min: 0, max: 1_000_000 }
}

/**
 * 价格设置面板：三个小表单，各存各的。
 * 1) 峰谷时段（时段 / 周末 / 节假日）  2) 已有模型单价  3) 新增模型
 */
export function pricesView(config, models, caps, extra = {}) {
  const t = translator(caps?.locale)
  const children = [{ type: 'text', text: t('unitLine', { sym: config.currency?.symbol ?? '¥' }), tone: 'muted' }]

  if (extra.configError) children.push({ type: 'callout', text: t('configBroken', { msg: extra.configError }), tone: 'warn' })
  if (extra.unpriced?.length) {
    children.push({ type: 'callout', text: t('unpricedHint', { list: extra.unpriced.slice(0, 4).join('、') }), tone: 'warn' })
  }

  children.push({
    type: 'form',
    label: t('secPeak'),
    submitLabel: t('savePeak'),
    submit: 'savePeak',
    children: [
      { type: 'textField', label: t('fWindows'), bind: 'data.g_windows', placeholder: t('hintWindows') },
      {
        type: 'segmented',
        label: t('fWeekend'),
        bind: 'data.g_weekend',
        options: [
          { label: t('optOff'), value: 'offPeak' },
          { label: t('optPeak'), value: 'peak' },
          { label: t('optWindow'), value: 'ignore' },
        ],
      },
      { type: 'textField', label: t('fHolidays'), bind: 'data.g_holidays', placeholder: t('hintHolidays') },
    ],
  })

  if (models.length > 0) {
    const sections = models.map((model, i) => ({
      type: 'collapsible',
      label: model.label,
      expanded: i === 0,
      children: [
        { type: 'text', text: model.provider ? `${model.provider} / ${model.short}` : model.short, tone: 'muted' },
        {
          type: 'row',
          children: [
            numberField(`${t('optOff')} · ${t('inLabel')}`, `data.p${i}_in`),
            numberField(`${t('optOff')} · ${t('crLabel')}`, `data.p${i}_cr`),
            numberField(`${t('optOff')} · ${t('outLabel')}`, `data.p${i}_out`),
          ],
        },
        {
          type: 'row',
          children: [
            numberField(`${t('optPeak')} · ${t('inLabel')}`, `data.P${i}_in`),
            numberField(`${t('optPeak')} · ${t('crLabel')}`, `data.P${i}_cr`),
            numberField(`${t('optPeak')} · ${t('outLabel')}`, `data.P${i}_out`),
          ],
        },
      ],
    }))
    children.push({ type: 'form', label: t('secModels'), submitLabel: t('saveModels'), submit: 'saveModels', children: sections })
  }

  children.push({
    type: 'form',
    label: t('secAdd'),
    submitLabel: t('saveAdd'),
    submit: 'addModel',
    children: [
      { type: 'textField', label: t('fNewKey'), bind: 'data.n_key', placeholder: t('hintNewKey') },
      {
        type: 'row',
        children: [
          numberField(`${t('optOff')} · ${t('inLabel')}`, 'data.n_in'),
          numberField(`${t('optOff')} · ${t('crLabel')}`, 'data.n_cr'),
          numberField(`${t('optOff')} · ${t('outLabel')}`, 'data.n_out'),
        ],
      },
    ],
  })

  if (extra.hiddenModels > 0) children.push({ type: 'text', text: t('restHint', { n: extra.hiddenModels }), tone: 'muted' })

  children.push({
    type: 'actions',
    items: [
      { label: t('fillUnpriced'), action: 'fillUnpriced' },
      { label: t('refresh'), action: 'refresh' },
    ],
  })
  children.push({ type: 'callout', text: `${t('fileHint')} ${t('peakHint')}`, tone: 'info' })

  return { v: 2, type: 'stack', title: t('pricesTitle'), children }
}
